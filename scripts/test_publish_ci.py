"""No credentials or network: test the orchestration against a fake release service."""
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from publish_ci import (BOT, ASSETS, checked_assets, digest_assets, owns, prune, publish,
                        release_notes)
from release_policy import PrunePlan

ROOT = Path(__file__).resolve().parents[1]
BASE = "a" * 40
TIP = "b" * 40
TAG = "pre-20260101T000000Z-" + BASE
EXPECTED = digest_assets(ROOT)


def record(tag, sha, pre=False, id=1):
    title, notes = release_notes(tag, sha, pre)
    return {"tag_name": tag, "name": title, "draft": False, "prerelease": pre, "immutable": False,
            "id": id, "body": notes,
            "author": {"login": BOT, "type": "Bot"},
            "assets": [{"name": n, "state": "uploaded", "digest": EXPECTED[n], "uploader": {"login": BOT}} for n in ASSETS]}


class Service:
    def __init__(self):
        self.records = {}
        self.refs = {"v1": TIP}
        self.created = []
        self.deleted = []

    def releases(self):
        return list(self.records.values())

    def ref_sha(self, tag):
        return self.refs.get(tag)

    def by_tag(self, tag):
        hit = self.records.get(tag)
        return hit if hit and not hit["draft"] else None

    def create(self, root, tag, sha, pre):
        self.refs[tag] = sha
        self.created.append(tag)
        self.records[tag] = record(tag, sha, pre, id=90)

    def api(self, path, *, method="GET", missing_ok=False):
        id = int(path.split("/")[1])
        record = next((r for r in self.records.values() if r["id"] == id), None)
        if method == "DELETE":
            self.deleted.append(id)
            del self.records[record["tag_name"]]
            return None
        return record


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.api = Service()
        self.repo = Mock()
        self.repo.asset_digests.return_value = EXPECTED
        self.repo.resolve_tag.side_effect = lambda tag: self.api.refs.get(tag)

    def test_create_and_repeat_stable_without_duplicate_or_tag_delete(self):
        with patch("publish_ci.plan_prune", return_value=PrunePlan(())):
            publish(ROOT, self.repo, self.api, TIP, "v1")
            publish(ROOT, self.repo, self.api, TIP, "v1")
        self.assertEqual(self.api.created, ["v1"])
        self.assertEqual(self.api.refs, {"v1": TIP})

    def test_managed_preview_then_stable_prune_retains_tag(self):
        with patch("publish_ci.prerelease_tag", return_value=TAG):
            publish(ROOT, self.repo, self.api, BASE)
        with patch("publish_ci.plan_prune", return_value=PrunePlan((TAG,))):
            self.api.records[TAG]["id"] = 2
            publish(ROOT, self.repo, self.api, TIP, "v1")
        self.assertEqual(self.api.deleted, [2])
        self.assertEqual(self.api.refs[TAG], BASE)
        self.assertIn("v1", self.api.records)

    def test_unverified_stable_never_prunes(self):
        for change in [{"draft": True}, {"author": {"login": "other", "type": "User"}},
                       {"body": "not managed"}, {"assets": []}, {"prerelease": True}]:
            self.api.records["v1"] = {**record("v1", TIP), **change}
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                publish(ROOT, self.repo, self.api, TIP, "v1")
            self.assertEqual(self.api.created + self.api.deleted, [])

    def test_moved_or_missing_stable_blocks_writes(self):
        for sha in [None, BASE]:
            with self.subTest(sha=sha):
                self.api.refs["v1"] = sha
                with self.assertRaises(RuntimeError):
                    publish(ROOT, self.repo, self.api, TIP, "v1")
        self.assertEqual(self.api.created + self.api.deleted, [])

    def test_racing_candidate_change_is_retained(self):
        self.api.records = {"v1": record("v1", TIP), TAG: record(TAG, BASE, True, id=2)}
        for changed in [{"immutable": True}, {"prerelease": False}, {"draft": True},
                        {"tag_name": "different"}, {"author": {"login": "manual"}}]:
            def read(path, **kwargs):
                return {**self.api.records[TAG], **changed}
            with self.subTest(changed=changed), patch("publish_ci.plan_prune", return_value=PrunePlan((TAG,))), patch.object(self.api, "api", side_effect=read) as api:
                prune(self.repo, self.api, "v1", TIP, EXPECTED)
                self.assertEqual(api.call_count, 1)
                self.assertNotIn("method", api.call_args.kwargs)

    def test_hand_edited_preview_assets_or_notes_survive(self):
        self.api.refs[TAG] = BASE
        good = record(TAG, BASE, True, id=2)
        for change in [{"assets": good["assets"] + [{"name": "manual.txt"}]},
                       {"assets": [{**a, "digest": "sha256:replaced"} for a in good["assets"]]},
                       {"assets": [{**a, "uploader": {"login": "human"}} for a in good["assets"]]},
                       {"name": "manual title"}, {"body": good["body"] + "personal notes"}]:
            self.api.records = {"v1": record("v1", TIP), TAG: {**good, **change}}
            with self.subTest(change=change), patch("publish_ci.plan_prune", return_value=PrunePlan((TAG,))):
                prune(self.repo, self.api, "v1", TIP, EXPECTED)
                self.assertIn(TAG, self.api.records)
        self.assertEqual(self.api.deleted, [])

    def test_preview_on_already_released_commit_skips_even_on_replay(self):
        self.api.records["v1"] = record("v1", TIP)
        self.repo.is_ancestor.return_value = True
        with patch("publish_ci.prerelease_tag", return_value=TAG):
            publish(ROOT, self.repo, self.api, BASE)
        self.assertEqual(self.api.created + self.api.deleted, [])

    def test_bad_asset_digests_are_rejected(self):
        r = record("v1", TIP)
        r["assets"][0]["digest"] = "sha256:" + "0" * 64
        self.assertFalse(checked_assets(r, EXPECTED))
        self.assertTrue(owns(r, "v1", TIP, False))
