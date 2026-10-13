param(
    # Defaults to the 7za.exe that electron-builder actually invokes.
    [string]$OutExe = (Join-Path (Split-Path -Parent $PSScriptRoot) "node_modules\7zip-bin\win\x64\7za.exe")
)

# ---------------------------------------------------------------------------
# Why this exists
# ---------------------------------------------------------------------------
# electron-builder unpacks several helper archives (winCodeSign, nsis, ...)
# with 7za.exe, passing `-snld`. The winCodeSign archive contains macOS
# symlinks, and 7-Zip tries to materialise them on Windows — which needs
# Developer Mode or an elevated shell. Without it every installer build dies
# with "Cannot create symbolic link : A required privilege is not held by
# the client", and app-builder then retries with a fresh random cache folder
# until it gives up.
#
# This builds a tiny shim that forwards to the real 7za but adds exclusions
# for the platform folders a Windows build never reads (darwin/linux/openssl-
# ia32), and reports success when the tool we actually asked for landed in the
# destination. Compiled with csc.exe from .NET Framework, which ships with
# Windows, so no toolchain install is required.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutExe)) {
    Write-Error "7za.exe not found at $OutExe (run 'npm install' first)."
    exit 1
}

$realExe = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($OutExe),
    "7za-real.exe"
)

if (-not (Test-Path $realExe)) {
    Move-Item $OutExe $realExe -Force
    Write-Host "Moved real 7za -> $realExe"
}

$src = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

public class Wrap {
    // Platform-only folders inside the vendor archives that a Windows build
    // never reads, and that hold symlinks we cannot create.
    static readonly string[] Excludes = { "-xr!darwin", "-xr!linux", "-xr!openssl-ia32" };

    // Standard Windows command-line quoting: wrap in quotes and escape only
    // embedded quotes (plus the backslashes that precede them). Escaping every
    // backslash would corrupt ordinary Windows paths.
    static string Quote(string s) {
        if (s.Length > 0 && s.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return s;
        var sb = new StringBuilder("\"");
        int bs = 0;
        for (int i = 0; i < s.Length; i++) {
            char c = s[i];
            if (c == '\\') { bs++; continue; }
            if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
            sb.Append('\\', bs);
            bs = 0;
            sb.Append(c);
        }
        sb.Append('\\', bs * 2);
        sb.Append('"');
        return sb.ToString();
    }

    public static int Main(string[] args) {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string real = Path.Combine(dir, "7za-real.exe");
        if (!File.Exists(real)) real = Path.Combine(dir, "7za.exe");

        bool isExtract = false;
        foreach (string a in args) {
            if (string.Equals(a, "x", StringComparison.OrdinalIgnoreCase)) isExtract = true;
        }

        var psi = new ProcessStartInfo();
        psi.FileName = real;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;

        var quoted = new StringBuilder();
        foreach (string a in args) {
            if (quoted.Length > 0) quoted.Append(' ');
            quoted.Append(Quote(a));
        }

        // Prepend the excludes right after the sub-command (args[0] == "x").
        if (isExtract && args.Length > 0 && string.Equals(args[0], "x", StringComparison.OrdinalIgnoreCase)) {
            var withExcludes = new StringBuilder(Quote("x"));
            foreach (string e in Excludes) withExcludes.Append(' ').Append(Quote(e));
            for (int i = 1; i < args.Length; i++) {
                withExcludes.Append(' ').Append(Quote(args[i]));
            }
            psi.Arguments = withExcludes.ToString();
        } else {
            psi.Arguments = quoted.ToString();
        }

        int exitCode;
        try {
            using (var p = Process.Start(psi)) {
                p.WaitForExit();
                exitCode = p.ExitCode;
            }
        } catch (Exception e) {
            Console.Error.WriteLine("7za wrapper failed to launch: " + e.Message);
            return 2;
        }

        if (exitCode == 0) return 0;

        // Only the unusable symlinks failed. If the tool electron-builder
        // actually needs is present, treat the extraction as good.
        foreach (string a in args) {
            if (!a.StartsWith("-o", StringComparison.OrdinalIgnoreCase)) continue;
            string dest = a.Substring(2);
            string[] markers = {
                "rcedit-x64.exe",                 // winCodeSign
                "makensis.exe",                    // nsis
                Path.Combine("windows-10", "x64", "signtool.exe")
            };
            foreach (string m in markers) {
                if (File.Exists(Path.Combine(dest, m))) return 0;
            }
        }

        return exitCode;
    }
}
"@

# Locate the C# compiler that ships with Windows / .NET Framework.
$csc = $null
foreach ($c in @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe")) {
    if (Test-Path $c) { $csc = $c; break }
}
if (-not $csc) {
    Write-Error "csc.exe not found (expected .NET Framework 4 on C:\Windows\Microsoft.NET)."
    exit 1
}

$tempDir = [System.IO.Path]::GetTempPath()
$srcFile = Join-Path $tempDir "7za_wrap.cs"
$exeFile = Join-Path $tempDir "7za_wrap_compiled.exe"
[System.IO.File]::WriteAllText($srcFile, $src, [System.Text.Encoding]::UTF8)

Write-Host "Compiling 7za shim with $csc"
& $csc /nologo /target:exe "/out:$exeFile" $srcFile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exeFile)) {
    Write-Error "Compilation failed."
    exit 1
}

Copy-Item $exeFile $OutExe -Force
Write-Host "Shim installed: $OutExe"
Write-Host "Real 7za kept:   $realExe"