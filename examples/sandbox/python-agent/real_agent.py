from __future__ import annotations

import difflib
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
SDK_PATH = REPO_ROOT / "packages" / "python-sdk"
if SDK_PATH.exists():
    sys.path.insert(0, str(SDK_PATH))

from agentscope import auto_instrument, observe_run, observe_span  # noqa: E402
from agentscope.run import _current_run_state  # noqa: E402


ROOT_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ROOT_DIR / "sample_project"
SOURCE_PATH = PROJECT_DIR / "buggy.py"
OUTPUT_PATH = PROJECT_DIR / "buggy_fixed.py"
MODEL = "gpt-4o-mini"


def _load_openai_api_key_from_dotenv() -> None:
    if os.environ.get("OPENAI_API_KEY"):
        return

    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != "OPENAI_API_KEY":
            continue

        cleaned = value.strip().strip('"').strip("'")
        if cleaned:
            os.environ["OPENAI_API_KEY"] = cleaned
        return


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


def read_source_file(path: Path) -> str:
    with observe_span("file_read") as span:
        span["metadata"] = {"file_path": str(path)}
        content = path.read_text(encoding="utf-8")
        add_artifact(
            span,
            "file.content",
            {
                "file_path": str(path),
                "content": content,
            },
        )
        return content


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


def llm_analysis(client: Any, source: str) -> str:
    with observe_span("llm_call_analysis", span_type="llm_call_analysis") as span:
        span["metadata"] = {"model": MODEL, "operation": "analyze_bug", "file_path": str(SOURCE_PATH)}
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a precise Python code reviewer."},
                {"role": "user", "content": f"Analyze this Python code and explain the bug.\n\n{source}"},
            ],
        )
        return response.choices[0].message.content or ""


def llm_fix(client: Any, source: str) -> str:
    with observe_span("llm_call_fix", span_type="llm_call_fix") as span:
        span["metadata"] = {"model": MODEL, "operation": "fix_bug", "file_path": str(SOURCE_PATH)}
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "Return corrected Python code only. Do not include markdown fences."},
                {"role": "user", "content": f"Fix this Python code and return corrected code only.\n\n{source}"},
            ],
        )
        content = response.choices[0].message.content or ""
        return strip_code_fence(content)


def write_fixed_file(path: Path, original: str, updated: str) -> None:
    with observe_span("file_write") as span:
        span["metadata"] = {"file_path": str(path)}
        path.write_text(updated.rstrip() + "\n", encoding="utf-8")
        diff = "".join(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                (updated.rstrip() + "\n").splitlines(keepends=True),
                fromfile=f"a/{SOURCE_PATH.name}",
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


def run_verification(project_dir: Path, target: Path) -> subprocess.CompletedProcess[str]:
    with observe_span("command_exec") as span:
        python_bin = shutil.which("python") or sys.executable
        completed = subprocess.run(
            [python_bin, target.name],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        span["metadata"] = {
            "command": f"python {target.name}",
            "cwd": str(project_dir),
            "exit_code": completed.returncode,
        }
        add_artifact(
            span,
            "command.stdout",
            {
                "command": f"python {target.name}",
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "exit_code": completed.returncode,
            },
        )
        return completed


def main() -> None:
    _load_openai_api_key_from_dotenv()
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is required to run the real sandbox agent. Set it in the environment or in repo .env."
        )

    auto_instrument(["openai"])
    try:
        from openai import OpenAI
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Python package 'openai' is required for sandbox real agent. Install it in the interpreter used by API "
            "(for example: pip install openai)."
        ) from exc

    client = OpenAI()

    with observe_run("sandbox_real_agent", agent_name="sandbox_real_agent"):
        source = read_source_file(SOURCE_PATH)
        _analysis = llm_analysis(client, source)
        fixed = llm_fix(client, source)
        write_fixed_file(OUTPUT_PATH, source, fixed)
        result = run_verification(PROJECT_DIR, OUTPUT_PATH)

    if result.returncode != 0:
        raise SystemExit(result.returncode)

    print("sandbox_real_agent completed")


if __name__ == "__main__":
    main()
