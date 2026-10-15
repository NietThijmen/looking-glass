---
name: fix-ci
description: Find out why CI is failing on the checked-out pull request branch, fix the cause, and verify the fix locally. Use when a pull request has failing checks.
disable-model-invocation: true
---

# Fix CI

The pull request's branch is checked out and at least one of its checks is failing. Find the cause, fix it in the code, and prove the fix locally.

## Steps

1. **List the failing checks.** Run `gh pr checks <number>` (or `gh run list --branch <head> --limit 5`). If `gh` is unavailable, use the check URLs you were given and ask the user to paste the failing log.
2. **Read the failing logs.** Use `gh run view <run-id> --log-failed`. Find the first real error, not the noise after it.
3. **Reproduce locally.** Look at the repo's workflow files in `.github/workflows` and `package.json` scripts. Run the same command CI ran (typecheck, lint, tests, build) and confirm it fails the same way.
4. **Fix the cause.** Change the code, test, or config that is actually wrong. Keep the diff small.
5. **Verify.** Re-run the failing command until it passes, then run the other checks CI runs so you do not trade one failure for another.

## Rules

- Fix the cause. Do not skip, delete, or loosen a test, lint rule, or type check to turn CI green.
- A flaky or infrastructure failure (network error, runner outage, rate limit) is not a code bug. Say so and stop; do not edit code to work around it.
- Do not commit, push, or force-push unless the user asks. Leave the fix in the working tree.
- If several checks fail for unrelated reasons, fix them one at a time and report each.

## Report

End with: the failing check, the root cause in one or two sentences, what you changed, and the commands you ran to verify it.
