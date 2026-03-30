# Multi-Hop Trade Path Verification Script (PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Multi-Hop Trade Path Verification Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠ node_modules not found. Running npm install..." -ForegroundColor Yellow
    npm install
}

Write-Host ""
Write-Host "1. Checking TypeScript compilation..." -ForegroundColor Cyan
Write-Host "--------------------------------------"
$tsResult = npx tsc --noEmit --skipLibCheck src/services/multiHopPathFinder.ts src/Agents/tools/multiHopTradeTool.ts 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ TypeScript compilation successful" -ForegroundColor Green
} else {
    Write-Host "✗ TypeScript compilation failed" -ForegroundColor Red
    Write-Host $tsResult
}

Write-Host ""
Write-Host "2. Running multi-hop tests..." -ForegroundColor Cyan
Write-Host "--------------------------------------"
npm test -- tests/unit/multiHopPathFinder.test.ts --passWithNoTests
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ MultiHopPathFinder tests passed" -ForegroundColor Green
} else {
    Write-Host "✗ MultiHopPathFinder tests failed" -ForegroundColor Red
}

npm test -- tests/unit/multiHopTradeTool.test.ts --passWithNoTests
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ MultiHopTradeTool tests passed" -ForegroundColor Green
} else {
    Write-Host "✗ MultiHopTradeTool tests failed" -ForegroundColor Red
}

Write-Host ""
Write-Host "3. Checking file structure..." -ForegroundColor Cyan
Write-Host "--------------------------------------"
$files = @(
    "src/services/multiHopPathFinder.ts",
    "src/Agents/tools/multiHopTradeTool.ts",
    "tests/unit/multiHopPathFinder.test.ts",
    "tests/unit/multiHopTradeTool.test.ts",
    "docs/MULTI_HOP_TRADING.md",
    "examples/multiHopTradeExample.ts"
)

$allExist = $true
foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "✓ $file" -ForegroundColor Green
    } else {
        Write-Host "✗ $file (missing)" -ForegroundColor Red
        $allExist = $false
    }
}

Write-Host ""
Write-Host "4. Checking integration..." -ForegroundColor Cyan
Write-Host "--------------------------------------"
$autoDiscovery = Get-Content "src/Agents/registry/ToolAutoDiscovery.ts" -Raw
if ($autoDiscovery -match "multiHopTradeTool") {
    Write-Host "✓ Tool registered in ToolAutoDiscovery" -ForegroundColor Green
} else {
    Write-Host "✗ Tool not registered in ToolAutoDiscovery" -ForegroundColor Red
}

$priceService = Get-Content "src/services/stellarPrice.service.ts" -Raw
if ($priceService -match "getPriceWithMultiHop") {
    Write-Host "✓ Price service integration added" -ForegroundColor Green
} else {
    Write-Host "✗ Price service integration missing" -ForegroundColor Red
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Verification Complete!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
