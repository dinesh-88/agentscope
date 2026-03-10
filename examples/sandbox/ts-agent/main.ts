import path from "node:path";

const { observeRun } = require(path.resolve(process.cwd(), "packages/ts-sdk/dist"));

import { processFile } from "./tools";

async function main(): Promise<void> {
  const projectDir = path.resolve(process.cwd(), "examples/sandbox/sample_project");

  await observeRun(
    "sandbox_ts_agent",
    async () => {
      await processFile(projectDir, "buggy.py", "buggy.tsagent.fixed.py");
      await processFile(projectDir, "buggy.ts", "buggy.tsagent.fixed.ts");
    },
    {
      agentName: "sandbox_ts_agent",
    },
  );

  console.log("sandbox_ts_agent completed");
}

void main();
