<#
.SYNOPSIS
  Deterministic WinAppCLI (`winapp ui`) scripted/batch UI Automation harness
  for the dedicated test/fixtures/uia-fixture-app.js Electron+WinUI fixture.

.DESCRIPTION
  Launches the purpose-built UIA fixture (a minimal Electron app using this
  repo's WinUIWindow, MenuBar, native context-menu flyout, ContentDialog and
  title-bar search box), waits for the native XAML island to be ready, then
  drives it exclusively through `winapp ui` semantic AutomationId/Name
  selectors (no pixel-coordinate assertions) to verify:
    - the fixture window is discoverable by title (exact + fuzzy)
    - the MenuBar root and its top-level items expose non-empty
      AutomationId + Name
    - a native context-menu flyout (WinUI MenuFlyout) opens, exposes its
      items via AutomationId/Name, and clicking an item both closes the
      flyout and is observed as a real Electron-side event (stdout marker)
    - a native ContentDialog opens, exposes its host via AutomationId/Name,
      and its Primary/Secondary/Close buttons are audited for AutomationId
      (this repo does not currently assign one - see README "Known gaps");
      invoking a button both closes the dialog and is observed as a real
      Electron-side event (stdout marker) with the expected response index
    - the title-bar search AutoSuggestBox exposes AutomationId + Name, and
      typing into it via real synthetic keystrokes (`send-keys --via
      send-input`, NOT `set-value`) triggers the Electron-side
      'titlebar-search-changed' / 'titlebar-search-submitted' events
    - every control this library assigns automation identity to is
      individually re-audited for a non-empty AutomationId + Name

  Follows this repo's deterministic process-harness conventions: the
  fixture is launched as a bounded child process, all interaction is via
  `winapp ui` polling/wait-for (never fixed sleeps as the source of truth),
  and teardown has a PID-specific forced-stop fallback in a `finally`
  block. The Node wrapper additionally runs this script through the
  repository's existing Job Object process harness, so its complete process
  tree is terminated if the script hangs.

.PARAMETER TimeoutMs
  Timeout, in milliseconds, for the native XAML island readiness wait and
  for each individual `wait-for` assertion. Default: 20000.

.PARAMETER KeepOpen
  Skip teardown of a fixture this script itself launched, leaving it
  running for manual follow-up inspection with `winapp ui`.

.OUTPUTS
  Exit code 0 when every assertion passes, 1 when one or more assertions
  fail, 2 on a fatal setup failure (Electron executable could not be
  resolved/patched, or the fixture never reached a native-XAML-ready
  state) that made the rest of the battery meaningless to attempt.
  Always writes test/uia/artifacts/test-results.json with structured
  pass/fail/skip detail, plus PNG screenshots and raw `inspect --json`
  snapshots for independent human review.
#>
param(
  [int]$TimeoutMs = 20000,
  [switch]$KeepOpen
)

$ErrorActionPreference = 'Continue'
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$artifactsDir = Join-Path $scriptDir 'artifacts'
$fixtureAppPath = Join-Path $repoRoot 'test\fixtures\uia-fixture-app.js'
$resolverScriptPath = Join-Path $scriptDir 'resolve-electron-executable.js'
$winappCmd = Join-Path $repoRoot 'node_modules\.bin\winapp.cmd'
if (-not (Test-Path $winappCmd)) {
  # Fall back to whatever `winapp` resolves to on PATH if the local bin
  # shim is unexpectedly missing (e.g. a differently-laid-out checkout).
  $winappCmd = 'winapp'
}

New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null
$stdoutLog = Join-Path $artifactsDir 'fixture-stdout.log'
$stderrLog = Join-Path $artifactsDir 'fixture-stderr.log'
$resultsJsonPath = Join-Path $artifactsDir 'test-results.json'
# Never let a failed/partial run leave stale evidence that looks current.
Get-ChildItem -Path $artifactsDir -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -ne '.gitignore' -and (
      $_.Extension -eq '.png' -or
      $_.Name -like 'inspect-*.json' -or
      $_.Name -in @('fixture-stdout.log', 'fixture-stderr.log', 'test-results.json')
    )
  } |
  Remove-Item -Force -ErrorAction SilentlyContinue

