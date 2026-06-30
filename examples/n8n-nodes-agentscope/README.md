# n8n-nodes-agentscope

Custom n8n community node for AgentScope.

## Supported operations

- `Ingest Run Payload` -> `POST /v1/ingest` (requires `x-agentscope-api-key`)
- `Track SDK Event` -> `POST /v1/telemetry`

## Local build

```bash
cd examples/n8n-nodes-agentscope
npm install
npm run build
```

## Install in self-hosted n8n

1. Build this package.
2. Link or copy this folder into your n8n custom extensions path.

Typical docker setup:

- Mount folder to `/home/node/.n8n/custom/n8n-nodes-agentscope`
- Set `N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom`
- Restart n8n

## Configure credentials

Create `AgentScope API` credentials in n8n:

- `Base URL`: e.g. `http://localhost:8080`
- `Project API Key`: your AgentScope project key (`proj_live_...`)

## Example ingest payload

```json
{
  "run": {
    "id": "9a8f8c66-9d8d-4e2d-8a6f-36cb3a6a8073",
    "project_id": "11111111-1111-1111-1111-111111111111",
    "workflow_name": "support-triage",
    "agent_name": "router",
    "status": "completed",
    "started_at": "2026-04-24T09:00:00Z",
    "ended_at": "2026-04-24T09:00:02Z"
  },
  "spans": [],
  "artifacts": []
}
```
