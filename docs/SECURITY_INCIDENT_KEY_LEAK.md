# Security runbook — leaked OpenAI API key

## Incident summary

- **What leaked:** an OpenAI API key (`sk-proj-XOEa…`, redacted) committed in
  plaintext in `COMPLETE_DEPLOYMENT_PACKAGE.md`.
- **Where it lives:** introduced in commit `78f0003` ("Add complete deployment
  package documentation for n8n"). That commit is **the current tip of `main`**
  and the merge base of the feature branch — so the key exists in the history
  of *every* ref, and in any clone or fork made since it was pushed.
- **Current state:** the key was redacted from the working tree in commit
  `e66f7c8` on `claude/saas-mvp-architecture-178w5j`. Redaction does **not**
  remove it from history.

## Step 0 — Rotate the key (mandatory, do this first)

History rewriting is hygiene; **rotation is the actual remediation**. The repo
is public, so the key must be treated as compromised regardless of any cleanup.

1. Go to https://platform.openai.com/api-keys
2. **Revoke** the leaked key.
3. Create a replacement and store it only in `.env` (git-ignored) or a secrets
   manager. Never commit it.

Everything below is optional until Step 0 is done; nothing below matters if
Step 0 is skipped.

## Why a branch-only purge is not enough

The key-bearing commit `78f0003` **is `main`'s tip**. Object-level evidence:

```
$ git rev-parse <commit>:COMPLETE_DEPLOYMENT_PACKAGE.md
78f0003 (main tip)      c3d1cd1…  ← the ONLY blob containing the key
62fcaf5 (branch)        c3d1cd1…  (same blob — file untouched)
f9467d0 (branch)        c3d1cd1…  (same blob — file untouched)
e66f7c8 (redaction)     b999da5…  (clean)
```

The secret exists in exactly one blob, introduced by `main`'s tip commit.
Therefore:

- **Rewriting only the feature branch removes references, not the blob** — it
  stays fully retrievable from `main`. Zero security gain.
- A branch rewrite from the root would also detach the branch from `main`'s
  history and break the open PR's diff base.
- **Merging the PR adds no new copies of the key** — the blob already lives in
  `main`'s object store; the branch's redaction commit only improves the
  working tree going forward.

The only effective purge rewrites **all refs**, including `main`.

## Option A (recommended) — coordinated rewrite of all refs

Uses [`git-filter-repo`](https://github.com/newren/git-filter-repo) (the
maintained successor to `filter-branch`). Run locally, during a quiet window,
after announcing a freeze to any collaborators.

```bash
# 0. Key already rotated (Step 0). Announce a push freeze.

# 1. Install the tool
pip install git-filter-repo

# 2. Work on a fresh mirror clone (never your daily working copy)
git clone --mirror https://github.com/webbdinero/n8n-automated-workflows.git purge.git
cd purge.git

# 3. Replacement rules: map the full literal key to a marker
#    (put the complete leaked key on the left of ==>)
cat > ../replacements.txt <<'EOF'
sk-proj-<FULL-LEAKED-KEY-HERE>==>***REMOVED***
EOF

# 4. Rewrite every ref (main, feature branch, tags)
git filter-repo --replace-text ../replacements.txt

# 5. Verify the key is gone from all history BEFORE pushing
git log --all -S 'sk-proj-' --oneline        # expect: no output
git grep 'sk-proj-' $(git rev-list --all) || echo "clean"

# 6. Force-push the rewritten refs
git remote add origin https://github.com/webbdinero/n8n-automated-workflows.git
git push --force --all
git push --force --tags
```

### After the push

1. **Every collaborator re-clones.** Old clones still contain the secret and a
   stale `git push` from one can re-introduce the old commits.
2. **Re-anchor the open PR.** SHAs change on both `main` and the branch;
   GitHub usually keeps the PR attached to the branch name, but verify the
   diff base and re-open/re-create if it broke.
3. **Ask GitHub Support to purge cached views** (commits remain reachable by
   old SHA via the API/UI cache until purged):
   https://support.github.com/ — request removal of cached commits for the
   repository.
4. **Delete or coordinate forks.** Forks retain the original history; the
   Support request above can cover fork network detachment.
5. Re-protect branches / re-enable any CI that was frozen.

### Risks introduced by the rewrite, and mitigations

| Risk | Mitigation |
| --- | --- |
| All commit SHAs change; old clones diverge | Freeze pushes, have everyone re-clone, never merge from a pre-rewrite clone |
| Open PR breaks or shows a wrong diff | Verify/recreate the PR after pushing; branch names are preserved |
| Old SHAs still served by GitHub cache | GitHub Support purge request |
| Forks still contain the key | Support request / fork owners re-clone |
| A stale local repo force-pushes the secret back | Short-lived branch protection requiring linear history from the new root |
| Rewrite gives false confidence | Step 0 (rotation) is the real fix; assume the key was scraped the day it was pushed |

## Option B — branch-only rewrite (not recommended)

Same procedure with `--refs claude/saas-mvp-architecture-178w5j` on the
`git filter-repo` call and a force-push of only that branch. Documented for
completeness; per the analysis above it does **not** remove the secret from
the repository and damages the PR topology. Use only if `main` must remain
untouched for external reasons, and treat it as cosmetic.

## Prevention

- Secrets live in `.env` (already git-ignored) or a secrets manager.
- Enable GitHub **secret scanning + push protection** on the repository
  (Settings → Code security). OpenAI-format keys are detected natively.
- Optional: a pre-commit hook such as `gitleaks protect --staged`.
