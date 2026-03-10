from __future__ import annotations

import difflib
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from agentscope import auto_instrument, observe_run, observe_span
from agentscope.run import _current_run_state


ROOT_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ROOT_DIR / "sample_project"
SOURCE_PATH = PROJECT_DIR / "buggy.py"
OUTPUT_PATH = PROJECT_DIR / "buggy_fixed.py"
MODEL = "gpt-4o-mini"


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


def strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if not cleaned.startswith("```"):
        return cleaned

    lines = cleaned.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def planner_agent(client: Any) -> str:
    with observe_span("planner_agent") as agent_span:
        agent_span["metadata"] = {"role": "planner", "model": MODEL}
        with observe_span("llm_call_plan", span_type="llm_call_plan") as plan_span:
            plan_span["metadata"] = {"role": "planner", "model": MODEL, "file_path": str(SOURCE_PATH)}
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "You are a planning agent."},
                    {"role": "user", "content": "Analyze the bug and propose a fix."},
                ],
            )
            return response.choices[0].message.content or ""


def code_fix_agent(client: Any) -> str:
    with observe_span("code_fix_agent") as agent_span:
        agent_span["metadata"] = {"role": "coder", "model": MODEL}

        with observe_span("file_read") as span:
            span["metadata"] = {"file_path": str(SOURCE_PATH)}
            source = SOURCE_PATH.read_text(encoding="utf-8")
            add_artifact(
                span,
                "file.content",
                {
                    "file_path": str(SOURCE_PATH),
                    "content": source,
                },
            )

        with observe_span("llm_call_fix", span_type="llm_call_fix") as span:
            span["metadata"] = {"role": "coder", "model": MODEL, "file_path": str(SOURCE_PATH)}
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "Return corrected Python code only. Do not include markdown fences."},
                    {"role": "user", "content": f"Fix the bug in the code.\n\n{source}"},
                ],
            )
            fixed = strip_code_fence(response.choices[0].message.content or "")

        with observe_span("file_write") as span:
            span["metadata"] = {"file_path": str(OUTPUT_PATH)}
            normalized = fixed.rstrip() + "\n"
            OUTPUT_PATH.write_text(normalized, encoding="utf-8")
            diff = "".join(
                difflib.unified_diff(
                    source.splitlines(keepends=True),
                    normalized.splitlines(keepends=True),
                    fromfile=f"a/{SOURCE_PATH.name}",
                    tofile=f"b/{OUTPUT_PATH.name}",
                )
            )
            add_artifact(
                span,
                "file.diff",
                {
                    "file_path": str(OUTPUT_PATH),
                    "diff": diff,
                },
            )

        return OUTPUT_PATH.name


def tester_agent(target_name: str) -> subprocess.CompletedProcess[str]:
    with observe_span("tester_agent") as agent_span:
        agent_span["metadata"] = {"role": "tester", "target_file": target_name}
        with observe_span("command_exec") as span:
            python_bin = shutil.which("python") or sys.executable
            completed = subprocess.run(
                [python_bin, target_name],
                cwd=PROJECT_DIR,
                capture_output=True,
                text=True,
                check=False,
            )
            span["metadata"] = {
                "command": f"python {target_name}",
                "cwd": str(PROJECT_DIR),
                "exit_code": completed.returncode,
            }
            add_artifact(
                span,
                "command.stdout",
                {
                    "command": f"python {target_name}",
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                    "exit_code": completed.returncode,
                },
            )
            return completed


def main() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required to run the multi-agent sandbox")

    auto_instrument(["openai"])
    from openai import OpenAI

    client = OpenAI()

    with observe_run("sandbox_multi_agent", agent_name="sandbox_multi_agent"):
        _plan = planner_agent(client)
        target_name = code_fix_agent(client)
        result = tester_agent(target_name)

    if result.returncode != 0:
        raise SystemExit(result.returncode)

    print("sandbox_multi_agent completed")


if __name__ == "__main__":
    main()
