---
name: commit-message-format
description: Enforces the repository commit message format whenever the user asks to commit, amend, squash, or create git history. Use before every git commit command to prevent malformed commit messages.
---

# Commit Message Format

Use this skill for every request that creates or changes git commits.

## Required Format

This repository uses Conventional Commits:

```text
<type>[optional scope]: <description>
```

Allowed `type` values:

- `feat` - user-facing feature
- `fix` - bug fix
- `docs` - documentation only
- `style` - formatting only, no behavior change
- `refactor` - code change that is neither a feature nor a bug fix
- `perf` - performance improvement
- `test` - tests only
- `build` - build system or dependency changes
- `ci` - CI/CD changes
- `chore` - maintenance that does not fit another type
- `revert` - reverts a previous commit

Rules:

1. The first line MUST match:

   ```regex
   ^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+
   ```

2. Use lowercase type and scope.
3. Put a space after the colon.
4. Use an imperative, concise description.
5. Do not end the subject with a period.
6. If there is a breaking change, use `!` before the colon and explain it in the body.

## Before Committing

1. Run `git status --short`.
2. Review staged or unstaged changes enough to select the correct type.
3. Draft the message in the required format.
4. Validate the subject against the regex above.
5. Only then run `git commit`.

## Examples

Good:

```bash
git commit -m "feat: add account switcher extension"
git commit -m "refactor: reorganize account switcher source layout"
git commit -m "docs: add pi package installation guide"
git commit -m "chore: add commit message skill"
```

Bad:

```bash
git commit -m "Prepare pi package installation"
git commit -m "updated files"
git commit -m "Fix bug."
```

## If a Message Is Wrong

If the latest local commit has the wrong format and has not been pushed, fix it with:

```bash
git commit --amend -m "<correct conventional commit message>"
```

Never create another malformed commit to fix a malformed commit.
