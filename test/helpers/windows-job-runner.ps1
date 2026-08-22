param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$NodeExecutable,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$LauncherPath,

    [Parameter(Mandatory = $true, Position = 2)]
    [string]$PayloadBase64,

    [Parameter(Mandatory = $true, Position = 3)]
    [int]$TimeoutMilliseconds
)

$timeoutMarker = '__ELECTRON_WINUI_PROCESS_TIMEOUT__'
$nativeMethods = @'
using System;
using System.Runtime.InteropServices;

public static class ElectronWinUIJob {
    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInformation {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimitInformation {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll")]
    public static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
'@

Add-Type -TypeDefinition $nativeMethods

$killOnJobClose = 0x00002000
$extendedLimitInformationClass = 9
$job = [ElectronWinUIJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) {
    throw "CreateJobObject failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}

$basicInformation = New-Object ElectronWinUIJob+BasicLimitInformation
$basicInformation.LimitFlags = $killOnJobClose
$information = New-Object ElectronWinUIJob+ExtendedLimitInformation
$information.BasicLimitInformation = $basicInformation
$size = [Runtime.InteropServices.Marshal]::SizeOf($information)
$pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
$readyPath = Join-Path ([IO.Path]::GetTempPath()) "electron-winui-process-ready-$([Guid]::NewGuid())"
$exitCode = 1
$timedOut = $false

try {
    [Runtime.InteropServices.Marshal]::StructureToPtr($information, $pointer, $false)
    if (-not [ElectronWinUIJob]::SetInformationJobObject(
        $job,
        $extendedLimitInformationClass,
        $pointer,
        $size
    )) {
        throw "SetInformationJobObject failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $NodeExecutable
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.ArgumentList.Add($LauncherPath)
    $startInfo.ArgumentList.Add($PayloadBase64)
    $startInfo.ArgumentList.Add($readyPath)

    $process = [Diagnostics.Process]::Start($startInfo)
    if (-not [ElectronWinUIJob]::AssignProcessToJobObject($job, $process.Handle)) {
        $process.Kill($true)
        throw "AssignProcessToJobObject failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
    }
    $process.StandardInput.WriteLine('start')
    $process.StandardInput.Close()

    $startupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (
        -not (Test-Path -LiteralPath $readyPath) -and
        -not $process.HasExited -and
        [DateTime]::UtcNow -lt $startupDeadline
    ) {
        Start-Sleep -Milliseconds 10
    }

    if (-not (Test-Path -LiteralPath $readyPath)) {
        if (-not $process.HasExited) {
            $process.Kill($true)
        }
        throw 'Target process did not start within 10 seconds.'
    }

    if ($process.WaitForExit($TimeoutMilliseconds)) {
        $exitCode = $process.ExitCode
    }
    else {
        $timedOut = $true
        $exitCode = 124
    }
}
finally {
    Remove-Item -LiteralPath $readyPath -Force -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
    [ElectronWinUIJob]::CloseHandle($job) | Out-Null
}

if ($timedOut) {
    [Console]::Error.WriteLine("$timeoutMarker$TimeoutMilliseconds")
}
exit $exitCode
