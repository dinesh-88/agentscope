#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8080}"
RUN_ID="11111111-1111-4111-8111-111111111111"
SPAN_ID="22222222-2222-4222-8222-222222222222"

RUNS_JSON="$(curl -sS "${API_BASE}/v1/runs")"
RUN_JSON="$(curl -sS "${API_BASE}/v1/runs/${RUN_ID}")"
SPANS_JSON="$(curl -sS "${API_BASE}/v1/runs/${RUN_ID}/spans")"

echo "${RUNS_JSON}" | jq -e --arg run_id "${RUN_ID}" 'any(.[]; .id == $run_id)' >/dev/null
echo "${RUN_JSON}" | jq -e --arg run_id "${RUN_ID}" '.id == $run_id' >/dev/null
echo "${SPANS_JSON}" | jq -e --arg span_id "${SPAN_ID}" 'any(.[]; .id == $span_id)' >/dev/null

echo "Demo successful"
