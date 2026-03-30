#!/bin/bash

echo "=========================================="
echo "Multi-Hop Trade Path Verification Script"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠ node_modules not found. Running npm install...${NC}"
    npm install
fi

echo ""
echo "1. Checking TypeScript compilation..."
echo "--------------------------------------"
npx tsc --noEmit --skipLibCheck src/services/multiHopPathFinder.ts src/Agents/tools/multiHopTradeTool.ts
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ TypeScript compilation successful${NC}"
else
    echo -e "${RED}✗ TypeScript compilation failed${NC}"
    exit 1
fi

echo ""
echo "2. Running multi-hop tests..."
echo "--------------------------------------"
npm test -- tests/unit/multiHopPathFinder.test.ts --passWithNoTests
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ MultiHopPathFinder tests passed${NC}"
else
    echo -e "${RED}✗ MultiHopPathFinder tests failed${NC}"
fi

npm test -- tests/unit/multiHopTradeTool.test.ts --passWithNoTests
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ MultiHopTradeTool tests passed${NC}"
else
    echo -e "${RED}✗ MultiHopTradeTool tests failed${NC}"
fi

echo ""
echo "3. Checking file structure..."
echo "--------------------------------------"
files=(
    "src/services/multiHopPathFinder.ts"
    "src/Agents/tools/multiHopTradeTool.ts"
    "tests/unit/multiHopPathFinder.test.ts"
    "tests/unit/multiHopTradeTool.test.ts"
    "docs/MULTI_HOP_TRADING.md"
    "examples/multiHopTradeExample.ts"
)

all_exist=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file (missing)"
        all_exist=false
    fi
done

echo ""
echo "4. Checking integration..."
echo "--------------------------------------"
if grep -q "multiHopTradeTool" src/Agents/registry/ToolAutoDiscovery.ts; then
    echo -e "${GREEN}✓ Tool registered in ToolAutoDiscovery${NC}"
else
    echo -e "${RED}✗ Tool not registered in ToolAutoDiscovery${NC}"
fi

if grep -q "getPriceWithMultiHop" src/services/stellarPrice.service.ts; then
    echo -e "${GREEN}✓ Price service integration added${NC}"
else
    echo -e "${RED}✗ Price service integration missing${NC}"
fi

echo ""
echo "=========================================="
echo "Verification Complete!"
echo "=========================================="
