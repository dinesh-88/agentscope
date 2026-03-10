from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from agentscope import observe_run
from agentscope.exporter import TelemetryExporter
from agentscope.run import _current_run_state
from agentscope.span import observe_span


class BufferingExporter:
    def export(self, run: dict[str, Any], spans: list[dict[str, Any]], artifacts: list[dict[str, Any]]) -> None:
        self.run = run
        self.spans = spans
        self.artifacts = artifacts


def add_artifact(span: dict[str, Any], kind: str, payload: dict[str, Any]) -> None:
    run_state = _current_run_state()
    if run_state is None:
        raise RuntimeError("add_artifact must be called inside observe_run")

    run_state.artifacts.append(
        {
            "id": str(uuid.uuid4()),
            "run_id": span["run_id"],
            "span_id": span["id"],
            "kind": kind,
            "payload": payload,
        }
    )


def main() -> None:
    source_path = Path(__file__).resolve().parents[1] / "sample_project" / "buggy.rs"
    exporter = BufferingExporter()

    with observe_run(
        "sandbox_broken_agent",
        agent_name="sandbox_broken_agent",
        exporter=exporter,
    ) as run:
        run_state = _current_run_state()
        if run_state is None:
            raise RuntimeError("observe_run state was not initialized")

        with observe_span("file_read") as span:
            span["metadata"] = {"file_path": str(source_path)}
            source = source_path.read_text(encoding="utf-8")
            add_artifact(
                span,
                "file.content",
                {
                    "file_path": str(source_path),
                    "content": source,
                },
            )

        prompt = "\n".join(
            [
                "You are a coding assistant.",
                "Fix the Rust borrow checker error in this file.",
                "Return JSON:",
                "",
                "{",
                '  "patch": "...",',
                '  "explanation": "..."',
                "}",
            ]
        )

        response = "Sure! The issue is caused by..."

        with observe_span("llm_call") as span:
            span["metadata"] = {
                "file_path": str(source_path),
                "provider": "sandbox",
                "model": "debugger-sim-1",
                "operation": "generate_patch",
            }
            add_artifact(
                span,
                "llm.prompt",
                {
                    "prompt": prompt,
                    "file_path": str(source_path),
                    "input": source,
                },
            )
            add_artifact(
                span,
                "llm.response",
                {
                    "content": response,
                },
            )

        parse_error = ""
        schema_span: dict[str, Any] | None = None
        with observe_span("schema_validation") as span:
            schema_span = span
            span["metadata"] = {
                "expected_schema": ["patch", "explanation"],
                "error": "JSON parse error",
            }
            try:
                json.loads(response)
            except json.JSONDecodeError as exc:
                parse_error = f"JSON parse error: {exc.msg}"
                add_artifact(
                    span,
                    "error",
                    {
                        "error_type": "JSONDecodeError",
                        "message": parse_error,
                    },
                )
            else:
                parse_error = "JSON parse error: invalid simulation"
                add_artifact(
                    span,
                    "error",
                    {
                        "error_type": "SchemaValidationError",
                        "message": parse_error,
                    },
                )
        if schema_span is not None:
            schema_span["status"] = "error"

        run_state.run["status"] = "error"

    run["status"] = "error"
    TelemetryExporter().export(run, exporter.spans, exporter.artifacts)
    print("sandbox_broken_agent completed with status=error")


if __name__ == "__main__":
    main()
