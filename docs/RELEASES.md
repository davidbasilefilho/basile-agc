# CI, preview builds and stable releases

**Validation** runs on pushes and pull requests with read-only repository access: frozen Bun install, formatting, type-aware lint, typecheck, unit tests, regeneration, independent XML and SHA-256 checks, release-policy tests and generated-drift detection. A pull request or non-default branch never publishes. The release job runs only after validation succeeded on a push to this repository, checks out that same commit with full history, and verifies the XML and assets again. No deployment, npm publication or signing-key setup is involved.

| Trigger                           | Result after validation                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Default-branch push               | A prerelease for the push's HEAD, unless that commit already belongs to a managed stable release |
| Version tag push (`v*`)           | A stable release on that existing tag; no stable tags are ever manufactured                      |
| Feature branch, PR or deleted ref | No release or cleanup                                                                            |

Version names start with `v` and an ASCII letter or digit: e.g. `v1`, `v1.2.3`, `v2026-11-18` or `vNext`. Dot, plus, underscore and hyphen are allowed internally; ref-expression tricks, slashes, unsafe characters, trailing dot/.lock and overlong names are rejected. A stable tag is a publish instruction, so protect the default branch and version-tag namespace with repository rulesets and limit who may push tags. The job uses the ephemeral workflow token, write permissions only in the publisher, and no stored checkout credentials. Publishing is serialized (bounded GitHub Actions queue); failed/canceled historical runs can be rerun after investigation.

## Names and dates

For a commit made at 14:03:07 UTC, the tag has shape `pre-20261118T140307Z-<40-character-sha>`; its title is `20261118T140307Z · <short-sha> (preview)`. The UTC field uses Git **committer time**, not author time, tagger time, local time, build time, or release publication time. Names/tags therefore lexically sort by commit time. Full SHA disambiguates simultaneous timestamps. Preview releases never claim “Latest.”

GitHub controls its own Releases page: [the viewing guide](https://docs.github.com/en/repositories/releasing-projects-on-github/viewing-your-repositorys-releases-and-tags) describes a chronological view, **not** a selectable name-sort contract. Timestamped names make commit order visible, but cannot override that page's ordering when an old commit is built late. Do not republish history to force a different order. For a reproducible sorted list, use:

```sh
gh api --paginate repos/davidbasilefilho/basile-agc/releases --jq '.[] | select(.prerelease and (.tag_name | startswith("pre-"))) | .tag_name' | LC_ALL=C sort -r
```

## Assets and idempotency

Each publication attaches the two generated files and `manifest.json`. The GCam .agc and experimental standalone photo-only XMP retain their existing limitations. Asset names and content digests are verified against the checked-out files after publication; an existing matching release is verified rather than recreated. An existing draft, unexpected owner, wrong target, or missing/extra/different artifact fails closed. A network interruption after draft creation may leave a draft: inspect and reconcile manually rather than overwriting it. See [gh release create](https://cli.github.com/manual/gh_release_create) and the [release asset API](https://docs.github.com/en/rest/releases/assets).

## Pruning policy

A stable release must exist, be published by this workflow, match the tag and SHA, and have all three validated assets. Only then does cleanup take a complete, paginated release inventory. A candidate must satisfy **all** of these conditions:

1. Published, mutable, non-draft prerelease attributed to the GitHub Actions bot. Exact managed tag format, exact standalone ownership marker and embedded full commit SHA.
2. Exact local tag exists, peels to that commit (annotated tags are supported), and its timestamp agrees with the commit. Shallow history is rejected.
3. `git merge-base --is-ancestor <preview-sha> <stable-sha>` confirms reachability. Same SHA qualifies; unrelated/newer side branches do not. Dates, tag names, branch names and `target_commitish` do not substitute for ancestry. Squash-merged commits are not considered ancestors solely because their contents look similar.
4. Immediately before each delete, re-read the stable release/digests/tag, the candidate release by immutable numeric ID, and its current remote tag SHA. If any identity or ownership check fails, retain the candidate or abort. The API does not offer a cross-release transaction: do not concurrently edit managed releases/tags by hand.

Cleanup **deletes only the included generated prerelease record and its attached preview assets**. It never deletes Git tags, commits, branches, stable releases, manual/foreign prereleases or protected/immutable releases. A failed check never triggers a broader cleanup. Rerunning a verified stable-tag job can finish an interrupted cleanup. [GitHub release API](https://docs.github.com/en/rest/releases/releases) · [Actions concurrency and queue limits](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
