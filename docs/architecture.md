# AgentScope Architecture

AgentScope is an observability and debugging platform for AI agents.

Its purpose is to help developers understand how AI systems behave in production by capturing execution traces, LLM calls, tool calls, errors, latency, and cost.

This document describes the architecture for the initial open-core engine and the path toward the hosted SaaS platform.

---

## Goals

AgentScope should make it easy to answer:

- What happened during an agent run?
- Which step failed?
- What prompt was sent to the model?
- Which tools were called?
- How much did the run cost?
- Why did behavior change between runs?

The system should support both local development and a future hosted multi-tenant SaaS offering.

---

## Product Model

AgentScope follows an open-core + SaaS model.

### Open Core

The open-source project includes:

- Trace specification
- Ingestion API
- Core storage layer
- SDKs
- Local development support
- Example integrations
- Basic query endpoints
- Local debugging workflow

### SaaS Platform

The hosted platform includes:

- Multi-tenant dashboard
- Advanced debugging workflows
- Run comparison
- Replay
- Alerting
- Team features
- Scalable storage and analytics
- Billing and usage tracking
- Managed infrastructure

---

## Architecture Principles

The architecture is guided by the following principles.

### 1. Observability must be low-friction
Developers should be able to instrument applications with minimal code changes.

### 2. Instrumentation must be safe
AgentScope must not significantly affect the latency or reliability of the customer application.

### 3. Traces must be structured
Telemetry should use strongly typed entities such as runs, spans, artifacts, and errors.

### 4. Storage should be tiered
Structured metadata belongs in a relational database; large payloads belong in object storage.

### 5. Ingestion should be fast
Heavy computation must happen asynchronously outside the write path.

### 6. Multi-tenancy must be first-class
The architecture should be designed from the start for organization and project isolation.

### 7. The MVP should be simple
The first version should optimize for correctness, debuggability, and adoption before scale complexity.

---

## High-Level Architecture

```text
Customer App
   │
   │ SDK / instrumentation
   ▼
Ingestion API
   │
   ├── authenticate API key
   ├── validate payloads
   ├── normalize events
   ├── persist runs / spans / artifacts
   └── enqueue background jobs
            │
            ▼
        Worker Layer
            │
            ├── finalize runs
            ├── classify errors
            ├── calculate costs
            ├── build summaries
            └── prepare analytics
             
Frontend UI ─────► Query API ─────► Postgres / Object Storage