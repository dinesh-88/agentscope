from __future__ import annotations

from pathlib import Path

from agentscope import observe_run

from tools import read_file, run_fake_command, simulate_llm_fix, write_fixed_file


def process_file(project_dir: Path, source_name: str, output_name: str) -> None:
    source_path = project_dir / source_name
    output_path = project_dir / output_name

    original = read_file(source_path)
    updated = simulate_llm_fix(source_path, original)
    write_fixed_file(output_path, original, updated)
    run_fake_command(project_dir, output_path)


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1] / "sample_project"

    with observe_run("sandbox_python_agent", agent_name="sandbox_python_agent"):
        process_file(project_dir, "buggy.py", "buggy.python.fixed.py")
        process_file(project_dir, "buggy.ts", "buggy.python.fixed.ts")

    print("sandbox_python_agent completed")


if __name__ == "__main__":
    main()
