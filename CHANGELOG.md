# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Semantic Versioning for prerelease packages. No npm production release is
created by the repository's release-candidate workflow.

## [Unreleased]

### Added

- Fail-closed npm tarball size, unpacked-size, file-count, and required-artifact
  policy, including minimum drift floors, grounded in the validated
  `0.1.0-preview.1` package candidate.
- Manual, no-publish release-candidate workflow with compatibility, UI
  Automation, package-consumer, production dependency audit, checksum,
  CycloneDX SBOM, and provenance gates.
- Trusted-preview security, support, servicing, dependency-update, and repository
  governance policies.

## 0.1.0-preview.1 release candidate

### Added

- Initial `WinUIWindow` preview for Electron 43 with a native WinUI title bar,
  menus, context menus, dialogs, search, and documented `BrowserWindow`-like
  compatibility subset.
- Fail-closed PerMonitorV2 executable preparation and Windows App SDK 2.2 runtime
  contract.
- Windows compatibility, package-consumer, reliability, accessibility, and
  native UI Automation test coverage.
