# AgentScope Demo

This demo sends a sample telemetry trace to the AgentScope ingestion API.

## Requirements

- Docker services running
- API available on port 8080
- Python installed
- `requests` installed (`pip install requests`)
- `jq` installed

## Run demo

```bash
./run_demo.sh
```

## Expected result

Run stored in database and spans returned by API.
