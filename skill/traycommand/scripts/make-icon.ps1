<#
.SYNOPSIS
  Creates a simple tray icon: a coloured rounded square (or circle) with a pictogram (-Glyph)
  or up to 3 letters (-Text). Windows only (System.Drawing).

.PARAMETER Glyph
  A pictogram from the Windows icon font (Segoe Fluent Icons / Segoe MDL2 Assets): one of the
  names below, or a hex code point such as E749.
  print globe settings folder play stop code cloud wifi lock monitor mail document search power
  sync info warning terminal home calendar people phone camera music video download upload
  link shield key bug heart star flag clock moon sun car shop

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Text "DB" -Color "#2e7d32" -Out "C:\cfg\icons\db_on.png"
  powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Glyph print -Color "#9e9e9e" -Out "C:\cfg\icons\printer_off.png"
#>
param(
  [string]$Text = '',
  [string]$Glyph = '',
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

$glyphs = @{
  print = 'E749'; globe = 'E774'; settings = 'E713'; folder = 'E8B7'; play = 'E768'; stop = 'E71A'; code = 'E943'
  cloud = 'E753'; wifi = 'E701'; lock = 'E72E'; monitor = 'E7F4'; mail = 'E715'; document = 'E8A5'; search = 'E721'
  power = 'E7E8'; sync = 'E895'; info = 'E946'; warning = 'E7BA'; terminal = 'E756'; home = 'E80F'; calendar = 'E787'
  people = 'E716'; phone = 'E717'; camera = 'E722'; music = 'E8D6'; video = 'E714'; download = 'E896'; upload = 'E898'
  link = 'E71B'; shield = 'EA18'; key = 'E8D7'; bug = 'EBE8'; heart = 'EB51'; star = 'E734'; flag = 'E7C1'
  clock = 'E823'; moon = 'E708'; sun = 'E706'; car = 'E804'; shop = 'E719'
}
if ($Glyph) {
  $code = if ($glyphs.ContainsKey($Glyph.ToLower())) { $glyphs[$Glyph.ToLower()] } else { $Glyph }
  if ($code -notmatch '^[0-9A-Fa-f]{4}$') { throw "Unknown glyph '$Glyph'. Use one of: $(($glyphs.Keys | Sort-Object) -join ', ') or a 4-digit hex code" }
  $families = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object Name
  $family = @('Segoe Fluent Icons', 'Segoe MDL2 Assets') | Where-Object { $families -contains $_ } | Select-Object -First 1
  if (-not $family) { throw 'No Windows icon font found (Segoe Fluent Icons / Segoe MDL2 Assets): use -Text instead' }
  $t = [string][char][Convert]::ToInt32($code, 16)
  $font = New-Object System.Drawing.Font $family, ([float]($Size * 0.56)), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
} elseif ($Text) {
  # letters and digits only: emoji and symbols are not in Segoe UI and render as a box
  $t = $Text.Substring(0, [Math]::Min(3, $Text.Length))
  $ratio = @{ 1 = 0.62; 2 = 0.46; 3 = 0.34 }[$t.Length]
  $font = New-Object System.Drawing.Font 'Segoe UI', ([float]($Size * $ratio)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
} else {
  throw 'Give -Glyph (a pictogram) or -Text (up to 3 letters)'
}
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
