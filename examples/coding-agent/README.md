# Coding Agent Demo

This example shows how to instrument a local coding agent with AgentScope.

## What it traces

- `observe_run("coding_agent")`
- `file_read`
- `file_write`
- `command_exec`
- `llm_call` via `agentscope.auto_instrument()`

## Requirements

- AgentScope API running on `http://localhost:8080`
- Python installed
- `requests` installed
- Optional for LLM tracing: `openai` installed and `OPENAI_API_KEY` configured

## Run

```bash
PYTHONPATH=packages/python-sdk python3 examples/coding-agent/run_agent.py
```

If `OPENAI_API_KEY` is set, the example also makes an OpenAI chat completion call so an `llm_call` span appears in the same run trace.
