#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-agentscope-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
SERVER_PORT="${SERVER_PORT:-8080}"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:${POSTGRES_PORT}/agentscope}"
API_BASE="${API_BASE:-http://localhost:${SERVER_PORT}}"
RUN_ID="11111111-1111-4111-8111-111111111111"
API_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "Starting dockerized Postgres..."
(cd "${REPO_ROOT}" && docker compose up -d "${POSTGRES_SERVICE}")

echo "Waiting for Postgres healthcheck..."
for _ in {1..30}; do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "${POSTGRES_CONTAINER}" 2>/dev/null || true)"
  if [[ "${status}" == "healthy" ]]; then
    break
  fi
  sleep 1
done

if [[ "${status:-}" != "healthy" ]]; then
  echo "Postgres container is not healthy: ${status:-unknown}" >&2
  exit 1
fi

echo "Starting API server (with migrations)..."
(
  cd "${REPO_ROOT}"
  DATABASE_URL="${DATABASE_URL}" SERVER_PORT="${SERVER_PORT}" cargo run -p agentscope-api >/tmp/agentscope-api-demo.log 2>&1
) &
API_PID=$!

echo "Waiting for API readiness..."
for _ in {1..40}; do
  if curl -fsS "${API_BASE}/v1/runs" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${API_BASE}/v1/runs" >/dev/null 2>&1; then
  echo "API did not become ready. Log output:" >&2
  sed -n '1,200p' /tmp/agentscope-api-demo.log >&2 || true
  exit 1
fi

echo "Sending trace..."
API_BASE="${API_BASE}" python3 "${SCRIPT_DIR}/send_trace.py"

echo
echo "Runs:"
curl -sS "${API_BASE}/v1/runs" | jq .

echo
echo "Run:"
curl -sS "${API_BASE}/v1/runs/${RUN_ID}" | jq .

echo
echo "Spans:"
curl -sS "${API_BASE}/v1/runs/${RUN_ID}/spans" | jq .

echo
echo "Verifying trace..."
API_BASE="${API_BASE}" "${SCRIPT_DIR}/verify_trace.sh"
