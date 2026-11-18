"""GitHub Actions publisher. No writes during validation or unit tests."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from release_policy import GitRepository, Release, is_stable_tag, managed_marker, plan_prune, prerelease_tag

REPOSITORY = "davidbasilefilho/basile-agc"
BOT = "github-actions[bot]"
ASSETS = (
    "Basile-S23-AGC9.2-V14.agc",
    "Basile-AGC-Camera-photo-look.xmp",
    "manifest.json",
)
SHA = re.compile(r"[0-9a-f]{40}")


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def stable_marker(sha):
    return f"<!-- basile-agc:auto-stable:v1:{sha} -->"


def is_bot(record):
    author = record.get("author") or {}
    return author.get("login") == BOT and author.get("type") == "Bot"


def owns(record, tag, sha, pre):
    mark = managed_marker(sha) if pre else stable_marker(sha)
    return (record.get("tag_name") == tag and record.get("draft") is False and
            record.get("prerelease") is pre and is_bot(record) and
            str(record.get("body") or "").splitlines().count(mark) == 1)


def digest_assets(root):
    return {name: "sha256:" + hashlib.sha256((root / "generated" / name).read_bytes()).hexdigest()
            for name in ASSETS}


def checked_assets(record, expected):
    assets = record.get("assets") or []
    return len(assets) == len(expected) and all(a.get("state") == "uploaded" for a in assets) and {
        a["name"]: a.get("digest") for a in assets} == expected


class GitHub:
    def __init__(self, token):
        self.token = token

    def api(self, path, *, method="GET", data=None, missing_ok=False):
        request = Request("https://api.github.com/repos/" + REPOSITORY + "/" + path,
                          method=method,
                          headers={"Authorization": "Bearer " + self.token,
                                   "Accept": "application/vnd.github+json",
                                   "Content-Type": "application/json", "User-Agent": "basile-agc-ci",
                                   "X-GitHub-Api-Version": "2022-11-28"},
                          data=None if data is None else json.dumps(data).encode())
        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            raise RuntimeError(f"GitHub {method} failed (HTTP {error.code}); stopped.") from None

    def releases(self):
        result = []
        for page in range(1, 10001):
            items = self.api(f"releases?per_page=100&page={page}")
            require(isinstance(items, list), "Malformed release inventory")
            result.extend(items)
            if len(items) < 100:
                return result
        raise RuntimeError("Release inventory incomplete; stopped.")

    def ref_sha(self, tag):
        ref = self.api("git/ref/tags/" + quote(tag, safe=""), missing_ok=True)
        if ref is None:
            return None
        require(ref.get("ref") == "refs/tags/" + tag, "Unexpected ref identity")
        obj = ref["object"]
        for _ in range(16):
            sha = obj["sha"]
            require(SHA.fullmatch(sha), "Unexpected Git object ID")
            if obj["type"] == "commit":
                return sha
            require(obj["type"] == "tag", "Tag does not point to a commit")
            obj = self.api("git/tags/" + sha)["object"]
        raise RuntimeError("Excessive tag indirection")

    def by_tag(self, tag):
        return self.api("releases/tags/" + quote(tag, safe=""), missing_ok=True)

    def create(self, root, tag, sha, pre):
        if self.ref_sha(tag) is None:
            require(pre, "Missing stable tag; never create it")
            self.api("git/refs", method="POST", data={"ref": "refs/tags/" + tag, "sha": sha})
        require(self.ref_sha(tag) == sha, "Tag target changed; stopped before publishing")
        kind = "Prerelease" if pre else "Release"
        title = f"{tag[4:20]} · {sha[:12]} (preview)" if pre else tag
        body = (f"{kind} of the Basile AGC generator at commit `{sha}`. "
                "Includes the GCam camera preset and an experimental, photo-only standalone XMP. "
                "See README and the manifest for device-validation limits.\n\n"
                + (managed_marker(sha) if pre else stable_marker(sha)) + "\n")
        with tempfile.TemporaryDirectory() as temp:
            notes = Path(temp) / "notes.md"
            notes.write_text(body)
            cmd = ["gh", "release", "create", tag, "--repo", REPOSITORY, "--verify-tag",
                   "--title", title, "--notes-file", str(notes), "--target", sha]
            if pre:
                cmd.extend(["--prerelease", "--latest=false"])
            cmd.extend(str(root / "generated" / name) for name in ASSETS)
            subprocess.run(cmd, cwd=root, check=True)


def included_in_stable(repo, api, records, sha):
    for r in records:
        tag = r.get("tag_name")
        if (not isinstance(tag, str) or not is_stable_tag(tag) or not is_bot(r)
                or r.get("prerelease") is not False or r.get("draft") is not False):
            continue
        stable_sha = repo.resolve_tag(tag)
        if (stable_sha and owns(r, tag, stable_sha, False)
                and api.ref_sha(tag) == stable_sha and repo.is_ancestor(sha, stable_sha)):
            return True
    return False


def publish(root, repo, api, sha, tag=None):
    require(isinstance(sha, str) and SHA.fullmatch(sha), "Expected a full commit ID")
    pre = tag is None
    if pre:
        tag = prerelease_tag(repo, sha)
        if included_in_stable(repo, api, api.releases(), sha):
            print("No preview: commit is already included in a managed stable release.")
            return
    else:
        require(is_stable_tag(tag), "Unsupported stable tag; no action")
        require(repo.resolve_tag(tag) == sha and api.ref_sha(tag) == sha,
                "Stable tag differs from validated checkout")
    expected = digest_assets(root)
    record = api.by_tag(tag)
    if record is None:
        # by_tag may omit drafts. Do not adopt or replace a partial/manual release.
        require(not any(r.get("tag_name") == tag for r in api.releases()),
                "An unrecognized release/draft already owns this tag; no action")
        api.create(root, tag, sha, pre)
        record = api.by_tag(tag)
    require(record and owns(record, tag, sha, pre) and api.ref_sha(tag) == sha
            and checked_assets(record, expected), "Published release, target, or assets not verified")
    print("Verified release:", tag)
    if pre:
        return
    prune(repo, api, tag, sha, expected)


def prune(repo, api, stable, sha, expected):
    records = api.releases()
    # ID lookup is secondary to exact tag and managed ownership checks.
    candidates = {}
    for r in records:
        tag = r.get("tag_name")
        if (not isinstance(tag, str) or not re.fullmatch(r"pre-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{40}", tag)
                or not is_bot(r) or r.get("immutable") is not False
                or r.get("draft") is not False or r.get("prerelease") is not True):
            continue
        if owns(r, tag, tag[-40:], True):
            require(tag not in candidates, "Ambiguous release inventory")
            candidates[tag] = r
    entries = [Release(tag_name=tag, body=r["body"], prerelease=True, draft=False)
               for tag, r in candidates.items()]
    plan = plan_prune(repo, entries, stable)
    require(not plan.tag_names_to_delete, "Tag deletion prohibited")
    for tag in plan.release_tags:
        r = candidates[tag]
        rid = r["id"]
        require(type(rid) is int and rid > 0, "Invalid release ID")
        final = api.by_tag(stable)
        require(final and owns(final, stable, sha, False) and checked_assets(final, expected)
                and api.ref_sha(stable) == sha, "Stable no longer verifies; pruning stopped")
        live = api.api("releases/" + str(rid), missing_ok=True)
        if live is None:
            continue
        if (not owns(live, tag, tag[-40:], True) or live.get("id") != rid
                or live.get("immutable") is not False or api.ref_sha(tag) != tag[-40:]):
            print("Retained changed or immutable candidate:", tag)
            continue
        # Delete the release record (including its attached preview assets), never the Git ref.
        api.api("releases/" + str(rid), method="DELETE")
        print("Removed included preview release; tag retained:", tag)


if __name__ == "__main__":
    require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_EVENT_NAME") == "push"
            and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY, "Live publication is restricted to a repository push on Actions")
    root = Path(__file__).resolve().parents[1]
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    ref = os.environ["GITHUB_REF"]
    require(event.get("deleted") is False and event.get("ref") == ref, "Not a live push ref")
    sha = subprocess.check_output(["git", "rev-parse", "--verify", "HEAD^{commit}"], cwd=root, text=True).strip()
    for candidate in [os.environ["GITHUB_SHA"], event.get("after")]:
        require(isinstance(candidate, str) and SHA.fullmatch(candidate), "Invalid event SHA")
        actual = subprocess.check_output(["git", "rev-parse", "--verify", candidate + "^{commit}"], cwd=root, text=True).strip()
        require(actual == sha, "Validated commit is not the event commit")
    default = "refs/heads/" + event["repository"]["default_branch"]
    if ref == default or ref.startswith("refs/tags/v"):
        publish(root, GitRepository(root), GitHub(os.environ["GH_TOKEN"]), sha,
                ref[len("refs/tags/"):] if ref != default else None)
