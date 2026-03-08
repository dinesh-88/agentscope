# AgentScope

**AgentScope** is an observability and debugging platform for AI agents.

It helps developers understand how AI systems behave in production by capturing execution traces, LLM calls, tool usage, and errors.

AgentScope lets you **see inside every agent run**.

---

## Why AgentScope?

AI systems are difficult to debug.

When an AI agent fails, developers often ask:

- What prompt was sent to the model?
- Which tools were called?
- What did the model return?
- Where did the workflow fail?
- Why did behavior change after deployment?

AgentScope records the full execution trace of your AI workflows so you can inspect and debug them easily.

---

## Features

AgentScope captures everything that happens during an AI agent run.

### Execution Tracing

Trace every step of your agent workflow.

User Input
↓
Retriever
↓
LLM Call
↓
Tool Call
↓
LLM Response
↓
Validation

---

### Inspect LLM Calls

See exactly what the model received and returned.

- prompts
- system messages
- responses
- token usage
- latency
- model version

---

### Tool Call Debugging

Inspect tool interactions:

- tool name
- input arguments
- output results
- errors and exceptions
- execution latency

---

### Cost Tracking

Track token usage and estimated cost for every run.

---

### Error Diagnosis

Identify failures quickly:

- invalid JSON output
- tool timeouts
- provider API errors
- schema validation failures

---

## Quick Example

Instrument an agent workflow with the Python SDK.

```python
from agentscope import observe_run, observe_span

with observe_run("support_agent"):

    with observe_span("retrieval"):
        docs = retriever.search("refund policy")

    with observe_span("llm_call"):
        response = llm("Answer the customer question")

    with observe_span("tool_call"):
        result = billing_api.check_subscription(user_id)
```

## Architecture

AgentScope is built around a simple architecture. 
```
Application
   │
   │ SDK instrumentation
   ▼
Ingestion API
   │
   ▼
Trace Storage
(Postgres + Object Storage)
   │
   ▼
Query API
   │
   ▼
Debug Dashboard
```
See (docs/architecture.md)￼ for details.


## Telemetry Model

AgentScope uses a run/span model similar to distributed tracing.

```
Run
 ├─ Span: retrieval.search
 ├─ Span: llm.plan
 ├─ Span: tool.lookup_customer
 ├─ Span: llm.answer
 └─ Span: validation.output
```
See [docs/telemetry-spec.md]

## Repository Structure

```

agentscope/
├─ sdk/
│  ├─ python/
│  └─ typescript/
├─ engine/
│  ├─ api/
│  ├─ workers/
│  └─ trace/
├─ storage/
│  ├─ migrations/
│  └─ postgres/
├─ docs/
│  ├─ architecture.md
│  └─ telemetry-spec.md
├─ examples/
│  ├─ rag-agent/
│  ├─ langchain-agent/
│  └─ tool-agent/
└─ README.md

```

## Getting Started (Coming Soon)

We are currently building the core engine.

The first release will include:
	•	ingestion API
	•	Python SDK
	•	trace storage
	•	local debugging workflow

Follow the repository to track progress.


Roadmap

Phase 1 — Core Engine
	•	ingestion API
	•	trace schema
	•	Postgres storage
	•	Python SDK
	•	basic query endpoints

Phase 2 — Debugging Workflow
	•	run inspection
	•	span timeline
	•	prompt inspection
	•	tool debugging
	•	cost tracking

Phase 3 — Advanced Debugging
	•	run comparison
	•	replay execution
	•	prompt version diff
	•	error grouping

Phase 4 — SaaS Platform
	•	hosted dashboard
	•	multi-tenant architecture
	•	alerts and monitoring
	•	advanced analytics

⸻

Open Core Model

AgentScope follows an open-core model.

Open Source
	•	telemetry specification
	•	ingestion engine
	•	SDKs
	•	local development tools

Hosted Platform

The hosted AgentScope platform will provide:
	•	full debugging dashboard
	•	team collaboration
	•	advanced analytics
	•	alerting
	•	managed infrastructure

⸻

Contributing

We welcome contributions.

You can help by:
	•	improving documentation
	•	adding SDK integrations
	•	building examples
	•	fixing bugs
	•	suggesting features

Please open an issue before starting large changes.
Roadmap

Phase 1 — Core Engine
	•	ingestion API
	•	trace schema
	•	Postgres storage
	•	Python SDK
	•	basic query endpoints

Phase 2 — Debugging Workflow
	•	run inspection
	•	span timeline
	•	prompt inspection
	•	tool debugging
	•	cost tracking

Phase 3 — Advanced Debugging
	•	run comparison
	•	replay execution
	•	prompt version diff
	•	error grouping

Phase 4 — SaaS Platform
	•	hosted dashboard
	•	multi-tenant architecture
	•	alerts and monitoring
	•	advanced analytics

⸻

Open Core Model

AgentScope follows an open-core model.

Open Source
	•	telemetry specification
	•	ingestion engine
	•	SDKs
	•	local development tools

Hosted Platform

The hosted AgentScope platform will provide:
	•	full debugging dashboard
	•	team collaboration
	•	advanced analytics
	•	alerting
	•	managed infrastructure

⸻

Contributing

We welcome contributions.

You can help by:
	•	improving documentation
	•	adding SDK integrations
	•	building examples
	•	fixing bugs
	•	suggesting features

Please open an issue before starting large changes.

⸻

License

MIT License
