# NAVA v4.8.4 usability and account migration update

## Follow-up: repair PDF contrast and shut down

- [completed] Correct fenced-code contrast in the guide stylesheet.
- [completed] Regenerate and visually verify both PDF copies.
- [completed] Commit and push the documentation fix.
- [in_progress] Shut down Windows after all writes and verification complete.

## Goal

Ship and install a safe NAVA patch that removes remaining user-visible legacy branding, adds an in-app account/Tunnel migration workflow, and provides a beginner-friendly Thai guide without losing the current encrypted Runtime API key, tunnel profile, workspaces, or rollback path.

## SCQA

- **Situation:** NAVA v4.8.3 is installed and its local MCP plus ChatGPT Secure MCP Tunnel path has already passed end-to-end validation.
- **Complication:** Some user-facing text still says `lnwjud`, account replacement is not explained or easy to perform, and the existing instructions are fragmented.
- **Question:** What is the smallest safe update that makes NAVA easier to operate now and lets the owner move to another OpenAI account later?
- **Answer:** Release NAVA v4.8.4 with visible-brand cleanup, a Settings workflow that can securely replace the Runtime API key using the existing DPAPI-backed storage, a clear account migration checklist, and a concise Thai quick-start guide.

## Acceptance criteria

- [ ] App and installer report NAVA v4.8.4; no user-facing command/manifest text presents the product as lnwjud.
- [ ] Existing Runtime API key and tunnel profile survive an in-place upgrade.
- [ ] Settings can replace the Runtime API key without revealing the stored key or writing it to logs.
- [ ] Account migration guidance distinguishes same organization/workspace from a new organization/workspace.
- [ ] Current tunnel still reaches `ready` after install, and local MCP remains available.
- [ ] Relevant tests, typecheck/build, packaged-app check, and secret scan pass.
- [ ] Thai quick-start and troubleshooting guide is committed with the source and summarized in the Obsidian vault.
- [ ] Only task-owned files are staged, committed, and pushed to the NAVA remote.

## Phases

- [completed] Inspect the existing Settings/runtime-secret flow and visible branding surface.
- [completed] Implement the minimum v4.8.4 UI, account migration, and branding patch.
- [completed] Add/update tests and the Thai quick-start guide.
- [completed] Build, back up, install, and verify NAVA v4.8.4 end to end.
- [completed] Update Obsidian evidence, scan secrets, commit, and push task-owned changes.

## Safety boundaries

- Preserve DPAPI secret storage and never print, prefill, or commit a Runtime API key.
- Preserve the existing tunnel profile, SQLite settings, registered workspaces, permission profiles, and installer rollback copy.
- Keep internal `lnwjud` identifiers where changing them would break compatibility; only remove user-visible legacy branding.
- Do not weaken tunnel ownership checks or full-access safety controls.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| UI design-system search returned a noisy landing-page match | 1 | Use only its applicable dark-dashboard accessibility rules and preserve NAVA's existing visual system. |
| Public Desktop denied PDF creation for the current user | 1 | Keep the shared app shortcut unchanged and place the guide on the signed-in user's Desktop instead. |
| First manual esbuild invocation stripped quotes around `node:module` | 1 | Rebuilt with an argument array that preserves the exact ESM banner, then repackaged. |
| Full Vitest run collided with the live NAVA/tunnel global lock and timed out | 2 | Stopped the installed runtime and reran each lock-sensitive file serially; 63/63 passed. |
| Chrome headless returned without creating the PDF | 1 | Switched to Edge headless with an isolated profile; the 4-page PDF was generated successfully. |
