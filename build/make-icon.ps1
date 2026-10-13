Add-Type -AssemblyName System.Drawing

$outDir = "C:\Users\Dr mohamed soliman\.minimax\sessions\mvs_dec1346605cd49ddbd74e938b951f833\workspace\hawar-app\build"
$png256 = Join-Path $outDir "icon.png"
$icoPath = Join-Path $outDir "icon.ico"

# ----- 1) Build a 256x256 PNG -----
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$rect = New-Object System.Drawing.Rectangle 0, 0, 256, 256
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 14, 116, 144),
  [System.Drawing.Color]::FromArgb(255, 30, 58, 138),
  45.0
)
$g.FillRectangle($brush, $rect)

$font = New-Object System.Drawing.Font("Segoe UI", 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF 0, 0, 256, 256
$g.DrawString("H", $font, [System.Drawing.Brushes]::White, $textRect, $sf)

$arFont = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$arRect = New-Object System.Drawing.RectangleF 0, 170, 256, 80
$arSf = New-Object System.Drawing.StringFormat
$arSf.Alignment = [System.Drawing.StringAlignment]::Center
$arSf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("حور", $arFont, [System.Drawing.Brushes]::White, $arRect, $arSf)

$g.Dispose()
$bmp.Save($png256, [System.Drawing.Imaging.ImageFormat]::Png)

# ----- 2) Build a multi-size .ico (Vista+ format) -----
# Encode each size as a PNG and embed each as its own ICO entry.
$sizes = @(16, 24, 32, 48, 64, 128, 256)

# Load source bitmap
$src = [System.Drawing.Image]::FromFile($png256)
$pngBlobs = New-Object System.Collections.Generic.List[byte[]]

foreach ($s in $sizes) {
  $tmp = New-Object System.Drawing.Bitmap $src, $s, $s
  $ms = New-Object System.IO.MemoryStream
  $tmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBlobs.Add($ms.ToArray())
  $ms.Dispose()
  $tmp.Dispose()
}
$src.Dispose()

# Compute total size
$headerLen = 6 + (16 * $sizes.Count)
$offset = $headerLen
foreach ($b in $pngBlobs) { $offset += $b.Length }

# Build byte array
$totalBytes = $offset
$out = New-Object byte[] $totalBytes

# ICONDIR
$out[0] = 0
$out[1] = 0
$out[2] = 1
$out[3] = 0
[BitConverter]::GetBytes([uint16]$sizes.Count).CopyTo($out, 4)

# ICONDIRENTRYs
$cursor = 6
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $blob = $pngBlobs[$i]
  $w = if ($s -ge 256) { 0 } else { $s }
  $h = if ($s -ge 256) { 0 } else { $s }
  $out[$cursor] = [byte]$w
  $out[$cursor + 1] = [byte]$h
  $out[$cursor + 2] = 0
  $out[$cursor + 3] = 0
  $out[$cursor + 4] = 1   # planes lo
  $out[$cursor + 5] = 0   # planes hi
  $out[$cursor + 6] = 32  # bpp lo
  $out[$cursor + 7] = 0   # bpp hi
  [BitConverter]::GetBytes([uint32]$blob.Length).CopyTo($out, $cursor + 8)
  [BitConverter]::GetBytes([uint32]($headerLen + (($i) * 0))).CopyTo($out, $cursor + 12)
  $cursor += 16
}

# Recompute offsets properly (after all entries, image data starts at $headerLen)
$running = $headerLen
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $blob = $pngBlobs[$i]
  $entryStart = 6 + ($i * 16)
  [BitConverter]::GetBytes([uint32]$running).CopyTo($out, $entryStart + 12)
  $running += $blob.Length
}

# Copy PNG data after the directory
$running = $headerLen
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $blob = $pngBlobs[$i]
  [Array]::Copy($blob, 0, $out, $running, $blob.Length)
  $running += $blob.Length
}

[System.IO.File]::WriteAllBytes($icoPath, $out)
Write-Host "Wrote: $png256 ($((Get-Item $png256).Length) bytes)"
Write-Host "Wrote: $icoPath ($((Get-Item $icoPath).Length) bytes)"
