# ============================================
# BTC Polymarket Bot — VPS Kurulum (Windows 11)
# ============================================
# PowerShell'i Administrator olarak calistir

Write-Host "=== BTC Polymarket Bot VPS Kurulum ===" -ForegroundColor Cyan

# 1. Node.js 20 LTS kur
Write-Host "`n[1/5] Node.js 20 LTS kuruluyor..." -ForegroundColor Yellow
$nodeInstaller = "$env:TEMP\node-setup.msi"
Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile $nodeInstaller
Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /quiet /norestart" -Wait
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
Write-Host "  Node.js: $(node --version)" -ForegroundColor Green

# 2. PM2 kur (process manager + crash recovery)
Write-Host "`n[2/5] PM2 kuruluyor..." -ForegroundColor Yellow
npm install -g pm2
npm install -g pm2-windows-startup
Write-Host "  PM2 kuruldu" -ForegroundColor Green

# 3. Python kur (generate-api-creds icin, opsiyonel)
Write-Host "`n[3/5] Python kontrolu..." -ForegroundColor Yellow
try {
    $pyVer = python --version 2>&1
    Write-Host "  Python: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "  Python bulunamadi. API creds icin gerekli:" -ForegroundColor Red
    Write-Host "  https://www.python.org/downloads/" -ForegroundColor Gray
}

# 4. Repo'yu klonla
Write-Host "`n[4/5] Repo klonlaniyor..." -ForegroundColor Yellow
$installDir = "C:\polymarket-bot"
if (Test-Path $installDir) {
    Write-Host "  $installDir zaten var, git pull yapiliyor..." -ForegroundColor Gray
    Set-Location $installDir
    git pull
} else {
    git clone https://github.com/KULLANICI_ADI/polymarket-bot.git $installDir
    Set-Location $installDir
}

# 5. Bagimliliklar
Write-Host "`n[5/5] npm install..." -ForegroundColor Yellow
npm install

# Build
Write-Host "`n=== Build ===" -ForegroundColor Yellow
npm run build

# .env kontrolu
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "`n!!! .env dosyasi olusturuldu. Duzenle: notepad $installDir\.env" -ForegroundColor Red
    Write-Host "  POLYMARKET_API_KEY, API_SECRET, PASSPHRASE, WALLET_ADDRESS, PRIVATE_KEY doldur" -ForegroundColor Red
} else {
    Write-Host "`n.env dosyasi mevcut" -ForegroundColor Green
}

# Data klasoru
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

Write-Host "`n=== Kurulum Tamamlandi ===" -ForegroundColor Green
Write-Host "Baslat: pm2 start ecosystem.config.cjs" -ForegroundColor Cyan
Write-Host "Loglar: pm2 logs polymarket-bot" -ForegroundColor Cyan
Write-Host "Durum:  pm2 status" -ForegroundColor Cyan