$pass = 0
$fail = 0
$results = @()
$fixtureProcess = $null
$ownsFixtureProcess = $false
$fatalError = $null

function Write-Result {
  param([string]$Name, [string]$Status, [string]$Detail = '')
  $script:results += [ordered]@{ name = $Name; status = $Status; detail = $Detail }
  $color = if ($Status -eq 'PASS') { 'Green' } elseif ($Status -eq 'SKIP') { 'Yellow' } else { 'Red' }
  Write-Host ("[{0}] {1}{2}" -f $Status, $Name, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor $color
}

function Invoke-UiaCheck {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Script)
  try {
    $LASTEXITCODE = 0
    $output = & $Script 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "$output"
    }
    $script:pass++
    Write-Result -Name $Name -Status 'PASS'
  } catch {
    $script:fail++
    Write-Result -Name $Name -Status 'FAIL' -Detail "$_"
  }
}

# Runs `winapp ui <args> --json`, returns the parsed object. Stderr is kept
# separate from stdout so advisory/log text can never corrupt JSON parsing.
# Throws with the raw stdout/stderr on failure or on parse errors, so
# `Invoke-UiaCheck` surfaces the real CLI output rather than a swallowed
# "Cannot convert" error.
function Invoke-WinappJson {
  param(
    [Parameter(Mandatory)]
    [Alias('Args')]
    [string[]]$CommandArgs
  )
  $stderrTemp = [System.IO.Path]::GetTempFileName()
  try {
    $stdout = & $winappCmd @CommandArgs --json 2>$stderrTemp
    $exitCode = $LASTEXITCODE
    $stderr = Get-Content -Raw -Path $stderrTemp -ErrorAction SilentlyContinue
    # Empirically confirmed CLI stream behavior (validated live against a
    # running Notepad window before this harness could be run against the
    # fixture): a valid-but-negative RESULT (e.g. `search` matchCount:0,
    # `wait-for` timedOut:true) is still emitted as parseable JSON on
    # STDOUT even though the process exits 1. A genuine ERROR (e.g.
    # `get-property`/`invoke` on a selector that resolves to nothing) is
    # instead emitted as {"error":{"code":...,"message":...}} on STDERR
    # with EMPTY stdout, also exit 1. So: try stdout first (covers both
    # success and valid-negative-result cases - callers like
    # Resolve-ExactSelector and the dialog-button audit inspect fields
    # such as matchCount/matches/found themselves rather than every
    # non-zero exit being fatal here); if stdout does not parse, fall back
    # to parsing stderr as the error envelope. Only truly unparseable
    # output on both streams is a hard, generic failure.
    $parsed = $null
    try { $parsed = ($stdout | Out-String) | ConvertFrom-Json } catch { $parsed = $null }
    if ($null -eq $parsed) {
      $parsedErr = $null
      try { $parsedErr = ($stderr | Out-String) | ConvertFrom-Json } catch { $parsedErr = $null }
      if ($null -ne $parsedErr -and ($parsedErr.PSObject.Properties.Name -contains 'error')) {
        throw "winapp $($CommandArgs -join ' ') reported an error: $($parsedErr.error.code): $($parsedErr.error.message)"
      }
      throw "winapp $($CommandArgs -join ' ') exited $exitCode with unparseable output on both streams. stdout=$stdout stderr=$stderr"
    }
    if ($parsed.PSObject.Properties.Name -contains 'error') {
      throw "winapp $($CommandArgs -join ' ') reported an error: $($parsed.error.code): $($parsed.error.message)"
    }
    return $parsed
  } finally {
    Remove-Item $stderrTemp -ErrorAction SilentlyContinue
  }
}

