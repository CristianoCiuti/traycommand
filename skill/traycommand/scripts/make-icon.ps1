<#
.SYNOPSIS
  Creates a simple tray icon: a coloured rounded square (or circle) with up to 3 characters.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Text "DB" -Color "#2e7d32" -Out "C:\cfg\icons\db_on.png"
  powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Text "DB" -Color "#9e9e9e" -Out "C:\cfg\icons\db_off.png"
#>
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Color = '#1565c0',
  [string]$TextColor = '#ffffff',
  [ValidateSet('square', 'circle')][string]$Shape = 'square',
  [int]$Size = 64
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

$fill = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($Color))
$m = [int]($Size * 0.03)
$w = $Size - 2 * $m
if ($Shape -eq 'circle') {
  $g.FillEllipse($fill, $m, $m, $w, $w)
} else {
  $r = [int]($Size * 0.22)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($m, $m, $r * 2, $r * 2, 180, 90)
  $p.AddArc($m + $w - $r * 2, $m, $r * 2, $r * 2, 270, 90)
  $p.AddArc($m + $w - $r * 2, $m + $w - $r * 2, $r * 2, $r * 2, 0, 90)
  $p.AddArc($m, $m + $w - $r * 2, $r * 2, $r * 2, 90, 90)
  $p.CloseFigure()
  $g.FillPath($fill, $p)
}

$t = $Text.Substring(0, [Math]::Min(3, $Text.Length))
$ratio = @{ 1 = 0.62; 2 = 0.46; 3 = 0.34 }[$t.Length]
$font = New-Object System.Drawing.Font 'Segoe UI', ([float]($Size * $ratio)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($TextColor))
$g.DrawString($t, $font, $ink, (New-Object System.Drawing.RectangleF 0, ([float]($Size * 0.02)), $Size, $Size), $fmt)

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "Created $Out"
