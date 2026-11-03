# TradeAssist workspace rules

## Keep agent QA out of the user's workspace

- Never run synthetic QA conversations in the user's normal TradeAssist browser origin/profile. This includes manual text tests, feedback-button tests, call-saving tests, and live-call event tests.
- Use deterministic in-memory fixtures first. Browser QA must use a separate browser profile or a separate local port with its own empty browser storage and fictional company fixtures. A new tab on the same origin is not isolated.
- Do not import the user's call history, unfinished draft, Company Brain learning, buyer memory, or speaking-style examples into a QA workspace. Use the minimum approved company reference facts needed for a particular test.
- Do not save, rename, append to, or rate the user's calls for testing. In particular, New call automatically saves an unfinished conversation: do not use it to advance agent QA in the user's workspace.
- Keep agent-generated overrides and golden examples out of the user's Company Brain and shared General Playbook unless the user specifically asks to adopt the content. Preserve the user's own test calls and corrections.
- Store QA evidence under outputs/ or in disposable isolated storage. After a browser test, verify the user's call history and draft were unchanged. Never use QA/Test prefixes as a blanket rule for removing user data.
- Do not add Simulator Mode as a workaround unless the user explicitly requests it.

## GitHub development workflow

- Follow `DEVELOPMENT.md`. Keep the GitHub repository private. Verify `origin` and the signed-in account before publishing; do not substitute a public repository.
- Start each fix or feature on a `codex/<short-description>` branch. Preserve existing changes and history. Do not make future development commits or push changes directly to `main`.
- Run the relevant offline checks and inspect the diff. Paid AI or device tests require task authorization and an isolated workspace; never use customer calls as fixtures.
- Before every push, review the staged files, every commit being published, and reachable history for secrets and private data, including files that were previously tracked. An ignore rule does not remove historical content.
- Keep API keys, all `.env` files, customer/company records and documents, transcripts, client memory, learning examples, local audio, QA outputs and browser/runtime state off GitHub. Only deliberately shareable synthetic unit-test fixtures may be committed. Never copy a real call into a test.
- Stage explicit reviewed paths rather than blindly staging everything. Preserve excluded local data. Do not reset, clean, rewrite history or delete user records to make a push pass. Do not force-push, mirror-push or push all refs.
- Push only the intended branch and open a pull request describing the problem, final change, checks and limitations. Attach every created pull request to the Codex task using `attach_artifact`, and report its link. Merge only when authorized.
- If a secret or private record is already in history, stop publication and explain the concrete finding without printing its value. Keep a local recovery copy and obtain authorization before changing publication history.
