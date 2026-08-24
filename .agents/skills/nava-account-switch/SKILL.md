---
name: nava-account-switch
description: Safely move NAVA Secure MCP Tunnel to another OpenAI account, organization, or ChatGPT workspace while preserving the current profile and rollback path. Use when changing email, organization, Runtime API key, or Tunnel association.
---

# NAVA Account Switch

Separate account identity, organization permissions, Tunnel association, and the local Runtime API key.

## Prepare

1. Run `diagnostic_bundle_create` and record only non-secret profile/version/health metadata.
2. Confirm whether the new login uses the same OpenAI organization and ChatGPT workspace. A different organization normally requires a key issued from that organization and a compatible Tunnel association.
3. Preserve the current DPAPI-protected key/profile through NAVA's existing backup path. Never copy the plaintext key into chat, logs, source, Git, or Obsidian.

## Switch

1. Replace the Runtime API key through NAVA Settings as the same Windows user who owns the DPAPI secret.
2. Verify the key has the required Tunnel read/use permissions and that the Tunnel is associated with the intended ChatGPT workspace.
3. Run Doctor before starting the Tunnel.
4. Start or reconnect only after explicit user confirmation because this changes live external connectivity.
5. Refresh the connector and use a new ChatGPT conversation when the old conversation advertises stale tools.

## Verify and rollback

- Verify local MCP health, Tunnel live/readiness, and one read-only `workspace_list` call.
- If verification fails, stop after bounded diagnostics and restore the preserved profile/key through the supported UI; do not edit encrypted secret files manually.