# Resolves the CLI-generated `selector` slug for an element whose
# AutomationId is known EXACTLY, by searching for that exact string and
# requiring precisely one match whose `automationId` equals it verbatim.
# This sidesteps any ambiguity in the CLI's free-text fuzzy matching (e.g.
# "ElectronWinUI.MenuBar.Item.Id.Raw.file" is a literal prefix of
# "...Raw.file-close") by always resolving through the tool's own
# documented selector-slug mechanism instead of relying on substring
# matching of the raw AutomationId string at invoke/get-property time.
function Resolve-ExactSelector {
  param(
    [Parameter(Mandatory)][string]$AutomationId,
    [Parameter(Mandatory)][string]$FriendlyName,
    [Parameter(Mandatory)][int]$TargetPid,
    [string]$ControlType
  )
  $found = Invoke-WinappJson -Args @('ui', 'search', $AutomationId, '-a', "$TargetPid")
  $exact = @($found.matches | Where-Object { $_.automationId -eq $AutomationId })
  if ($ControlType) {
    $exact = @($exact | Where-Object { $_.type -eq $ControlType })
  }
  $typeDescription = if ($ControlType) { " with type '$ControlType'" } else { '' }
  if ($exact.Count -eq 0) {
    throw "No element found with exact AutomationId '$AutomationId'$typeDescription ($FriendlyName). search returned matchCount=$($found.matchCount)."
  }
  if ($exact.Count -gt 1) {
    throw "Ambiguous: $($exact.Count) elements share AutomationId '$AutomationId'$typeDescription ($FriendlyName)."
  }
  return $exact[0].selector
}

# Polls the fixture's redirected stdout log file for a regex marker,
# because the Electron-side console.log for an action can lag slightly
# behind the synthetic UIA click/keystroke that triggered it.
function Wait-ForLogMarker {
  param([Parameter(Mandatory)][string]$Pattern, [int]$TimeoutMsLocal = 5000)
  $deadline = (Get-Date).AddMilliseconds($TimeoutMsLocal)
  do {
    if (Test-Path $stdoutLog) {
      $match = Select-String -Path $stdoutLog -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -Last 1
      if ($match) { return $match.Line }
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  $logTail = if (Test-Path $stdoutLog) { Get-Content -Path $stdoutLog -Tail 20 -Raw } else { '(no log file yet)' }
  throw "Timed out after ${TimeoutMsLocal}ms waiting for fixture stdout marker matching '$Pattern'. Last log lines:`n$logTail"
}

function Save-Screenshot {
  param([Parameter(Mandatory)][string]$Name)
  $path = Join-Path $artifactsDir $Name
  & $winappCmd ui screenshot -a $AppPid -o $path --capture-screen --json 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Screenshot '$Name' failed with exit $LASTEXITCODE."
  }
}

function Save-InspectSnapshot {
  param([Parameter(Mandatory)][string]$Name)
  $path = Join-Path $artifactsDir $Name
  # Preserve containers such as MenuBar and ContentDialog for diagnosis;
  # --interactive would filter those non-invokable hosted surfaces out.
  & $winappCmd ui inspect -a $AppPid --depth 10 --json 2>$null | Out-File -FilePath $path -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    throw "UIA inspect snapshot '$Name' failed with exit $LASTEXITCODE."
  }
}

# ── AutomationId table (see src/accessibility.js, src/window.js,
#    src/content-dialog.js and test/fixtures/uia-fixture-app.js - these are
#    NOT guesses, they were derived by reading the exact assignment code) ──
$Ids = [ordered]@{
  MenuBarRoot          = 'ElectronWinUI.MenuBar'
  File                 = 'ElectronWinUI.MenuBar.Item.Id.Raw.file'
  FileClose            = 'ElectronWinUI.MenuBar.Item.Id.Raw.file-close'
  View                 = 'ElectronWinUI.MenuBar.Item.Id.Raw.view'
  ViewReload           = 'ElectronWinUI.MenuBar.Item.Id.Raw.view-reload'
  Actions              = 'ElectronWinUI.MenuBar.Item.Id.Raw.actions'
  ActionsPing          = 'ElectronWinUI.MenuBar.Item.Id.Raw.ping'
  ActionsShowContext   = 'ElectronWinUI.MenuBar.Item.Id.Raw.show-context-menu'
  ActionsShowDialog    = 'ElectronWinUI.MenuBar.Item.Id.Raw.show-content-dialog'
  ContextPing          = 'ElectronWinUI.ContextMenu.Item.Id.Raw.ctx-ping'
  ContextInfo          = 'ElectronWinUI.ContextMenu.Item.Id.Raw.ctx-info'
  ContentDialogHost    = 'ElectronWinUI.ContentDialog'
  ContentDialogPrimary = 'PrimaryButton'
  ContentDialogSecondary = 'SecondaryButton'
  ContentDialogClose   = 'CloseButton'
  TitleBarSearch       = 'ElectronWinUI.TitleBar.Search'
}
$ExpectedNames = [ordered]@{
  MenuBarRoot        = 'Application menu'
  File               = 'File'
  FileClose          = 'Close'
  View               = 'View'
  ViewReload         = 'Reload'
  Actions            = 'Actions'
  ActionsPing        = 'Ping'
  ActionsShowContext = 'Show context menu'
  ActionsShowDialog  = 'Show content dialog'
  ContextPing        = 'Context Ping'
  ContextInfo        = 'Context Info'
  ContentDialogHost  = 'Confirm action'
  TitleBarSearch     = 'Search fixture'
}

