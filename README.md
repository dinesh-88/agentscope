# AgentScope

AgentScope is an observability and debugging platform for AI agents.

It helps developers understand how AI systems behave in production by
capturing execution traces, LLM calls, tool usage, and agent decisions.

## Features

- Trace every AI agent run
- Inspect prompts and model responses
- Debug tool calls
- Track token usage and cost
- Compare runs across deployments

## Quick Example

```python
from agentscope import observe_run

with observe_run("support_agent"):
    response = agent.run("How do I cancel my subscription?")