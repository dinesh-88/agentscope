import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const { observeSpan, addArtifact } = require(path.resolve(process.cwd(), "packages/ts-sdk/dist"));

function readFile(filePath: string): Promise<string> {
  return observeSpan(
    "file_read",
    () => fs.readFileSync(filePath, "utf8"),
    {
      metadata: {
        file_path: filePath,
      },
    },
  );
}

function simulateLlmFix(filePath: string, source: string): Promise<string> {
  return observeSpan(
    "llm_call",
    async () => {
      addArtifact("llm.prompt", {
        model: "debugger-sim-1",
        messages: [
          {
            role: "system",
            content: "Review the file and propose a safe local fix without changing the overall structure.",
          },
          {
            role: "user",
            content: `Fix the bug in ${path.basename(filePath)} and explain the edit briefly.\n\n${source}`,
          },
        ],
      });

      let updated = source;
      let summary = "No changes suggested.";

      if (filePath.endsWith(".py")) {
        updated = source.replace("return total // count", "return total / count");
        summary = "Replace floor division with true division so the average keeps fractional values.";
      } else if (filePath.endsWith(".ts")) {
        updated = source.replace('return items[1].toUpperCase();', 'return (items[0] ?? "unknown").toUpperCase();');
        summary = "Use the first item with a fallback instead of indexing past the available element.";
      }

      addArtifact("llm.response", {
        id: randomUUID(),
        content: summary,
        updated_preview: updated,
      });

      return updated;
    },
    {
      metadata: {
        file_path: filePath,
        provider: "sandbox",
        model: "debugger-sim-1",
        operation: "propose_fix",
      },
    },
  );
}

function writeFixedFile(filePath: string, original: string, updated: string): Promise<void> {
  return observeSpan(
    "file_write",
    async () => {
      fs.writeFileSync(filePath, updated, "utf8");

      addArtifact("file.diff", {
        file_path: filePath,
        diff: buildUnifiedDiff(path.basename(filePath), original, updated),
      });
    },
    {
      metadata: {
        file_path: filePath,
      },
    },
  );
}

function runFakeCommand(projectDir: string, targetFile: string): Promise<string> {
  return observeSpan(
    "command_exec",
    async () => {
      const stdout = execFileSync("sh", ["-c", `printf 'sandbox check passed for ${path.basename(targetFile)}\\n'`], {
        cwd: projectDir,
        encoding: "utf8",
      });

      addArtifact("command.stdout", {
        command: `printf sandbox check passed for ${path.basename(targetFile)}`,
        cwd: projectDir,
        stdout,
        exit_code: 0,
      });

      return stdout;
    },
    {
      metadata: {
        command: `sandbox check ${path.basename(targetFile)}`,
        cwd: projectDir,
        exit_code: 0,
      },
    },
  );
}

function buildUnifiedDiff(fileName: string, original: string, updated: string): string {
  const originalLines = original.split("\n");
  const updatedLines = updated.split("\n");

  if (original === updated) {
    return `--- a/${fileName}\n+++ b/${fileName}\n`;
  }

  const diff: string[] = [`--- a/${fileName}`, `+++ b/${fileName}`];
  const maxLines = Math.max(originalLines.length, updatedLines.length);

  for (let index = 0; index < maxLines; index += 1) {
    const before = originalLines[index];
    const after = updatedLines[index];

    if (before === after) {
      if (before !== undefined) {
        diff.push(` ${before}`);
      }
      continue;
    }

    if (before !== undefined) {
      diff.push(`-${before}`);
    }
    if (after !== undefined) {
      diff.push(`+${after}`);
    }
  }

  return `${diff.join("\n")}\n`;
}

export async function processFile(projectDir: string, sourceName: string, outputName: string): Promise<void> {
  const sourcePath = path.join(projectDir, sourceName);
  const outputPath = path.join(projectDir, outputName);

  const original = await readFile(sourcePath);
  const updated = await simulateLlmFix(sourcePath, original);
  await writeFixedFile(outputPath, original, updated);
  await runFakeCommand(projectDir, outputPath);
}
