from __future__ import annotations

import difflib
import subprocess
import uuid
from pathlib import Path
from typing import Any

from agentscope.run import _current_run_state
from agentscope.span import observe_span


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


def read_file(path: Path) -> str:
    with observe_span("file_read") as span:
        span["metadata"] = {"file_path": str(path)}
        return path.read_text(encoding="utf-8")


def simulate_llm_fix(path: Path, source: str) -> str:
    with observe_span("llm_call") as span:
        span["metadata"] = {
            "file_path": str(path),
            "provider": "sandbox",
            "model": "debugger-sim-1",
            "operation": "propose_fix",
        }
        add_artifact(
            span,
            "llm.prompt",
            {
                "model": "debugger-sim-1",
                "messages": [
                    {
                        "role": "system",
                        "content": "Review the file and propose a safe local fix without changing the overall structure.",
                    },
                    {
                        "role": "user",
                        "content": f"Fix the bug in {path.name} and explain the edit briefly.\n\n{source}",
                    },
                ],
            },
        )

        fixed = source
        response = "No changes suggested."

        if path.suffix == ".py":
            fixed = source.replace("return total // count", "return total / count")
            response = (
                "Replace floor division with true division so the average keeps fractional values."
            )
        elif path.suffix == ".ts":
            fixed = source.replace("return items[1].toUpperCase();", 'return (items[0] ?? "unknown").toUpperCase();')
            response = (
                "Use the first item with a fallback instead of indexing past the available element."
            )

        add_artifact(
            span,
            "llm.response",
            {
                "content": response,
                "updated_preview": fixed,
            },
        )
        return fixed


def write_fixed_file(path: Path, original: str, updated: str) -> None:
    with observe_span("file_write") as span:
        span["metadata"] = {"file_path": str(path)}
        path.write_text(updated, encoding="utf-8")
        diff = "".join(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                updated.splitlines(keepends=True),
                fromfile=f"a/{path.name}",
                tofile=f"b/{path.name}",
            )
        )
        add_artifact(
            span,
            "file.diff",
            {
                "file_path": str(path),
                "diff": diff,
            },
        )


def run_fake_command(project_dir: Path, target: Path) -> subprocess.CompletedProcess[str]:
    with observe_span("command_exec") as span:
        command = [
            "sh",
            "-c",
            f"printf 'sandbox check passed for {target.name}\\n'",
        ]
        completed = subprocess.run(
            command,
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        span["metadata"] = {
            "command": " ".join(command),
            "cwd": str(project_dir),
            "exit_code": completed.returncode,
        }
        add_artifact(
            span,
            "command.stdout",
            {
                "command": " ".join(command),
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "exit_code": completed.returncode,
            },
        )
        return completed
