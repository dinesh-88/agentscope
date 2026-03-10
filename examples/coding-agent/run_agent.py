from __future__ import annotations

import os
from pathlib import Path

from agentscope.coding_agent import coding_agent_run, read_file, run_command, write_file


def maybe_call_llm() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        return

    try:
        from openai import OpenAI
    except Exception:
        return

    client = OpenAI()
    client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[
            {
                "role": "user",
                "content": "Reply with the single word: instrumented",
            }
        ],
    )


def main() -> None:
    workspace = Path("examples/coding-agent/workspace")
    source_path = workspace / "notes.txt"
    output_path = workspace / "summary.txt"

    workspace.mkdir(parents=True, exist_ok=True)
    if not source_path.exists():
        source_path.write_text("Todo:\n- inspect repository\n- add tracing\n", encoding="utf-8")

    with coding_agent_run() as run:
        source = read_file(source_path)
        summary = source + "\nCompleted:\n- traced file reads\n- traced file writes\n- traced shell commands\n"
        write_file(output_path, summary)
        run_command(["python3", "-c", "print('lint placeholder')"], cwd=workspace)
        maybe_call_llm()
        print(run["id"])


if __name__ == "__main__":
    main()
