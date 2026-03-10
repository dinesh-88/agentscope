"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processFile = processFile;
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const { observeSpan, addArtifact } = require(node_path_1.default.resolve(process.cwd(), "packages/ts-sdk/dist"));
function readFile(filePath) {
    return observeSpan("file_read", () => node_fs_1.default.readFileSync(filePath, "utf8"), {
        metadata: {
            file_path: filePath,
        },
    });
}
function simulateLlmFix(filePath, source) {
    return observeSpan("llm_call", async () => {
        addArtifact("llm.prompt", {
            model: "debugger-sim-1",
            messages: [
                {
                    role: "system",
                    content: "Review the file and propose a safe local fix without changing the overall structure.",
                },
                {
                    role: "user",
                    content: `Fix the bug in ${node_path_1.default.basename(filePath)} and explain the edit briefly.\n\n${source}`,
                },
            ],
        });
        let updated = source;
        let summary = "No changes suggested.";
        if (filePath.endsWith(".py")) {
            updated = source.replace("return total // count", "return total / count");
            summary = "Replace floor division with true division so the average keeps fractional values.";
        }
        else if (filePath.endsWith(".ts")) {
            updated = source.replace('return items[1].toUpperCase();', 'return (items[0] ?? "unknown").toUpperCase();');
            summary = "Use the first item with a fallback instead of indexing past the available element.";
        }
        addArtifact("llm.response", {
            id: (0, node_crypto_1.randomUUID)(),
            content: summary,
            updated_preview: updated,
        });
        return updated;
    }, {
        metadata: {
            file_path: filePath,
            provider: "sandbox",
            model: "debugger-sim-1",
            operation: "propose_fix",
        },
    });
}
function writeFixedFile(filePath, original, updated) {
    return observeSpan("file_write", async () => {
        node_fs_1.default.writeFileSync(filePath, updated, "utf8");
        addArtifact("file.diff", {
            file_path: filePath,
            diff: buildUnifiedDiff(node_path_1.default.basename(filePath), original, updated),
        });
    }, {
        metadata: {
            file_path: filePath,
        },
    });
}
function runFakeCommand(projectDir, targetFile) {
    return observeSpan("command_exec", async () => {
        const stdout = (0, node_child_process_1.execFileSync)("sh", ["-c", `printf 'sandbox check passed for ${node_path_1.default.basename(targetFile)}\\n'`], {
            cwd: projectDir,
            encoding: "utf8",
        });
        addArtifact("command.stdout", {
            command: `printf sandbox check passed for ${node_path_1.default.basename(targetFile)}`,
            cwd: projectDir,
            stdout,
            exit_code: 0,
        });
        return stdout;
    }, {
        metadata: {
            command: `sandbox check ${node_path_1.default.basename(targetFile)}`,
            cwd: projectDir,
            exit_code: 0,
        },
    });
}
function buildUnifiedDiff(fileName, original, updated) {
    const originalLines = original.split("\n");
    const updatedLines = updated.split("\n");
    if (original === updated) {
        return `--- a/${fileName}\n+++ b/${fileName}\n`;
    }
    const diff = [`--- a/${fileName}`, `+++ b/${fileName}`];
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
async function processFile(projectDir, sourceName, outputName) {
    const sourcePath = node_path_1.default.join(projectDir, sourceName);
    const outputPath = node_path_1.default.join(projectDir, outputName);
    const original = await readFile(sourcePath);
    const updated = await simulateLlmFix(sourcePath, original);
    await writeFixedFile(outputPath, original, updated);
    await runFakeCommand(projectDir, outputPath);
}