try {
  # ── Step 1: resolve + patch the dev Electron executable ──
  Write-Host "== Resolving Electron executable via $resolverScriptPath ==" -ForegroundColor Cyan
  $resolverOutput = & node $resolverScriptPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    $fatalError = "Could not resolve/patch the Electron executable (exit $LASTEXITCODE). Ensure npm run restore and npm run build have completed. Output:`n$resolverOutput"
    throw $fatalError
  }
  $electronExeLine = ($resolverOutput | Select-String -Pattern '^ELECTRON_EXE=(.+)$' | Select-Object -Last 1)
  if (-not $electronExeLine) {
    $fatalError = "resolve-electron-executable.js did not print ELECTRON_EXE=<path>. Output:`n$resolverOutput"
    throw $fatalError
  }
  $electronExe = $electronExeLine.Matches[0].Groups[1].Value
  Write-Host "Electron executable: $electronExe"

  # ── Step 2: launch the dedicated fixture ──
  Write-Host "== Launching fixture: $fixtureAppPath ==" -ForegroundColor Cyan
  $env:ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
  $fixtureProcess = Start-Process -FilePath $electronExe -ArgumentList @($fixtureAppPath) `
    -WorkingDirectory $repoRoot -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  $ownsFixtureProcess = $true
  $AppPid = $fixtureProcess.Id
  Write-Host "Fixture launched. PID=$AppPid stdout=$stdoutLog stderr=$stderrLog"

  # ── Step 3: gate on the native XAML island being ready (never a fixed
  #    sleep) - MenuBar is realized only after WinUIWindow's
  #    onceLoaded()/shellReady path runs, i.e. only once the native
  #    control tree genuinely exists. ──
  Write-Host "== Waiting for native XAML island (MenuBar) to be ready (timeout ${TimeoutMs}ms) ==" -ForegroundColor Cyan
  & $winappCmd ui wait-for $Ids.MenuBarRoot -a $AppPid -t $TimeoutMs --json 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $fatalError = "Fixture process $AppPid never exposed a ready MenuBar ($($Ids.MenuBarRoot)) within ${TimeoutMs}ms. The native XAML island likely failed to initialize. See $stderrLog / $stdoutLog."
    throw $fatalError
  }
  Write-Host "Native XAML island ready."
  Save-Screenshot -Name '01-baseline.png'
  Save-InspectSnapshot -Name 'inspect-baseline.json'

  # ── Section A: title search (exact + fuzzy) ──
  Invoke-UiaCheck -Name 'Fixture window discoverable by exact title via list-windows' -Script {
    $windows = Invoke-WinappJson -Args @('ui', 'list-windows', '-a', "$AppPid")
    $expectedTitle = "UIA Fixture $AppPid"
    $match = @($windows | Where-Object { $_.title -eq $expectedTitle })
    if ($match.Count -eq 0) {
      throw "list-windows did not return a window titled '$expectedTitle'. Titles seen: $(($windows | ForEach-Object { $_.title }) -join ', ')"
    }
  }
  Invoke-UiaCheck -Name 'Fixture window discoverable by fuzzy title via status' -Script {
    $status = Invoke-WinappJson -Args @('ui', 'status', '-a', 'UIA Fixture')
    if ($status.processId -ne $AppPid) {
      throw "status -a 'UIA Fixture' resolved processId $($status.processId), expected $AppPid."
    }
  }

  # ── Section B: MenuBar root + top-level items ──
  $menuBarSelector = $null
  Invoke-UiaCheck -Name 'MenuBar root has AutomationId + Name' -Script {
    $script:menuBarSelector = Resolve-ExactSelector -AutomationId $Ids.MenuBarRoot -FriendlyName 'MenuBar root' -TargetPid $AppPid
    $props = Invoke-WinappJson -Args @('ui', 'get-property', $script:menuBarSelector, '-a', "$AppPid")
    if ($props.properties.Name -ne $ExpectedNames.MenuBarRoot) {
      throw "MenuBar root Name was '$($props.properties.Name)', expected '$($ExpectedNames.MenuBarRoot)'."
    }
  }
  foreach ($topLevel in @('File', 'View', 'Actions')) {
    Invoke-UiaCheck -Name "MenuBar top-level item '$topLevel' has non-empty AutomationId + Name" -Script {
      $selector = Resolve-ExactSelector -AutomationId $Ids[$topLevel] -FriendlyName "MenuBar.$topLevel" -TargetPid $AppPid
      $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
      if ([string]::IsNullOrWhiteSpace($props.properties.AutomationId)) {
        throw "MenuBar item '$topLevel' has an empty AutomationId."
      }
      if ($props.properties.Name -ne $ExpectedNames[$topLevel]) {
        throw "MenuBar item '$topLevel' Name was '$($props.properties.Name)', expected '$($ExpectedNames[$topLevel])'."
      }
    }
  }

  # ── Section C: native context-menu (WinUI MenuFlyout) ──
  Invoke-UiaCheck -Name "Open 'Actions' top-level menu" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.Actions -FriendlyName 'MenuBar.Actions' -TargetPid $AppPid
    & $winappCmd ui invoke $selector -a $AppPid --json 2>$null | Out-Null
  }
  Invoke-UiaCheck -Name "'Show context menu' action item exists and has AutomationId + Name" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ActionsShowContext -FriendlyName 'Actions.ShowContextMenu' -TargetPid $AppPid
    $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
    if ($props.properties.Name -ne $ExpectedNames.ActionsShowContext) {
      throw "'Show context menu' item Name was '$($props.properties.Name)', expected '$($ExpectedNames.ActionsShowContext)'."
    }
  }
  Invoke-UiaCheck -Name "Invoke 'Show context menu' opens the native flyout" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ActionsShowContext -FriendlyName 'Actions.ShowContextMenu' -TargetPid $AppPid
    & $winappCmd ui invoke $selector -a $AppPid --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "invoke '$selector' failed with exit $LASTEXITCODE." }
    Wait-ForLogMarker -Pattern 'CONTEXT_MENU_OPENING' | Out-Null
    # MenuFlyout items appear in the UIA tree asynchronously - give it a
    # brief settle window before querying, per the winui-ui-testing skill.
    Start-Sleep -Milliseconds 400
    & $winappCmd ui wait-for $Ids.ContextPing -a $AppPid -t 3000 --json 2>$null | Out-Null
  }
  Save-Screenshot -Name '02-context-menu-open.png'
  Save-InspectSnapshot -Name 'inspect-context-menu.json'
  foreach ($item in @('ContextPing', 'ContextInfo')) {
    Invoke-UiaCheck -Name "Context-menu item '$item' has non-empty AutomationId + Name" -Script {
      $selector = Resolve-ExactSelector -AutomationId $Ids[$item] -FriendlyName "ContextMenu.$item" -TargetPid $AppPid
      $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
      if ($props.properties.Name -ne $ExpectedNames[$item]) {
        throw "Context-menu item '$item' Name was '$($props.properties.Name)', expected '$($ExpectedNames[$item])'."
      }
    }
  }
  Invoke-UiaCheck -Name "Click context-menu item closes flyout and fires Electron-side event" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ContextPing -FriendlyName 'ContextMenu.ContextPing' -TargetPid $AppPid
    & $winappCmd ui invoke $selector -a $AppPid --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "invoke '$selector' failed with exit $LASTEXITCODE." }
    & $winappCmd ui wait-for $Ids.ContextPing -a $AppPid --gone -t 3000 --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Context-menu item '$($Ids.ContextPing)' was still present after invoking it (flyout did not close)." }
    Wait-ForLogMarker -Pattern 'CONTEXT_MENU_PING_CLICKED' | Out-Null
  }

  # ── Section D: ContentDialog host + Primary/Secondary/Close buttons ──
  Invoke-UiaCheck -Name "Open 'Actions' top-level menu (for content dialog)" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.Actions -FriendlyName 'MenuBar.Actions' -TargetPid $AppPid
    & $winappCmd ui invoke $selector -a $AppPid --json 2>$null | Out-Null
  }
  Invoke-UiaCheck -Name "'Show content dialog' action item exists and has AutomationId + Name" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ActionsShowDialog -FriendlyName 'Actions.ShowContentDialog' -TargetPid $AppPid
    $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
    if ($props.properties.Name -ne $ExpectedNames.ActionsShowDialog) {
      throw "'Show content dialog' item Name was '$($props.properties.Name)', expected '$($ExpectedNames.ActionsShowDialog)'."
    }
  }
  Invoke-UiaCheck -Name "Invoke 'Show content dialog' opens the native ContentDialog host" -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ActionsShowDialog -FriendlyName 'Actions.ShowContentDialog' -TargetPid $AppPid
    & $winappCmd ui invoke $selector -a $AppPid --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "invoke '$selector' failed with exit $LASTEXITCODE." }
    Wait-ForLogMarker -Pattern 'CONTENT_DIALOG_OPENING' | Out-Null
    & $winappCmd ui wait-for $Ids.ContentDialogHost -a $AppPid -t 5000 --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ContentDialog host '$($Ids.ContentDialogHost)' never appeared." }
  }
  Save-Screenshot -Name '03-content-dialog-open.png'
  Save-InspectSnapshot -Name 'inspect-content-dialog.json'
  Invoke-UiaCheck -Name 'ContentDialog host has AutomationId + Name' -Script {
    $selector = Resolve-ExactSelector -AutomationId $Ids.ContentDialogHost -FriendlyName 'ContentDialog host' -TargetPid $AppPid -ControlType 'Group'
    $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
    if ($props.properties.Name -ne $ExpectedNames.ContentDialogHost) {
      throw "ContentDialog host Name was '$($props.properties.Name)', expected '$($ExpectedNames.ContentDialogHost)'."
    }
  }
  $dialogButtonSelectors = @{}
  $dialogButtons = @(
    [ordered]@{ Text = 'Accept'; Id = $Ids.ContentDialogPrimary },
    [ordered]@{ Text = 'Maybe'; Id = $Ids.ContentDialogSecondary },
    [ordered]@{ Text = 'Cancel'; Id = $Ids.ContentDialogClose }
  )
  foreach ($button in $dialogButtons) {
    Invoke-UiaCheck -Name "ContentDialog button '$($button.Text)' exposes platform AutomationId '$($button.Id)' and Name" -Script {
      $buttonText = $button.Text
      $found = Invoke-WinappJson -Args @('ui', 'search', $buttonText, '-a', "$AppPid")
      $buttonMatch = @($found.matches | Where-Object { $_.type -eq 'Button' -and $_.name -eq $buttonText })
      if ($buttonMatch.Count -eq 0) {
        throw "No Button element named '$buttonText' found (searched matchCount=$($found.matchCount))."
      }
      $selector = $buttonMatch[0].selector
      $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
      if ($props.properties.AutomationId -ne $button.Id) {
        throw "ContentDialog button '$buttonText' exposed AutomationId '$($props.properties.AutomationId)' instead of platform template ID '$($button.Id)' (ControlType=$($props.properties.ControlType), ClassName=$($props.properties.ClassName)). See test/uia/README.md 'ContentDialog platform boundary'."
      }
      $script:dialogButtonSelectors[$buttonText] = $selector
    }
  }
  Invoke-UiaCheck -Name "Click ContentDialog Primary button ('Accept') closes dialog and fires Electron-side event with response:0" -Script {
    if (-not $dialogButtonSelectors.ContainsKey('Accept')) { throw "Primary button selector was never resolved." }
    & $winappCmd ui invoke $dialogButtonSelectors['Accept'] -a $AppPid --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "invoke on Primary button failed with exit $LASTEXITCODE." }
    & $winappCmd ui wait-for $Ids.ContentDialogHost -a $AppPid --gone -t 3000 --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ContentDialog host was still present after clicking Primary." }
    $marker = Wait-ForLogMarker -Pattern 'CONTENT_DIALOG_RESULT:'
    if ($marker -notmatch 'CONTENT_DIALOG_RESULT:\{"checkboxChecked":false,"response":0\}') {
      throw "Unexpected CONTENT_DIALOG_RESULT payload: $marker (expected response:0 for the Primary/Accept button)."
    }
  }

  # ── Section E: title-bar search - real synthetic keystrokes, not
  #    set-value, so WinUI's AutoSuggestionBoxTextChangeReason is
  #    genuinely UserInput (see src/window.js onTextChanged) and the
  #    Electron-side 'titlebar-search-changed'/'titlebar-search-submitted'
  #    events actually fire. ──
  $searchSelector = $null
  Invoke-UiaCheck -Name 'Title-bar search box has AutomationId + Name' -Script {
    $script:searchSelector = Resolve-ExactSelector -AutomationId $Ids.TitleBarSearch -FriendlyName 'TitleBar.Search' -TargetPid $AppPid
    $props = Invoke-WinappJson -Args @('ui', 'get-property', $script:searchSelector, '-a', "$AppPid")
    if ($props.properties.Name -ne $ExpectedNames.TitleBarSearch) {
      throw "Title-bar search box Name was '$($props.properties.Name)', expected '$($ExpectedNames.TitleBarSearch)'."
    }
  }
  $searchProbeText = 'uia harness probe'
  Invoke-UiaCheck -Name "Typing into title-bar search fires 'titlebar-search-changed' (UserInput reason)" -Script {
    if (-not $searchSelector) { throw "Search box selector was never resolved." }
    & $winappCmd ui send-keys $searchProbeText --verbatim --target $searchSelector -a $AppPid --via send-input --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "send-keys into search box failed with exit $LASTEXITCODE." }
    $marker = Wait-ForLogMarker -Pattern ([regex]::Escape("TITLEBAR_SEARCH_CHANGED:$searchProbeText"))
  }
  Save-Screenshot -Name '04-title-search-typed.png'
  Invoke-UiaCheck -Name "Pressing Enter in title-bar search fires 'titlebar-search-submitted'" -Script {
    & $winappCmd ui send-keys 'enter' --target $searchSelector -a $AppPid --via send-input --json 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "send-keys 'enter' into search box failed with exit $LASTEXITCODE." }
    $marker = Wait-ForLogMarker -Pattern ([regex]::Escape("TITLEBAR_SEARCH_SUBMITTED:$searchProbeText"))
  }

  # ── Section F: exhaustive re-audit of every persistent control this
  #    library assigns automation identity to. Transient context-menu items
  #    and the ContentDialog host/buttons were audited while their surfaces
  #    were open above. Submenu children are audited below while each owning
  #    flyout is explicitly open; querying them while closed would create a
  #    false failure because closed WinUI MenuFlyouts are absent from UIA. ──
  foreach ($key in @('MenuBarRoot', 'File', 'View', 'Actions', 'TitleBarSearch')) {
    Invoke-UiaCheck -Name "[Audit] '$key' has non-empty AutomationId and Name" -Script {
      $selector = Resolve-ExactSelector -AutomationId $Ids[$key] -FriendlyName $key -TargetPid $AppPid
      $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
      if ([string]::IsNullOrWhiteSpace($props.properties.AutomationId)) {
        throw "'$key' has an empty AutomationId."
      }
      if ([string]::IsNullOrWhiteSpace($props.properties.Name)) {
        throw "'$key' has an empty Name."
      }
    }
  }

  $submenuAuditGroups = @(
    [ordered]@{ Owner = 'File'; Children = @('FileClose') },
    [ordered]@{ Owner = 'View'; Children = @('ViewReload') },
    [ordered]@{
      Owner = 'Actions'
      Children = @('ActionsPing', 'ActionsShowContext', 'ActionsShowDialog')
    }
  )
  foreach ($group in $submenuAuditGroups) {
    Invoke-UiaCheck -Name "[Audit] Open '$($group.Owner)' submenu" -Script {
      $ownerSelector = Resolve-ExactSelector -AutomationId $Ids[$group.Owner] -FriendlyName "MenuBar.$($group.Owner)" -TargetPid $AppPid
      & $winappCmd ui invoke $ownerSelector -a $AppPid --json 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Could not open '$($group.Owner)' submenu (exit $LASTEXITCODE)."
      }
    }
    foreach ($key in $group.Children) {
      Invoke-UiaCheck -Name "[Audit] '$key' has non-empty AutomationId and Name" -Script {
        $selector = Resolve-ExactSelector -AutomationId $Ids[$key] -FriendlyName $key -TargetPid $AppPid
        $props = Invoke-WinappJson -Args @('ui', 'get-property', $selector, '-a', "$AppPid")
        if ([string]::IsNullOrWhiteSpace($props.properties.AutomationId)) {
          throw "'$key' has an empty AutomationId."
        }
        if ([string]::IsNullOrWhiteSpace($props.properties.Name)) {
          throw "'$key' has an empty Name."
        }
      }
    }
  }

  Save-Screenshot -Name '05-final.png'
}
catch {
  if (-not $fatalError) { $fatalError = "$_" }
  Write-Host "FATAL: $fatalError" -ForegroundColor Red
  Write-Result -Name 'FATAL SETUP FAILURE' -Status 'FAIL' -Detail $fatalError
  $fail++
}
finally {
  if ($ownsFixtureProcess -and -not $KeepOpen) {
    Write-Host "== Tearing down fixture (PID=$AppPid) ==" -ForegroundColor Cyan
    $closedGracefully = $false
    try {
      $closeSelector = Resolve-ExactSelector -AutomationId $Ids.File -FriendlyName 'MenuBar.File' -TargetPid $AppPid
      & $winappCmd ui invoke $closeSelector -a $AppPid --json 2>$null | Out-Null
      Start-Sleep -Milliseconds 300
      $closeSelector2 = Resolve-ExactSelector -AutomationId $Ids.FileClose -FriendlyName 'MenuBar.File.Close' -TargetPid $AppPid
      & $winappCmd ui invoke $closeSelector2 -a $AppPid --json 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $fixtureProcess.WaitForExit(3000) | Out-Null
        $closedGracefully = $fixtureProcess.HasExited
      }
    } catch {
      # Graceful close is a best-effort convenience only - the forced
      # kill below is what guarantees teardown either way.
    }
    if (-not $closedGracefully -and $fixtureProcess -and -not $fixtureProcess.HasExited) {
      Write-Host "Graceful File > Close did not exit the fixture in time - force-killing PID $AppPid."
      Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue
    }
  } elseif ($KeepOpen -and $ownsFixtureProcess) {
    Write-Host "-KeepOpen supplied: leaving fixture PID=$AppPid running for manual inspection." -ForegroundColor Yellow
  } elseif (-not $ownsFixtureProcess) {
    Write-Host "No fixture process was launched (fatal setup failure before launch) - nothing to tear down or keep open." -ForegroundColor Yellow
  }

  $summary = [ordered]@{
    pass = $pass
    fail = $fail
    fatalError = $fatalError
    results = $results
  }
  $summary | ConvertTo-Json -Depth 6 | Out-File -FilePath $resultsJsonPath -Encoding utf8

  Write-Host ""
  Write-Host "Passed: $pass | Failed: $fail" -ForegroundColor $(if ($fail -eq 0 -and -not $fatalError) { 'Green' } else { 'Red' })
  Write-Host "Results written to $resultsJsonPath"
  Write-Host "Artifacts (screenshots, inspect snapshots, fixture logs) in $artifactsDir"
}

if ($fatalError) { exit 2 }
if ($fail -gt 0) { exit 1 }
exit 0
