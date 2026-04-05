# ============================================
# BTC Polymarket Bot — Guncelleme Scripti
# ============================================

$installDir = "C:\polymarket-bot"
Set-Location $installDir

Write-Host "=== Bot Guncelleniyor ===" -ForegroundColor Cyan

# 1. PM2 durdur
Write-Host "[1/5] Bot durduruluyor..." -ForegroundColor Yellow
pm2 stop polymarket-bot 2>$null

# 2. Git pull
Write-Host "[2/5] Kod cekiliyor..." -ForegroundColor Yellow
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "Git pull basarisiz!" -ForegroundColor Red
    pm2 start polymarket-bot
    exit 1
}

# 3. npm install (yeni paketler varsa)
Write-Host "[3/5] Bagimlilklar kontrol ediliyor..." -ForegroundColor Yellow
npm install

# 4. Build
Write-Host "[4/5] Build yapiliyor..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build basarisiz!" -ForegroundColor Red
    pm2 start polymarket-bot
    exit 1
}

# 5. Yeniden baslat
Write-Host "[5/5] Bot baslatiliyor..." -ForegroundColor Yellow
pm2 restart polymarket-bot

Write-Host "`n=== Guncelleme Tamamlandi ===" -ForegroundColor Green
pm2 status
