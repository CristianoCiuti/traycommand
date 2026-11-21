# Real test of folder watches and time windows on a packaged build (Windows, ~6 minutes):
#   npm run package; ./test/real/folder-watch.ps1 -Exe packages/win-unpacked/TrayCommand.exe
param([string]$Exe)
# Real test of folder watches and time windows: the packaged TrayCommand, real files, real clock.
$ErrorActionPreference = 'Stop'
function Read-Log { for ($i = 0; $i -lt 40; $i++) { try { if (Test-Path $log) { return @([IO.File]::ReadAllLines($log)) } else { return @() } } catch { Start-Sleep -Milliseconds 50 } }; throw 'log locked' }
$W = Join-Path $env:TEMP ("tc-real-" + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory $W | Out-Null
$out = Join-Path $W 'out'; New-Item -ItemType Directory $out | Out-Null
foreach ($d in 'in', 'sub', 'batch', 'pre', 'win', 'big', 'q', 'rel', 'chk') { New-Item -ItemType Directory (Join-Path $W $d) | Out-Null }
Set-Content (Join-Path $W 'pre\waiting.txt') 'x'
Set-Content (Join-Path $W 'win\early.txt') 'x'
Set-Content (Join-Path $W 'rel\r.txt') 'x'
$log = Join-Path $out 'log.txt'

function Act([string]$id, [string]$extra = '') {
  return 'Add-Content -LiteralPath "$env:TC_OUT\log.txt" -Value ("' + $id + '|" + $env:TC_EVENT + "|" + $env:TC_FILE_NAME + "|" + (Get-Date -Format HH:mm:ss.fff)' + $extra + ')'
}
$now = Get-Date
$open = $now.Date.AddHours($now.Hour).AddMinutes($now.Minute + 2)   # 1 to 2 minutes from now
$close = $open.AddMinutes(2)
$between = '{0:HH:mm}-{1:HH:mm}' -f $open, $close
# a window that still lasts at least 40 s (the first run comes 5 s after the start)
$everyEnd = $now.Date.AddHours($now.Hour).AddMinutes($now.Minute + 1)
if (($everyEnd - $now).TotalSeconds -lt 40) { $everyEnd = $everyEnd.AddMinutes(1) }
$everyBetween = '{0:HH:mm}-{1:HH:mm}' -f $now.Date.AddHours($now.Hour).AddMinutes($now.Minute), $everyEnd
$days = @('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')
$today = $days[[int]$now.DayOfWeek]
$otherDay = $days[([int]$now.DayOfWeek + 3) % 7]

function Tray([string]$id, $action, $schedules) { [ordered]@{ id = $id; label = $id; hidden = $true; action = $action; schedules = @($schedules) } }
$trays = @(
  (Tray 'basic' (Act 'basic') @{ watch = [ordered]@{ path = '${env:TC_W}\in'; files = '*.txt'; events = @('add', 'change', 'remove'); settle = '1s' } }),
  (Tray 'sub' (Act 'sub') @{ watch = [ordered]@{ path = 'sub'; files = '*.log'; subfolders = $true; settle = '1s' } }),
  (Tray 'batch' (Act 'batch' ' + "|" + ($env:TC_FILES -split "`n").Count') @{ watch = [ordered]@{ path = 'batch'; files = '*.csv'; batch = $true; settle = '2s' } }),
  (Tray 'existing' (Act 'existing') @{ watch = [ordered]@{ path = 'pre'; existing = $true; settle = '1s' } }),
  (Tray 'window' (Act 'window') @{ watch = [ordered]@{ path = 'win'; existing = $true; settle = '1s' }; between = $between }),
  (Tray 'missing' (Act 'missing') @{ watch = [ordered]@{ path = 'later'; settle = '1s' } }),
  (Tray 'big' (Act 'big' ' + "|" + (Get-Item -LiteralPath $env:TC_FILE).Length') @{ watch = [ordered]@{ path = 'big'; settle = '2s' } }),
  (Tray 'queue' ('Add-Content -LiteralPath "$env:TC_OUT\log.txt" -Value ("q-start|" + $env:TC_FILE_NAME + "|" + (Get-Date -Format HH:mm:ss.fff)); Start-Sleep -Seconds 2; Add-Content -LiteralPath "$env:TC_OUT\log.txt" -Value ("q-end|" + $env:TC_FILE_NAME + "|" + (Get-Date -Format HH:mm:ss.fff))') @{ watch = [ordered]@{ path = 'q'; settle = '1s' } }),
  (Tray 'everywin' (Act 'everywin') @{ every = '5s'; between = $everyBetween }),
  (Tray 'startupIn' (Act 'startupIn') @{ startup = $true; days = $today }),
  (Tray 'startupOut' (Act 'startupOut') @{ startup = $true; days = $otherDay }),
  (Tray 'checked' (Act 'checked') @{ watch = [ordered]@{ path = 'chk'; settle = '1s' }; if = [ordered]@{ check = 'Get-Content -LiteralPath $env:TC_FILE'; on = '^ok' } })
)
function Save-Config($t) {
  $json = [ordered]@{ version = 2; settings = [ordered]@{ shell = 'powershell'; launcherHotkey = ''; checkUpdates = $false; skillUpdates = 'ask' }; trays = @($t) } | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText((Join-Path $W 'traycommand.json'), $json, (New-Object Text.UTF8Encoding($false)))
}
Save-Config $trays
"work: $W"
"window for 'window': $between   every-window: $everyBetween   today: $today"

$env:TC_OUT = $out; $env:TC_W = $W
$p = Start-Process -FilePath $Exe -ArgumentList "--config=$(Join-Path $W 'traycommand.json')", "--data-dir=$(Join-Path $W 'data')" -PassThru
$t0 = Get-Date
function Wait-Log([scriptblock]$cond, [int]$sec = 15) { $end = (Get-Date).AddSeconds($sec); while ((Get-Date) -lt $end) { $l = @(Read-Log); if ($l.Count -and (& $cond $l)) { return $true }; Start-Sleep -Milliseconds 250 }; return $false }
function Lines([string]$prefix) { @(Read-Log | Where-Object { $_ -like "$prefix|*" }) }
$results = [System.Collections.ArrayList]::new()
function Check([string]$name, [bool]$ok, [string]$detail = '') { [void]$results.Add([pscustomobject]@{ Test = $name; Ok = $ok; Detail = $detail }) }

# startup, files already there
[void](Wait-Log { param($l) ($l -like 'existing|*').Count -ge 1 -and ($l -like 'startupIn|*').Count -ge 1 } 20)
Check 'existing: the file already there runs at start' (@(Lines 'existing').Count -eq 1 -and @(Lines 'existing')[0] -like 'existing|add|waiting.txt|*') (@(Lines 'existing') -join ' ; ')
Check 'startup inside its days runs' (@(Lines 'startupIn').Count -eq 1)
Check 'startup outside its days does not run' (@(Lines 'startupOut').Count -eq 0)
Check 'window: nothing before it opens' (@(Lines 'window').Count -eq 0)

# create, change, delete; not matching
Set-Content (Join-Path $W 'in\a.txt') 'one'
Set-Content (Join-Path $W 'in\skip.csv') 'x'
[void](Wait-Log { param($l) ($l -like 'basic|add|a.txt|*').Count -ge 1 })
Start-Sleep -Milliseconds 500
Add-Content (Join-Path $W 'in\a.txt') 'two two two'
[void](Wait-Log { param($l) ($l -like 'basic|change|a.txt|*').Count -ge 1 })
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $W 'in\a.txt')
[void](Wait-Log { param($l) ($l -like 'basic|remove|a.txt|*').Count -ge 1 })
Start-Sleep -Seconds 2
$b = Lines 'basic' | ForEach-Object { ($_ -split '\|')[1..2] -join ':' }
Check 'add, change, remove of a .txt, the .csv ignored' (($b -join ',') -eq 'add:a.txt,change:a.txt,remove:a.txt') ($b -join ',')

