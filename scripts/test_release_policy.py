"""Real Git DAG tests for the read-only release pruning policy."""
import os
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

from release_policy import GitRepository, PolicyError, Release, is_stable_tag, managed_marker, plan_prune, prerelease_tag


class ReleasePolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Policy Test")
        self.git("config", "user.email", "policy@example.invalid")
        self.first = self.commit("first", "2026-01-01T03:04:05+03:00")
        self.second = self.commit("second", "2026-01-02T00:00:00Z")
        self.git("checkout", "-q", "-b", "side", self.first)
        self.side = self.commit("side", "2026-01-03T00:00:00Z")
        self.git("checkout", "-q", "main")
        self.tip = self.commit("tip", "2026-01-04T00:00:00Z")
        self.git("tag", "-a", "v1", "-m", "stable", self.tip)
        self.repo = GitRepository(self.path)

    def git(self, *args, env=None):
        return subprocess.run(["git", "-C", str(self.path), *args], check=True, capture_output=True, text=True, env=env).stdout.strip()

    def commit(self, name, date):
        env = dict(os.environ, GIT_COMMITTER_DATE=date, GIT_AUTHOR_DATE="2025-01-01T00:00:00Z")
        self.git("commit", "--allow-empty", "-q", "-m", name, env=env)
        return self.git("rev-parse", "HEAD")

    def release(self, sha, annotated=False):
        tag = prerelease_tag(self.repo, sha)
        if annotated:
            self.git("tag", "-a", tag, "-m", "managed prerelease", sha)
        else:
            self.git("tag", tag, sha)
        return Release(tag, "Release notes\n\n" + managed_marker(sha) + "\n", True)

    def test_ancestors_and_same_commit_qualify_but_side_branch_does_not(self):
        releases = [self.release(self.first), self.release(self.second, True), self.release(self.tip), self.release(self.side)]
        plan = plan_prune(self.repo, releases, "v1")
        self.assertEqual(plan.release_tags, tuple(sorted(r.tag_name for r in releases[:3])))
        self.assertEqual(plan.tag_names_to_delete, ())
        for release in releases:
            self.assertIsNotNone(self.repo.resolve_tag(release.tag_name))
        self.assertEqual(self.repo.resolve_tag("v1"), self.tip)

    def test_tag_uses_committer_date_utc_not_author_date(self):
        self.assertEqual(prerelease_tag(self.repo, self.first), f"pre-20260101T000405Z-{self.first}")

    def test_near_names_are_not_managed(self):
        valid = self.release(self.first)
        for name in ["x" + valid.tag_name, valid.tag_name + "-extra", valid.tag_name.upper(), valid.tag_name[:-1], "pre-latest", "v1"]:
            with self.subTest(name=name):
                self.assertEqual(plan_prune(self.repo, [replace(valid, tag_name=name)], "v1").release_tags, ())

    def test_manual_stable_draft_and_bad_markers_are_retained(self):
        valid = self.release(self.first)
        for release in [replace(valid, prerelease=False), replace(valid, draft=True), replace(valid, body="manual"), replace(valid, body=" " + managed_marker(self.first)), replace(valid, body=managed_marker(self.second)), replace(valid, body=managed_marker(self.first) + "\n" + managed_marker(self.first))]:
            with self.subTest(release=release):
                self.assertEqual(plan_prune(self.repo, [release], "v1").release_tags, ())

    def test_timestamp_mismatch_and_sha_mismatch_are_retained(self):
        valid = self.release(self.first)
        altered_name = valid.tag_name.replace("20260101", "20260102")
        self.git("tag", altered_name, self.first)
        self.assertEqual(plan_prune(self.repo, [replace(valid, tag_name=altered_name)], "v1").release_tags, ())
        self.git("tag", "-f", valid.tag_name, self.second)
        self.assertEqual(plan_prune(self.repo, [valid], "v1").release_tags, ())

    def test_missing_tag_is_retained_and_missing_stable_aborts(self):
        release = Release(prerelease_tag(self.repo, self.first), managed_marker(self.first), True)
        self.assertEqual(plan_prune(self.repo, [release], "v1").release_tags, ())
        with self.assertRaises(PolicyError):
            plan_prune(self.repo, [release], "v2")

    def test_stable_tag_names_are_bounded_and_safe(self):
        for tag in ["v1", "v1.2", "v1.2.3", "v2026-11-18", "v1_test", "vNext", "v1.2.3+build.1"]:
            self.assertTrue(is_stable_tag(tag), tag)
        for tag in ["v", "--help", "v1/branch", "v1..2", "v1@{0}", "v1^", "v1~1", "v1;echo", "v1\n", "v1.", "v1.lock", "v１", "v" + "1" * 128]:
            self.assertFalse(is_stable_tag(tag), repr(tag))
            with self.assertRaises(PolicyError):
                plan_prune(self.repo, [], tag)

    def test_checked_failure_discards_plan(self):
        first = self.release(self.first)
        second = self.release(self.second)
        with patch.object(self.repo, "is_ancestor", side_effect=[True, PolicyError("simulated checked failure")]):
            with self.assertRaises(PolicyError):
                plan_prune(self.repo, [first, second], "v1")
        with patch("release_policy.subprocess.run", side_effect=OSError("missing git")):
            with self.assertRaises(PolicyError):
                plan_prune(self.repo, [], "v1")
        with patch("release_policy.subprocess.run", return_value=subprocess.CompletedProcess([], 128, "", "error")):
            with self.assertRaises(PolicyError):
                self.repo.is_ancestor(self.first, self.tip)

    def test_duplicate_records_abort(self):
        release = self.release(self.first)
        with self.assertRaises(PolicyError):
            plan_prune(self.repo, [release, release], "v1")

    def test_shallow_repository_aborts(self):
        (self.path / ".git" / "shallow").write_text(self.first + "\n")
        with self.assertRaises(PolicyError):
            plan_prune(self.repo, [], "v1")

    def test_asset_digests_bind_exact_historical_blob_bytes(self):
        target = self.path / "generated"
        target.mkdir()
        file = target / "example.xmp"
        payload = b"utf8 text\r\nunchanged bytes\n"
        file.write_bytes(payload)
        self.git("add", "generated/example.xmp")
        sha = self.commit("assets", "2026-01-05T00:00:00Z")
        file.write_bytes(b"uncommitted change")
        self.assertEqual(self.repo.asset_digests(sha, ["example.xmp"]), {
            "example.xmp": "sha256:" + hashlib.sha256(payload).hexdigest()})
        with self.assertRaises(PolicyError):
            self.repo.asset_digests(sha, ["missing.file"])

    def test_non_commit_tag_aborts(self):
        blob = self.git("hash-object", "-w", "--stdin")
        self.git("tag", "v2", blob)
        with self.assertRaises(PolicyError):
            plan_prune(self.repo, [], "v2")


if __name__ == "__main__":
    unittest.main()
