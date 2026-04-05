# ============================================
# PM2 Otomatik Baslatma (Windows Task Scheduler)
# PowerShell'i Administrator olarak calistir
# ============================================

$installDir = "C:\polymarket-bot"
$taskName = "PolymarketBot"

Write-Host "=== Otomatik Baslatma Ayarlaniyor ===" -ForegroundColor Cyan

# PM2 ile botu baslat (ilk seferlik)
Set-Location $installDir
pm2 start ecosystem.config.cjs
pm2 save

# Task Scheduler ile VPS restart sonrasi otomatik baslatma
$npmGlobal = (npm root -g).Trim()
$pm2Path = Join-Path $npmGlobal "pm2\bin\pm2"
$nodePath = (Get-Command node).Source

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$pm2Path`" resurrect" `
    -WorkingDirectory $installDir

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERNAME" `
    -LogonType S4 `
    -RunLevel Highest

# Eski task varsa sil
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Polymarket BTC Trading Bot - PM2 Auto Restart"

Write-Host "`n=== Tamamlandi ===" -ForegroundColor Green
Write-Host "Bot VPS restart olunca otomatik baslatilacak." -ForegroundColor Cyan
Write-Host "Kontrol: pm2 status" -ForegroundColor Cyan
Write-Host "Loglar:  pm2 logs polymarket-bot" -ForegroundColor Cyan
Write-Host "Dashboard: http://localhost:3001" -ForegroundColor Cyan
