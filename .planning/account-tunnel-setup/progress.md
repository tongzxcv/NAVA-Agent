# Progress

- 2026-09-02: Reproduced configuration failure from NAVA UI.
- 2026-09-02: Confirmed failure occurs before profile update; error path drops Windows separators.
- 2026-09-02: Isolated source boundary and selected minimal POSIX-argument fix.
- 2026-09-02: Patched `tunnel-controller.ts` to normalize `--mcp-command` before init and added a focused regression test.
- 2026-09-02: Added `--force` to the init boundary, built with pinned Node 24/pnpm, and passed the desktop test suite (245/245) plus typecheck.
- 2026-09-02: Packaged `win-unpacked`, backed up the prior install, installed to `D:\Program` and `D:\Program Files\NAVA Agent`, and verified SHA-256 parity for the executable and `resources/app.asar`.
- 2026-09-02: Replaced the old DPAPI runtime key with the new-account key and configured the new tunnel profile with the new organization context; secret value was never printed or persisted in the repository.
- 2026-09-02: Verified local runtime `/healthz=200 live` and `/readyz=200 ready`; one NAVA process owns one tunnel-client child. Tunnel metadata bootstrap succeeded and transient polling recovered.
- 2026-09-02: Associated the tunnel with the new ChatGPT workspace, refreshed the tunnel picker, created the `NAVA Agent` development app, connected it, and verified the connector tool catalog was discovered.
- 2026-09-02: Verified Windows Developer Mode is enabled and rebuilt the NSIS installer from a non-elevated shell successfully; the previous `winCodeSign` symbolic-link privilege failure no longer reproduces.
