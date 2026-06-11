#!/usr/bin/env bash
# Deploy the app to the exe.dev VM and restart the service.
# Usage: ./scripts/deploy.sh
set -euo pipefail

VM="armchair-sparkle.exe.xyz"
REMOTE_DIR="/home/exedev/ideation"

echo "==> Syncing source to ${VM}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  ./ "${VM}:${REMOTE_DIR}/"

echo "==> Installing deps + building on the VM"
ssh "${VM}" "cd ${REMOTE_DIR} && npm install --no-audit --no-fund && npm run build"

echo "==> Restarting service"
ssh "${VM}" "sudo systemctl restart ideation && sleep 1 && systemctl --no-pager --lines=5 status ideation | cat"

echo "==> Health check"
ssh "${VM}" "curl -fsS http://localhost:3000/api/health && echo"

echo "==> Done. Open https://armchair-sparkle.exe.xyz/"
