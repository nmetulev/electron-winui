# Trusted preview support

`electron-winui` is an experimental, pre-1.0 preview. Support is best effort
through GitHub issues; there is no SLA, paid support commitment, or long-term
servicing promise. Security reports follow [SECURITY.md](SECURITY.md).

## Release-gated matrix

The release-candidate workflow gates the following surfaces:

| Surface | Release-gated coverage |
| --- | --- |
| Host | GitHub-hosted `windows-latest` x64 runner |
| Node.js | 22.12.0 and 24 |
| Electron | 43.0.0 and 43.4.0 |
| Native UI Automation | Node.js 24 with Electron 43.4.0 on x64 |
| npm consumer | Clean install and execution on Windows x64 with Electron 43.4.0 |
| Native payloads | x64 execution; x64 and ARM64 bootstrap artifact presence |
| Non-Windows fallback | Linux hosted runner with Electron 43.4.0 under Xvfb |

The matrix does not establish support for Windows client SKUs, Windows 10 or 11
build floors, ARM64 execution, x86, macOS behavior, Electron versions outside
43, or Node.js versions outside the matrix. `engines.node` permits Node.js
22.12.0 or newer, but versions not listed above are not release-gated. The
project owner must choose a Windows client and architecture support floor before
a production release.

## Deployment and servicing

- **Framework-dependent, unpackaged:** the package bootstraps the exact Windows
  App SDK major/minor contract recorded in the tarball. The application owner
  must provision and service the matching Windows App Runtime framework.
- **Framework-dependent, packaged:** the application manifest or package graph
  must resolve the matching Windows App Runtime framework. Packaged processes do
  not run this package's bootstrap path. Runtime servicing follows the
  application's Store, App Installer, or enterprise deployment policy.
- **Self-contained, packaged:** the application owner must stage and service the
  complete matching Windows App SDK payload. The npm package includes only the
  architecture-specific bootstrap DLLs and is not a self-contained runtime.
- **Self-contained, unpackaged:** not supported in this preview. A supported
  initialization path depends on corresponding capability in `dynwinrt`; do not
  infer support from the presence of bootstrap DLLs in the tarball.

Applications own OS, Electron, Windows App SDK, and transitive dependency
servicing. Preview fixes are delivered only in a new package version; existing
tarballs are immutable.

## Versioning and deprecation

The package follows SemVer with prerelease versions. Before 1.0, a minor release
may contain breaking API or deployment changes; patch releases are intended for
compatible fixes. Deprecations will be called out in [CHANGELOG.md](CHANGELOG.md)
and, when practical, remain for at least one subsequent preview release. Urgent
security or platform-correctness changes may remove unsafe behavior sooner.
