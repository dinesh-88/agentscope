"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const { observeRun } = require(node_path_1.default.resolve(process.cwd(), "packages/ts-sdk/dist"));
const tools_1 = require("./tools");
async function main() {
    const projectDir = node_path_1.default.resolve(process.cwd(), "examples/sandbox/sample_project");
    await observeRun("sandbox_ts_agent", async () => {
        await (0, tools_1.processFile)(projectDir, "buggy.py", "buggy.tsagent.fixed.py");
        await (0, tools_1.processFile)(projectDir, "buggy.ts", "buggy.tsagent.fixed.ts");
    }, {
        agentName: "sandbox_ts_agent",
    });
    console.log("sandbox_ts_agent completed");
}
void main();