# sub folders
New-Item -ItemType Directory (Join-Path $W 'sub\x\y') -Force | Out-Null
Set-Content (Join-Path $W 'sub\x\y\z.log') 'x'
Set-Content (Join-Path $W 'sub\x\no.txt') 'x'
[void](Wait-Log { param($l) ($l -like 'sub|*').Count -ge 1 })
Start-Sleep -Seconds 2
Check 'sub folders: the .log two levels down' (@(Lines 'sub').Count -eq 1 -and @(Lines 'sub')[0] -like 'sub|add|z.log|*') (@(Lines 'sub') -join ' ; ')

# batch of three
1..3 | ForEach-Object { Set-Content (Join-Path $W "batch\f$_.csv") 'x' }
[void](Wait-Log { param($l) ($l -like 'batch|*').Count -ge 1 })
Start-Sleep -Seconds 3
Check 'batch: one run for three files' (@(Lines 'batch').Count -eq 1 -and @(Lines 'batch')[0] -like '*|3') (@(Lines 'batch') -join ' ; ')

# a big file written in pieces for ~4 s: one run, after the last piece
$big = Join-Path $W 'big\large.bin'
$chunk = New-Object byte[] (8MB)
$fs = [IO.File]::Open($big, 'Create', 'Write', 'Read')
for ($i = 0; $i -lt 25; $i++) { $fs.Write($chunk, 0, $chunk.Length); $fs.Flush(); Start-Sleep -Milliseconds 150 }
$fs.Close()
$size = (Get-Item $big).Length
[void](Wait-Log { param($l) ($l -like 'big|*').Count -ge 1 } 20)
Start-Sleep -Seconds 3
Check 'big file: one run, complete size' (@(Lines 'big').Count -eq 1 -and @(Lines 'big')[0] -like "*|$size") ("expected $size; " + (@(Lines 'big') -join ' ; '))

