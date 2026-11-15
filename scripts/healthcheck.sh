#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:${PORT}/api/health"
echo ""
