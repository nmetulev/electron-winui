# UIA fixture + WinAppCLI scripted test harness

This directory (plus `test/fixtures/uia-fixture-app.js` and
`test/fixtures/uia-fixture.html`) is a **dedicated, deterministic** Windows
UI Automation (UIA) test harness for this repo, built entirely on top of the
`winapp ui` command line (WinAppCLI). It runs separately from the existing
general test suite through `npm run test:uia`.

## What this is

- **`../fixtures/uia-fixture-app.js`** - a minimal, purpose-built Electron
  app (not a copy of any existing fixture) that opens a single
  `WinUIWindow` with:
  - a unique, greppable window title (`UIA Fixture <pid>`) for title-search
    testing
  - a full `MenuBar`: **File > Close**, **View > Reload**, **Actions >
    Ping**, a separator, **Actions > Show context menu**, **Actions > Show
    content dialog**
  - a native context-menu flyout (`Context Ping` / separator / `Context
    Info`)
  - a native `ContentDialog` (via `dialog.showMessageBox`) with three
    buttons (Accept / Maybe / Cancel)
  - the built-in title-bar search `AutoSuggestBox`
  - stdout markers for every action it performs (e.g.
    `ACTIONS_PING_CLICKED`, `CONTEXT_MENU_PING_CLICKED`,
    `CONTENT_DIALOG_RESULT:<payload>`,
    `TITLEBAR_SEARCH_CHANGED:<text>`, `TITLEBAR_SEARCH_SUBMITTED:<text>`) so
    the harness can assert real Electron-side events, not just UIA state.
  - it never self-closes and installs crash handlers, so it stays up for
    the whole battery and always leaves a clean stdout log behind.

- **`resolve-electron-executable.js`** - resolves (and, on first run,
  patches) the dev Electron executable the same way
  `test/window.test.js`/`test/smoke-app.js` do, via
  `../../dist/prepare`'s `prepareElectronExecutable()`. Run standalone it
  prints the resolved path as its only stdout line; any failure here is
  reported as a **fatal setup failure**, not a UIA assertion failure.