# queue: three files, runs one after the other
1..3 | ForEach-Object { Set-Content (Join-Path $W "q\q$_.txt") 'x' }
[void](Wait-Log { param($l) ($l -like 'q-end|*').Count -ge 3 } 30)
$q = Lines 'q-'
$overlap = $false; $depth = 0
foreach ($line in @(Read-Log | Where-Object { $_ -like 'q-*' })) { if ($line -like 'q-start*') { $depth++ } else { $depth-- }; if ($depth -gt 1) { $overlap = $true } }
Check 'queue: three runs, never two at once' (@(Read-Log | Where-Object { $_ -like 'q-end|*' }).Count -eq 3 -and -not $overlap) (@(Read-Log | Where-Object { $_ -like 'q-*' }) -join ' ; ')

# only if a check passes: the check reads the file of the event
Set-Content (Join-Path $W 'chk\good.txt') 'ok, go'
Set-Content (Join-Path $W 'chk\bad.txt') 'no thanks'
[void](Wait-Log { param($l) ($l -like 'checked|*').Count -ge 1 })
Start-Sleep -Seconds 3
Check 'only if: the file that passes the check runs, the other does not' ((@(Lines 'checked')).Count -eq 1 -and (@(Lines 'checked'))[0] -like 'checked|add|good.txt|*') ((Lines 'checked') -join ' ; ')

# a folder that appears later
Start-Sleep -Seconds 2
New-Item -ItemType Directory (Join-Path $W 'later') | Out-Null
Start-Sleep -Seconds 7
Set-Content (Join-Path $W 'later\l.txt') 'x'
[void](Wait-Log { param($l) ($l -like 'missing|*').Count -ge 1 } 15)
Check 'a missing folder is watched once it appears' (@(Lines 'missing').Count -eq 1) (@(Lines 'missing') -join ' ; ')

# configuration saved while running: a new watch reports its files, the old ones do not repeat
$trays += (Tray 'reload' (Act 'reload') @{ watch = [ordered]@{ path = 'rel'; existing = $true; settle = '1s' } })
Save-Config $trays
[void](Wait-Log { param($l) ($l -like 'reload|*').Count -ge 1 } 15)
Start-Sleep -Seconds 3
Check 'reload: the new watch reports its file' (@(Lines 'reload').Count -eq 1)
Check 'reload: the unchanged watch does not report again' (@(Lines 'existing').Count -eq 1)
Check 'reload: startup schedules do not run again' (@(Lines 'startupIn').Count -eq 1)

# every 5 s inside a window that closes at $everyEnd
while ((Get-Date) -lt $everyEnd.AddSeconds(12)) { Start-Sleep -Seconds 1 }
# start times from the activity log of TrayCommand (the log line above is written when PowerShell has started, ~1 s later)
$runs = @(Get-Content (Join-Path $W 'data\logs\executions.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.label -eq 'everywin' } | ForEach-Object { [DateTimeOffset]::FromUnixTimeMilliseconds($_.time - $_.durationMs).LocalDateTime })
$late = @($runs | Where-Object { $_ -ge $everyEnd })
Check 'every 5 s: runs inside the window, none after it' ($runs.Count -ge 1 -and $late.Count -eq 0) ("$($runs.Count) runs, $($late.Count) started after $('{0:HH:mm}' -f $everyEnd)")
# the time window of the watch: opens (early.txt is processed), files during it run, after it nothing
while ((Get-Date) -lt $open.AddSeconds(8)) { Start-Sleep -Seconds 1 }
$w1 = @(Lines 'window')
Check 'window opens: the waiting file runs' ($w1.Count -eq 1 -and $w1[0] -like 'window|add|early.txt|*') ($w1 -join ' ; ')
$openedAt = if ($w1.Count) { ($w1[0] -split '\|')[3] } else { '' }
Set-Content (Join-Path $W 'win\during.txt') 'x'
[void](Wait-Log { param($l) ($l -like 'window|add|during.txt|*').Count -ge 1 })
Check 'window open: a new file runs' (@(Lines 'window' | Where-Object { $_ -like '*during.txt*' }).Count -eq 1)
while ((Get-Date) -lt $close.AddSeconds(5)) { Start-Sleep -Seconds 1 }
Set-Content (Join-Path $W 'win\after.txt') 'x'
Start-Sleep -Seconds 5
Check 'window closed: a new file does not run' (@(Lines 'window' | Where-Object { $_ -like '*after.txt*' }).Count -eq 0) (@(Lines 'window') -join ' ; ')

$activity = Join-Path $W 'data'
Stop-Process -Id $p.Id -Force
"opened at $openedAt (window $between)"
$results | Format-Table -AutoSize | Out-String -Width 220
"PASSED $(@($results | Where-Object Ok).Count) / $($results.Count)"
"--- log"
Read-Log
