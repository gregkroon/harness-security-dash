#!/bin/bash

# Toggle demo mode in .env file

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: .env file not found"
  exit 1
fi

# Check current state
if grep -q "VITE_DEMO_MODE=true" "$ENV_FILE"; then
  # Switch to live mode
  sed -i.bak 's/VITE_DEMO_MODE=true/VITE_DEMO_MODE=false/' "$ENV_FILE"
  echo "✅ Switched to LIVE mode (using real Harness API)"
  echo "   Make sure VITE_HARNESS_ACCOUNT_ID and VITE_HARNESS_API_KEY are set"
else
  # Switch to demo mode
  sed -i.bak 's/VITE_DEMO_MODE=false/VITE_DEMO_MODE=true/' "$ENV_FILE"
  echo "✅ Switched to DEMO mode (using mock data)"
fi

# Remove backup file
rm -f "$ENV_FILE.bak"

echo ""
echo "Restart the dev server for changes to take effect:"
echo "  npm run dev"
