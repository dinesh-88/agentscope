# AgentScope Telemetry Specification

This document defines the telemetry protocol used by AgentScope.

It describes how SDKs capture and transmit execution data for AI agents, including:

- runs
- spans
- LLM calls
- tool calls
- artifacts
- errors
- metadata

The telemetry specification defines the contract between:

- AgentScope SDKs
- the ingestion API
- the storage layer
- debugging and analytics tooling

---

# Goals

The telemetry system should:

- capture the full execution trace of AI agent runs
- enable debugging of model behavior
- capture tool interactions
- track token usage and cost
- record failures and recovery behavior
- support replay and diff features in the future

The telemetry protocol should be:

- structured
- versioned
- append-only
- backward compatible

---

# Terminology

## Run

A **run** represents one complete execution of an AI workflow.

Examples:

- one chat message handled by an agent
- one scheduled task execution
- one document analysis pipeline
- one autonomous task execution

A run contains one or more spans.

---

## Span

A **span** represents a single step inside a run.

Examples:

- LLM call
- tool call
- retrieval step
- validation
- decision
- agent handoff

Spans may be nested.

---

## Artifact

An **artifact** is a large payload associated with a run or span.

Examples:

- prompts
- model responses
- tool inputs
- tool outputs
- retrieved documents
- stack traces

Artifacts may be stored inline or in object storage.

---

# Telemetry Model

AgentScope uses a hierarchical model: