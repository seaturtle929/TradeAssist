# Developing TradeAssist

TradeAssist code belongs in its private GitHub repository. Calls, client records, Company Brain data, imported documents, learning history and local QA evidence stay on the Mac. A Git clone does not restore those records; use the application's local backup/export workflow for data recovery.

The user chose **GitHub Desktop for pushes**. Codex prepares a branch and commit, runs checks, and publishes through Desktop before opening the PR. Do not replace that step with terminal `git push`. If Desktop controls are unavailable, leave the reviewed branch ready and ask for its **Publish branch / Push origin** click. Read-only CLI/API inspection and PR creation can still be used without changing this transport preference.

## Make a change

1. Inspect `git status`, the current branch and the existing diff. Preserve unfinished work. Read `AGENTS.md` before testing.
2. Start a branch named `codex/<short-description>` for each fix or feature. Use the appropriate base without discarding local changes. Future development goes through pull requests rather than direct `main` pushes.
3. Implement the focused change and run relevant checks. The shared offline checks are:

   ```sh
   npm run check:types
   npm run check:privacy
   npm run lint
   npm run build
   ```

   Run focused tests that actually ship with the repository when they cover the change. Local QA runners and private evidence are not part of the published project. Do not run paid AI calls, capture a microphone or exercise user storage without task authorization. Browser tests need an isolated origin/profile and synthetic data, following `AGENTS.md`.
4. Review the final diff and stage only explicitly reviewed paths. Keep tests synthetic and safe to share. Commit a concise description of the resulting change.

## Review before publishing

- Confirm the authenticated GitHub account, the intended `origin` and **private** repository visibility. Never put credentials into a remote URL or command output.
- Review the index and every commit that the push would publish, including reachable earlier history. A file removed from the current tree can still be uploaded through an earlier commit.
- Exclude API keys, `.env` files, private configuration, company documents, calls, client/contact records, transcripts, learning datasets, local audio and test data, QA evidence, backups, browser state and runtime files. `.gitignore` is a convenience, not a privacy audit.
- Do not publish material copied from real calls inside source code, tests or documentation. Shareable tests must use intentionally synthetic fixtures without customer facts.
- If tracked history contains sensitive material, stop before pushing and resolve it with the user. Preserve a local recovery copy; never silently rewrite their history. The initial GitHub setup's local recovery material is under `outputs/github-setup-2026-11-03/` and must remain excluded.

Push only the reviewed branch. Do not use force pushes, mirror pushes or commands that publish all refs. Do not reset, clean or remove local data as a shortcut.

Run `node scripts/repository-privacy-check.mjs --history <branch>` before pushing. It checks every reachable commit, not just changed files. The local setup enables `.githooks` through `git config core.hooksPath .githooks`; run that once in a new clone. The pre-commit check examines the full index, and the pre-push check scans the selected history and blocks direct main pushes. They complement manual review; pattern checks cannot prove that arbitrary business text is safe to publish.

Local deployment bindings in `.openai/hosting.json` are optional and remain ignored. Configure deployment bindings and AI credentials locally when needed. Do not copy another person's runtime directory to make a clean clone work.

## Open a pull request

Describe the concrete problem and new behavior, then list checks performed and any meaningful limitations. Include whether a check used a real model or synthetic/offline inputs when relevant. Keep private logs and customer examples out of the description and attachments. Use the repository's pull request template.

Attach the created pull request to the current Codex task with `attach_artifact` and give the user its link. Merge only when the user authorizes it. After merging, keep local application data intact when updating or restarting the app.

## Validation baseline

At the November 3 GitHub setup, a clean export passed TypeScript and the production build without local deployment bindings. Privacy checks covered the index and every published commit; the original recovery history was rejected by the upload guard as intended. The existing full-workspace lint baseline includes 43 errors and 9 warnings in `app/workspace.tsx`. Report those separately from any new diagnostics, and run focused lint for touched files. Do not claim that full-project lint passed.

## Local secrets and application data

The app reads server credentials locally; configure them outside Git. Never print a full API key, include it in a diagnostic bundle or paste it into a pull request. When identification is necessary, show only a masked last-four-character suffix.

Browser localStorage/IndexedDB, runtime persistence, company imports and isolated test workspaces are separate from source control. Preserve them during branch changes and restarts. Tests must not write calls, feedback or Golden Moments into the user's normal workspace.
