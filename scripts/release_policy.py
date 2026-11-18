"""Read-only, fail-closed policy for pruning managed GitHub prerelease records.

No GitHub calls, release deletion or tag deletion occur here. Discard the whole
plan if evaluation raises; revalidate remote metadata before applying a plan.
"""
from __future__ import annotations
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

_SHA = re.compile(r"[0-9a-f]{40}\Z", re.ASCII)
_PRE = re.compile(r"pre-([0-9]{8}T[0-9]{6}Z)-([0-9a-f]{40})\Z", re.ASCII)
_STABLE = re.compile(r"v[A-Za-z0-9][A-Za-z0-9.+_-]{0,126}\Z", re.ASCII)
_MARKER_PREFIX = "<!-- basile-agc:auto-pre:"

class PolicyError(RuntimeError):
    """Validation or checked Git operation failed; discard the entire plan."""

@dataclass(frozen=True)
class Release:
    """Authoritative release metadata supplied by the caller, not inferred."""
    tag_name: str
    body: str
    prerelease: bool
    draft: bool = False

@dataclass(frozen=True)
class PrunePlan:
    """Release tags eligible for deletion; no independent tag deletion."""
    release_tags: tuple[str, ...]
    tag_names_to_delete: tuple[str, ...] = ()

class GitRepository:
    """Read-only, checked Git operations in an existing repository."""
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _run(self, *arguments: str, allowed: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                ["git", "--no-replace-objects", "-C", str(self.path), *arguments],
                text=True, capture_output=True, check=False, timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise PolicyError("Git operation could not be completed") from error
        if result.returncode not in allowed:
            raise PolicyError(f"Git operation failed ({arguments[0]}, exit {result.returncode})")
        return result

    def commit(self, ref: str) -> str:
        """Resolve a reference to its commit, peeling annotated tags."""
        result = self._run("rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
        sha = result.stdout.strip()
        if not _SHA.fullmatch(sha):
            raise PolicyError("Expected a full lowercase 40-character commit SHA")
        return sha

    def tag_commit(self, tag: str) -> str | None:
        """Resolve an exact tag ref, or return None if the tag does not exist."""
        ref = f"refs/tags/{tag}"
        exists = self._run("show-ref", "--verify", "--quiet", ref, allowed=(0, 1))
        return None if exists.returncode == 1 else self.commit(ref)

    def resolve_tag(self, tag: str) -> str | None:
        """Resolve a tag name to its commit, peeling annotated tags."""
        return self.tag_commit(tag)

    def timestamp(self, sha: str) -> str:
        """Return the commit committer timestamp as a UTC tag component."""
        if not _SHA.fullmatch(sha):
            raise PolicyError("Invalid commit SHA")
        raw = self._run("show", "-s", "--format=%ct", sha, "--").stdout.strip()
        try:
            result = datetime.fromtimestamp(int(raw), timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        except (ValueError, OverflowError, OSError) as error:
            raise PolicyError("Invalid Git committer timestamp") from error
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", result, re.ASCII):
            raise PolicyError("Commit timestamp is outside supported tag range")
        return result

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        """Return ancestry, raising rather than treating Git errors as false."""
        return self._run("merge-base", "--is-ancestor", ancestor, descendant, allowed=(0, 1)).returncode == 0


def is_stable_tag(tag: str) -> bool:
    """Accept bounded ASCII v versions, including v1, v1.2 and v2026-11-18.

    Start with v and an ASCII alphanumeric; remaining characters are alphanumeric, dot, plus,
    underscore or hyphen. Reject repeated dots and trailing dot or .lock.
    Slashes, ref expressions, whitespace, controls and metacharacters are
    excluded. Deliberately does not require three-component SemVer.
    """
    return bool(_STABLE.fullmatch(tag)) and ".." not in tag and not tag.endswith((".", ".lock"))


def managed_marker(sha: str) -> str:
    """Return the exact standalone ownership marker for a full commit SHA."""
    if not _SHA.fullmatch(sha):
        raise PolicyError("Invalid managed-marker SHA")
    return f"<!-- basile-agc:auto-pre:v1:{sha} -->"


def prerelease_tag(repo: GitRepository, commit_ref: str = "HEAD") -> str:
    """Derive a deterministic prerelease tag from the Git committer date."""
    sha = repo.commit(commit_ref)
    return f"pre-{repo.timestamp(sha)}-{sha}"


def plan_prune(repo: GitRepository, releases: Iterable[Release], stable_tag: str) -> PrunePlan:
    """Plan managed non-draft prerelease deletion only when reachable from stable.

    Exact name, timestamp, SHA, resolved tag, standalone body marker and
    ancestry must all agree. Same-commit prereleases qualify. Malformed,
    missing-tag, side-branch, manual, draft and stable releases are retained.
    Checked Git failures abort the complete plan. No tags are ever deleted.
    """
    if not is_stable_tag(stable_tag):
        raise PolicyError("Unsafe stable version tag")
    stable_sha = repo.tag_commit(stable_tag)
    if stable_sha is None:
        raise PolicyError("Stable version tag does not exist locally")
    if repo._run("rev-parse", "--is-shallow-repository").stdout.strip() != "false":
        raise PolicyError("Complete Git history is required for release pruning")
    candidates: list[str] = []
    seen: set[str] = set()
    for release in releases:
        if release.tag_name in seen:
            raise PolicyError("Duplicate release tag metadata")
        seen.add(release.tag_name)
        if release.prerelease is not True or release.draft is not False:
            continue
        match = _PRE.fullmatch(release.tag_name)
        if match is None:
            continue
        timestamp, sha = match.groups()
        markers = [line for line in release.body.splitlines() if _MARKER_PREFIX in line]
        if markers != [managed_marker(sha)]:
            continue
        resolved = repo.tag_commit(release.tag_name)
        if resolved != sha or repo.timestamp(sha) != timestamp:
            continue
        if repo.is_ancestor(sha, stable_sha):
            candidates.append(release.tag_name)
    return PrunePlan(tuple(sorted(candidates)))
