#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="${API_BASE:-http://localhost:8080}"
RUN_ID="11111111-1111-4111-8111-111111111111"

echo "Sending trace..."
python3 "${SCRIPT_DIR}/send_trace.py"

echo
echo "Runs:"
curl -sS "${API_BASE}/v1/runs" | jq .

echo
echo "Spans:"
curl -sS "${API_BASE}/v1/runs/${RUN_ID}/spans" | jq .

echo
echo "Verifying trace..."
"${SCRIPT_DIR}/verify_trace.sh"
