---
name: nava-network-recovery
description: Diagnose and recover Windows networking safely with transactional rollback for DNS, Wi-Fi, captive portals, Cloudflare/WARP, Tailscale, routes, proxy, and adapter state. Use when internet access, login portals, DNS, VPN overlays, or routes break after a change.
---

# NAVA Network Recovery

Every network mutation must have a captured before-state and rollback path.

## Diagnostic Order

1. Record adapters, DHCP/static state, DNS servers, default gateways, routes, proxy, Tailscale/WARP state, and relevant interface metrics.
2. Test layers separately: link -> gateway -> raw IP reachability -> DNS resolution -> HTTPS -> captive portal -> overlay VPN.
3. Distinguish DNS failure from routing, proxy, certificate, firewall, or captive-portal failure.
4. For Wi-Fi requiring a captive portal, preserve the ability to reach plain HTTP before forcing encrypted DNS/VPN behavior.
5. Change only one layer per experiment.

## Transaction Pattern

`CAPTURE BEFORE -> APPLY ONE CHANGE -> VERIFY -> COMMIT OR ROLLBACK`

If verification fails, restore the captured DNS/routes/proxy/adapter setting before trying another hypothesis.

## Rules

- Never replace all interface DNS/route settings without preserving exact previous values.
- Do not flush/reset every Windows networking component as a first response.
- Do not assume Cloudflare/WARP and Tailscale are interchangeable; test each layer explicitly.
- After recovery, verify both ordinary internet access and any required overlay/VPS route.
- Record the final intended configuration so later troubleshooting can distinguish drift from design.
