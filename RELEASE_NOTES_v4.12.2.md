# NAVA Agent v4.12.2 - Source Pre-release

**Channel:** Pre-release, source only. Stable release remains **v4.12.1**.

NAVA v4.12.2 is deployed on the maintainer's own Windows machine as a
locally signed build. The desktop and Windows OCR features listed below
have been exercised locally. This GitHub release intentionally does NOT
provide a general-public Windows installer, latest.yml or blockmap.

## Changes

- Managed Chrome CDP on-demand auto-recovery: bounded retries, backoff,
  single-flight Chrome launch, tab rebinding and no replay of interrupted
  DOM side effects.
- Updater and backup fail-closed guards with clearer failed release
  lookup/status paths and safe local backup behavior.
- Native Windows OCR helper built with .NET 8, an embedded sparse-package
  identity and Windows SDK contract compatibility. Explicit local
  registration supported through the separate register-windows-ocr.ps1 script.
- Windows packaging includes native OCR assets and locked dependencies.
- Process-termination policy hardening with tests and release-signing checks.

## Validation

- Windows x64 Candidate desktop build, TypeScript, ESLint, packaging,
  acceptance, integration and release-extra tests passed locally.
- Local self-signed installer and OCR helper verified with Windows
  Authenticode on the maintainer's machine only.
- Windows OCR sparse-package registration and live text recognition from a
  synthetic image passed in the local Windows environment.
- Isolated packaged MCP stdio test and Chrome CDP recovery smoke passed.

## Why there is no Windows installer attached

A local Code Signing certificate is not trusted on other computers.
The public GitHub Actions repository currently has no signing credentials.
A public release installer without trusted signing fails the project's
release gate. CI Windows artifact publication is opt-in through the
NAVA_PUBLISH_SIGNED_WINDOWS_RELEASE repository variable and requires
trusted signing credentials plus a matching OCR publisher.

Do not treat the maintainer's locally signed EXE/MSIX as a public installer.
Source archives are provided by GitHub for reproducibility and review.
Stable GitHub auto-update users should remain on v4.12.1 until a signed
Windows binary release is approved.

This is a source-only pre-release, not a general-availability Windows update.
