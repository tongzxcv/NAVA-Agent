# Windows OCR helper and sparse identity

The standalone .NET 8 Windows OCR helper uses Windows.Media.Ocr only when
Windows grants package identity. The standard NAVA NSIS installer does not
automatically grant that identity. Until registration succeeds the capability
reports package_identity_required.

## Prepare without modifying Windows trust or app registrations

From repository root on Windows with .NET 8 SDK and Windows SDK:

    powershell -NoProfile -File scripts\build-windows-ocr.ps1
    powershell -NoProfile -File scripts\register-windows-ocr.ps1

By default, the registration script validates the EXE's embedded identity and
packs an unsigned sparse MSIX in native/windows-ocr/obj. It does not trust
certificates, install software or call Add-AppxPackage.

## Signed registration is a separate explicit action

The publisher of the sparse MSIX and the EXE-embedded identity must match the
exact Subject of the signing certificate. Rebuild with -Publisher or set
NAVA_OCR_PUBLISHER when using a production signing certificate.

Registration requires an appropriately trusted PFX and an installed OCR
external directory containing the EXE and Assets folder. Pass -ReleaseCertPfx,
-ReleaseCertPassword, -ExternalLocation and BOTH -Register and
-ConfirmRegistration to scripts/register-windows-ocr.ps1. This script does not
trust self-signed certificates or remove any existing package to force updates.

A signed NAVA Installer does not itself register a sparse identity package.
Only claim full OCR readiness when the installed helper passes a live probe.
Never check private keys into the source repository.

Reference: https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps
