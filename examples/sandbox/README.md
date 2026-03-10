# AgentScope Sandbox

Local sandbox that emits realistic AgentScope runs from both the Python SDK and the TypeScript SDK.

## What it does

Each sandbox agent:

- reads the buggy files in [`sample_project/buggy.py`](/Users/dineshpriyashantha/Documents/agentscope/examples/sandbox/sample_project/buggy.py) and [`sample_project/buggy.ts`](/Users/dineshpriyashantha/Documents/agentscope/examples/sandbox/sample_project/buggy.ts)
- simulates an `llm_call` that proposes a fix
- writes fixed output files back into `sample_project/`
- runs a fake shell command to simulate verification
- exports the run to the local AgentScope API

Expected runs in AgentScope:

- `sandbox_python_agent`
- `sandbox_ts_agent`

Expected span types:

- `file_read`
- `llm_call`
- `file_write`
- `command_exec`

Expected artifacts:

- `llm.prompt`
- `llm.response`
- `file.diff`
- `command.stdout`

## Prerequisites

- AgentScope API running on `http://localhost:8080`
- Python 3.10+
- Node.js 18+

Optional environment variables:

- Python SDK: `AGENTSCOPE_API_BASE=http://localhost:8080`
- TS SDK: `AGENTSCOPE_API=http://localhost:8080`

## Run The Python Sandbox

From the repo root:

```bash
PYTHONPATH=packages/python-sdk python3 examples/sandbox/python-agent/main.py
```

This creates one run named `sandbox_python_agent` and writes:

- `examples/sandbox/sample_project/buggy.python.fixed.py`
- `examples/sandbox/sample_project/buggy.python.fixed.ts`

## Run The TS Sandbox

Build the SDK first, then compile and run the sandbox example from the repo root:

```bash
npm --prefix packages/ts-sdk install
npm --prefix packages/ts-sdk run build
packages/ts-sdk/node_modules/.bin/tsc \
  --module commonjs \
  --target es2020 \
  --moduleResolution node \
  --esModuleInterop \
  --typeRoots packages/ts-sdk/node_modules/@types \
  --outDir examples/sandbox/ts-agent/dist \
  examples/sandbox/ts-agent/main.ts \
  examples/sandbox/ts-agent/tools.ts
node examples/sandbox/ts-agent/dist/main.js
```

This creates one run named `sandbox_ts_agent` and writes:

- `examples/sandbox/sample_project/buggy.tsagent.fixed.py`
- `examples/sandbox/sample_project/buggy.tsagent.fixed.ts`

## What You Should See In AgentScope

For each run, the UI should show:

- multiple `file_read` spans for the sample project inputs
- multiple `llm_call` spans with `llm.prompt` and `llm.response` artifacts
- multiple `file_write` spans with `file.diff` artifacts
- multiple `command_exec` spans with `command.stdout` artifacts

This example is intended for local manual testing and product demos, not for production agent logic.
