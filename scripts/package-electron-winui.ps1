<#
.SYNOPSIS
    Build, test, and package the experimental Electron WinUI package.

.DESCRIPTION
    Runs from the repository root of the standalone @microsoft/electron-winui
    package: installs dependencies, restores or regenerates WinRT bindings,
    builds, tests, and produces an npm tarball in the output directory.

.PARAMETER Version
    Optional version to stamp into package.json for the produced tarball. The
    original package.json/package-lock.json are restored afterwards.

.PARAMETER OutputPath
    Directory that receives the npm tarball. Defaults to "<repo>/artifacts".

.PARAMETER SkipTests
    Skip `npm test`. Useful on machines without an interactive desktop session,
    because the tests launch Electron.
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$PackageRoot = $PSScriptRoot | Split-Path -Parent
if (-not $OutputPath) {
    $OutputPath = Join-Path $PackageRoot "artifacts"
}

$NodeVersionText = node --version
if ($LASTEXITCODE -ne 0) {
    throw "Node.js was not found. Install Node.js 22.12 or newer."
}
$NodeVersion = [version]$NodeVersionText.TrimStart('v').Split('-')[0]
if ($NodeVersion -lt [version]'22.12.0') {
    throw "Electron WinUI packaging requires Node.js 22.12.0 or newer; found $NodeVersionText."
}

New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Push-Location $PackageRoot
$PackageJsonBackup = $null
$PackageLockBackup = $null
try {
    if ($Version) {
        $PackageJsonBackup = Join-Path $env:TEMP "electron-winui-package-$([guid]::NewGuid().ToString('N')).json"
        $PackageLockBackup = Join-Path $env:TEMP "electron-winui-lock-$([guid]::NewGuid().ToString('N')).json"
        Copy-Item "package.json" $PackageJsonBackup -Force
        Copy-Item "package-lock.json" $PackageLockBackup -Force

        npm version $Version --no-git-tag-version --allow-same-version
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to set Electron WinUI package version."
        }
    }

    Write-Host "[ELECTRON-WINUI] Installing npm dependencies..." -ForegroundColor Blue
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Electron WinUI npm dependencies."
    }

    Write-Host "[ELECTRON-WINUI] Ensuring Electron is downloaded..." -ForegroundColor Blue
    npx install-electron --no
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download Electron."
    }

    if (-not (Test-Path ".winapp\bindings\index.js")) {
        Write-Host "[ELECTRON-WINUI] Restoring Windows App SDK metadata..." -ForegroundColor Blue
        npm run restore
    } else {
        Write-Host "[ELECTRON-WINUI] Refreshing generated WinRT bindings..." -ForegroundColor Blue
        npm run generate
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to generate Electron WinUI bindings."
    }

    Write-Host "[ELECTRON-WINUI] Building..." -ForegroundColor Blue
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build Electron WinUI."
    }

    if ($SkipTests) {
        Write-Host "[ELECTRON-WINUI] Skipping tests." -ForegroundColor Yellow
    } else {
        Write-Host "[ELECTRON-WINUI] Running tests..." -ForegroundColor Blue
        npm test
        if ($LASTEXITCODE -ne 0) {
            throw "Electron WinUI tests failed."
        }
    }

    Write-Host "[ELECTRON-WINUI] Packing..." -ForegroundColor Blue
    npm pack --pack-destination $OutputPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to package Electron WinUI."
    }

    Write-Host "[ELECTRON-WINUI] Tarball written to $OutputPath" -ForegroundColor Green
} finally {
    if ($PackageJsonBackup -and (Test-Path $PackageJsonBackup)) {
        Copy-Item $PackageJsonBackup "package.json" -Force
        Remove-Item $PackageJsonBackup -Force
    }
    if ($PackageLockBackup -and (Test-Path $PackageLockBackup)) {
        Copy-Item $PackageLockBackup "package-lock.json" -Force
        Remove-Item $PackageLockBackup -Force
    }
    Pop-Location
}
