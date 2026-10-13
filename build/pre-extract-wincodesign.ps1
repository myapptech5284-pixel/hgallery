param(
    [string]$CacheDir = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
)

$ErrorActionPreference = 'Stop'
$sevenZip = Join-Path $PSScriptRoot "..\node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path $sevenZip)) {
    Write-Error "7za.exe not found at $sevenZip (run npm install first)."
    exit 1
}

if (-not (Test-Path $CacheDir)) { exit 0 }

$archives = Get-ChildItem $CacheDir -Filter "*.7z" -File
foreach ($arc in $archives) {
    $hash = [System.IO.Path]::GetFileNameWithoutExtension($arc.Name)
    $dest = Join-Path $CacheDir $hash
    # electron-builder looks for signtool.exe here when it needs the vendor
    # tools on Windows; treat that as "this copy is fully extracted".
    $marker = Join-Path $dest "windows-10\x64\signtool.exe"
    if (Test-Path $marker) { continue }
    # darwin / linux / openssl-ia32 hold symlinks. Creating them on Windows
    # needs Developer Mode or an elevated shell, and electron-builder's own
    # extractor does not pass -xr, so it dies with "A required privilege is
    # not held by the client". A Windows build never needs those folders.
    Write-Host "Extracting $($arc.Name) -> $dest"
    & $sevenZip x -bd -aoa $arc.FullName "-o$dest" "-xr!darwin" "-xr!linux" "-xr!openssl-ia32" 2>&1 | Select-Object -Last 3
    if (-not (Test-Path $marker)) {
        Write-Error "Extraction of $($arc.Name) did not produce windows-10\x64\signtool.exe"
    }
}

Write-Host "Done."