- **`run-uia-tests.ps1`** - the actual WinAppCLI scripted/batch test
  harness. A single, self-contained PowerShell script (no external test
  framework) that:
  1. Resolves the Electron executable, launches the fixture as a
     deterministic child process (following this repo's process-harness
     conventions - see "Deterministic process handling" below).
  2. Waits for the native `ElectronWinUI.MenuBar` UIA element before
     touching any UI. The fixture also emits the repository-standard
     `WINUI_WINDOW_READY:<pid>` marker for process-level diagnostics.
  3. Drives the fixture **exclusively** through `winapp ui` semantic
     `AutomationId`/`Name` selectors - **no pixel-coordinate assertions**
     anywhere in the script.
  4. Asserts, in order:
     - **Section A** - the window is discoverable by exact title and by a
       fuzzy/partial title search.
     - **Section B** - the `MenuBar` root and every top-level menu item
       (File, View, Actions) expose non-empty `AutomationId` + `Name`.
     - **Section C** - opening the native context-menu flyout surfaces its
       items with non-empty `AutomationId`/`Name`; invoking `Context Ping`
       closes the flyout **and** is observed as a real Electron-side event
       (`CONTEXT_PING_CLICKED` on the fixture's stdout).
     - **Section D** - opening the native `ContentDialog` surfaces its host
       with a non-empty `AutomationId`/`Name`; each of its three buttons is
       individually audited for the WinUI template AutomationIds
       `PrimaryButton`, `SecondaryButton`, and `CloseButton`; invoking one
       closes the dialog **and** is observed as a real Electron-side event
       (`DIALOG_RESULT:<expected index>`).
     - **Section E** - the title-bar search box exposes
       `AutomationId`/`Name`; typing into it with real synthetic keystrokes
       (`winapp ui send-keys --via send-input`, **not** `set-value`, per
       this CLI's own documented WinUI/XAML guidance) and pressing Enter is
       observed as real Electron-side `TITLEBAR_SEARCH_CHANGED:<text>` and
       `TITLEBAR_SEARCH_SUBMITTED:<text>` events.
     - **Section F** - an exhaustive audit re-checking every control this
       library assigns automation identity to (menu items, context-menu
       items, dialog host, search box) individually for a non-empty
       `AutomationId` **and** `Name`, so any regression in
       `src/accessibility.js`'s ID-assignment scheme is caught even if the
       feature-specific sections above happen to still pass.
  5. Captures a screenshot after every meaningful state change (initial
     window, context menu open, dialog open, post-search) into
     `artifacts/*.png` - suitable as CI artifacts.
  6. Always tears the fixture down (graceful `File > Close` first, then a
     PID-specific `Stop-Process` fallback) in a `finally` block, and always writes
     `artifacts/test-results.json`, even on a fatal setup failure.
  7. Exit codes: `0` = all checks passed, `1` = one or more assertions
     failed, `2` = fatal setup failure (couldn't resolve Electron/launch
     the fixture/see the ready marker) - checks never even ran.

- **`uia-fixture.test.js`** - a thin `node:test` wrapper (using this repo's
  existing, **unmodified** `test/helpers/run-process.js` `runProcess()`,
  the same helper `test/window.test.js` uses) that shells out to
  `pwsh.exe -File run-uia-tests.ps1` and asserts exit code `0`, surfacing
  full stdout/stderr and `artifacts/test-results.json` on failure.

## How to run it

Interactive / manual (recommended first, especially for debugging - keeps
the fixture window open after a failure via `-KeepOpen`):

```powershell
# Full run, default 20s per-check timeout, tears fixture down afterwards
pwsh -File test\uia\run-uia-tests.ps1

# Longer per-check timeout (useful on a slow/loaded machine), and leave the
# fixture window open after the run so you can `winapp ui inspect` it
# yourself afterwards
pwsh -File test\uia\run-uia-tests.ps1 -TimeoutMs 30000 -KeepOpen

```

As a Node test (CI-friendly; intentionally separate from `npm test`):

```powershell
npm run test:uia
```

Both entry points write `test\uia\artifacts\test-results.json` and PNG
screenshots to `test\uia\artifacts\` on every run (pass, fail, or fatal
setup failure), so a CI job can archive that directory as build artifacts
regardless of outcome.

## Deterministic process handling

The PowerShell harness launches the fixture the same deterministic way this
repo's `test/helpers/run-process.js` treats child processes elsewhere:
capture the PID from the launch, wait for the native MenuBar to appear in
UIA rather than using a fixed sleep, and guarantee teardown of that exact PID
(graceful app-level close attempted first, then a forceful kill) in a
`finally`/`catch` block so a failed run can never leave an orphaned
`Electron.exe`/fixture process behind. The Node wrapper layers this repo's
own `runProcess()` Win32 Job Object machinery on top (same as
`test/window.test.js`), so even a hard hang inside the PowerShell script
itself is bounded by `runProcess`'s existing timeout/kill behavior.

## ContentDialog platform boundary

`ContentDialog` exposes action text and styles, but not the action button
instances. The WinUI template owns those controls and names them
`PrimaryButton`, `SecondaryButton`, and `CloseButton`; UIA surfaces those
template names as stable AutomationIds. Section D asserts those exact IDs and
records `ControlType` and `ClassName` if a Windows App SDK version stops
surfacing them. It does not weaken the audit to Name-only selection or add a
custom dialog template.

WinUI surfaces the host's attached AutomationId on both the popup `Window`
peer and the nested `Group` peer. The host assertion targets the `Group`
peer explicitly, while the inspect snapshot retains both for diagnostics.

Only native elements this library deliberately identifies are audited.
Chromium content in the fixture is out of scope; this is a native XAML
surface audit, not a web accessibility audit.
