# Windows stdio timeout recovery

## Confirmed failure

On 2026-09-12 the installed tunnel client was `0.0.12+881c9a8fed7cccbe6607cd419863bbca506b8215`.
Its main MCP dispatcher stopped forwarding calls after a response deadline. The
tunnel and private Node child remained alive; `/healthz` and `/readyz` still
returned 200. Local desktop HTTP MCP continued working.

The recorded sequence (UTC+07) was:

- `search_text` started at 22:42:20.213 and completed at 22:45:20.972.
- The tunnel dropped the expired command at 22:44:19.7058806.
- The first 502 followed at 22:44:19.9939969, with `client_internal`,
  `transport_error_kind=unknown`, `upstream_response_received=false` and RPC ID 0.

An isolated loopback control-plane fixture using the actual original tunnel
binary reproduces the failure with no NAVA runtime: ID 0 succeeds, ID 0 times
out, subsequent ID 0 calls return 502. Sending a different ID lets the reader
drain the retired response and restores ID 0. The serialized transport rejected
the reused ID before reading, so callers repeatedly using ID 0 could never drain
the response that would clear its tombstone. This is not evidence of EPIPE,
process death, an EA project problem, or a Command Room binding problem.

## Fix and deployment dependency

`scripts/patches/tunnel-client-0.0.12-nava-recovery.patch` applies to the exact
upstream commit above. It gives a request colliding with a retired ID a fresh
wire ID and restores the caller's original ID on the matching response. Late
responses remain filtered. The patch includes the regression test.

It also adds a loopback-only `GET /api/mcp-health` endpoint that sends `ping`
through the **same serialized dispatcher transport** as connector calls:

- 200/live: matching response received;
- 429/busy: another request owns the serializer; do not interrupt it;
- 503/unhealthy: the request path did not respond successfully.

No credentials, request contents or session identifiers are exposed by this endpoint.
The probe has bounded queue acquisition and response deadlines. Timed-out probes
are retired without closing shared pipes.

Deploy the patched tunnel binary together with this desktop build. This is a
local patch, not an official upstream release. The desktop package does not
replace an independently installed tunnel client. Do not replace it with an
unpatched client and expect the request-path health endpoint to exist.

The desktop requires observed process, MCP and request-path health for green
status. It debounces failures for at least three observations and ten seconds,
retains its existing tunnel ownership lock, verifies process identity before
terminating its owned tree, and serializes reconnects with Start/Stop. Retry
backoff is bounded; the budget resets only after sustained observed health,
not merely because a PID has survived. Exhaustion is explicitly disconnected
and produces a needs-attention notification. A busy dispatcher is unknown,
not green, and is not restarted just for being busy.

Recovery never calls pairing, join, rebind, takeover or epoch mutation APIs.
The desktop's legacy Electron stdio bootstrap is not the deployed private-Node
entrypoint. Removing its EPIPE shutdown would not fix this defect.

## Rebuild and verify

Use Node 24.x for the NAVA build and package. The verified local runtime is
`E:\AI_CACHE\bin\node.exe` (24.19.0), not `E:\AI\_CACHE\bin\node.exe`.
The upstream tunnel uses Go 1.26.2 or newer as specified by its `go.mod`.

Upstream archive:
`https://codeload.github.com/openai/tunnel-client/zip/881c9a8fed7cccbe6607cd419863bbca506b8215`

Archive SHA256:
`52D484962C4A46DEA5299251636C37418A7B4F7884CED201B9E318415C2B662D`

In an extracted, isolated upstream checkout:

```powershell
git apply --check C:/Users/Endlessly/lnwjud/scripts/patches/tunnel-client-0.0.12-nava-recovery.patch
git apply C:/Users/Endlessly/lnwjud/scripts/patches/tunnel-client-0.0.12-nava-recovery.patch
go test ./pkg/mcpclient ./pkg/dispatcher/... ./pkg/adminui -skip UnixSocket -count=1
go build -trimpath -buildvcs=false -o ../tunnel-client.exe -ldflags '-X github.com/openai/tunnel-client/pkg/version.GitSHA=881c9a8-nava-recovery1' ./cmd/client
```

The upstream Unix-socket tests require `/tmp` and were excluded on this Windows
host. All selected Windows transport, dispatcher and admin tests must pass.

From the NAVA repository, pass the isolated binary path to both checks:

```powershell
node scripts/diagnostics/test-tunnel-retirement.mjs <isolated-tunnel-client.exe>
node scripts/diagnostics/test-tunnel-controller-recovery.mjs <isolated-tunnel-client.exe>
pnpm --filter @lnwjud/desktop test
pnpm typecheck
pnpm --filter @lnwjud/desktop package:windows
```

The first script verifies timeout followed by ID reuse without restart. The
second runs the actual controller, ownership lock and tunnel against a separate
loopback control plane, simulates an unresponsive child and then child death,
and asserts automatic recovery plus notification events. Its data, profile and
dummy credentials are isolated. It uses ports 18081/18082; do not run these two
fixtures concurrently with another copy using those ports.

Before production deployment, back up every replaced file, including the external
tunnel executable. Compare authority/epoch, pairing-secret and workspace hashes
before and after. Do not copy fixture databases or profiles into production.
