# Trusted preview repository settings

These controls cannot be fully enforced from repository files. A repository
owner should complete and record this checklist before any npm publication.

## GitHub repository

- [ ] Protect `main` and release branches: require pull requests, at least one
  approving review, dismissal of stale approvals, resolved conversations, and
  no force pushes or deletions.
- [ ] Require the compatibility matrix, package consumer, Linux fallback, and
  trusted-preview release-candidate checks before merge; prevent administrator
  bypass except for documented incident recovery.
- [ ] Enable the dependency graph, Dependabot alerts, and Dependabot security
  updates. Weekly npm and GitHub Actions version updates are configured in
  `.github/dependabot.yml`.
- [ ] Enable GitHub Advanced Security secret scanning and push protection where
  the repository plan permits them.
- [ ] Enable private vulnerability reporting and verify the **Security > Report a
  vulnerability** flow described in `SECURITY.md`.
- [ ] Restrict Actions to GitHub-authored and verified actions, require actions
  to be pinned to a full commit SHA if organization policy supports it, and
  retain release-candidate artifacts for the review period required by the
  project.

## npm trusted publishing

- [ ] Decide the production package name and scope. The manifest currently uses
  unscoped `electron-winui`; no ownership or publication claim is implied.
- [ ] Create a protected GitHub environment for npm publication with required
  reviewers. The release-candidate workflow intentionally has no environment and
  no npm publish step.
- [ ] Configure npm trusted publishing for this repository, the eventual publish
  workflow filename, and the protected environment. Do not add a long-lived
  `NPM_TOKEN`.
- [ ] Decide the supported Windows client build and architecture floor, then
  update `SUPPORT.md` and the release matrix before production publication.

## Redistributed native binary review

The npm tarball redistributes unmodified x64 and ARM64
`Microsoft.WindowsAppRuntime.Bootstrap.dll` files from
`Microsoft.WindowsAppSDK.Foundation` 2.1.0, resolved by
`Microsoft.WindowsAppSDK` 2.2.0. The exact Foundation package license grants
redistribution for files binplaced by the Windows App SDK NuGet package,
including framework-dependent and self-contained deployments, subject to its
distribution requirements.

The DLLs in the validated package candidate byte-match the restored Foundation
package:

| Architecture | Size | SHA-256 |
| --- | ---: | --- |
| x64 | 394,040 bytes | `A63D0D7F5E3E863E0781D0A9467011598189F7149A169B91296FEA90A31E9906` |
| ARM64 | 402,232 bytes | `A8B314D0CD126A4F0A3C533FFED5626A458B71C99E924F9F44CAC3E6AD78DC9E` |

The npm dependencies are referenced through `package.json` rather than vendored
into the tarball; the locked production dependency manifests report MIT
licenses. The release-candidate CycloneDX SBOM records that dependency graph.

The Foundation 2.1.0 NuGet package contains `license.txt` but no `NOTICE.txt`.
The umbrella Windows App SDK 2.2.0 package contains a broader `NOTICE.txt`, but
the repository has not established that copying that entire notice is required
or sufficient for these two DLLs. No third-party notice text is invented here.
Legal review must decide whether the Foundation license itself, the umbrella
notice, additional end-user terms, or another attribution must ship before npm
publication. This is a release blocker, not a release-candidate build blocker.
