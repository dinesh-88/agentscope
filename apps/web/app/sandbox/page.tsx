"use client";

import { useState } from "react";
import { CheckCircle, Loader2, PlayCircle, XCircle } from "lucide-react";

import { AppShell } from "@/components/app-shell";

type WorkflowDemo = {
  id: string;
  name: string;
  description: string;
  estimatedDuration: string;
};

const demoWorkflows: WorkflowDemo[] = [
  {
    id: "demo_1",
    name: "Customer Support Flow",
    description: "Analyze customer inquiry, retrieve knowledge base, and generate response",
    estimatedDuration: "~5s",
  },
  {
    id: "demo_2",
    name: "Data Extraction",
    description: "Extract structured data from unstructured documents",
    estimatedDuration: "~8s",
  },
  {
    id: "demo_3",
    name: "Code Review",
    description: "Analyze code quality and suggest improvements",
    estimatedDuration: "~10s",
  },
  {
    id: "demo_4",
    name: "Sentiment Analysis",
    description: "Classify sentiment and extract key themes from text",
    estimatedDuration: "~4s",
  },
  {
    id: "demo_5",
    name: "Document Summarization",
    description: "Generate concise summary of long-form content",
    estimatedDuration: "~6s",
  },
  {
    id: "demo_6",
    name: "Multi-Step Research",
    description: "Chain multiple LLM calls with web search and synthesis",
    estimatedDuration: "~15s",
  },
];

type RunStatus = "idle" | "running" | "success" | "error";

function getStatusIcon(status: RunStatus | undefined) {
  switch (status) {
    case "running":
      return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
    case "success":
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    case "error":
      return <XCircle className="h-5 w-5 text-red-600" />;
    default:
      return <PlayCircle className="h-5 w-5" />;
  }
}

function getStatusText(status: RunStatus | undefined) {
  switch (status) {
    case "running":
      return "Running...";
    case "success":
      return "Completed";
    case "error":
      return "Failed";
    default:
      return "Run";
  }
}

export default function SandboxPage() {
  const [runningWorkflows, setRunningWorkflows] = useState<Record<string, RunStatus>>({});

  async function runWorkflow(workflowId: string) {
    setRunningWorkflows((prev) => ({ ...prev, [workflowId]: "running" }));

    await new Promise((resolve) => {
      window.setTimeout(resolve, 2000 + Math.random() * 2000);
    });

    const success = true;
    setRunningWorkflows((prev) => ({ ...prev, [workflowId]: success ? "success" : "error" }));

    window.setTimeout(() => {
      setRunningWorkflows((prev) => {
        const next = { ...prev };
        delete next[workflowId];
        return next;
      });
    }, 3000);
  }

  return (
    <AppShell activePath="/sandbox">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Sandbox</h1>
          <p className="text-gray-600">Test and experiment with demo workflows</p>
        </div>

        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-medium text-gray-900">Quick Start</h2>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm text-blue-900">
              Select any workflow below to run a demo. The sandbox environment uses mock data and simulates agent behavior without
              consuming real tokens or making API calls.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {demoWorkflows.map((workflow) => {
            const status = runningWorkflows[workflow.id];
            const isRunning = status === "running";
            return (
              <div key={workflow.id} className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="text-lg font-medium text-gray-900">{workflow.name}</h3>
                <p className="mt-1 text-sm text-gray-600">{workflow.description}</p>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">{workflow.estimatedDuration}</span>
                  <button
                    onClick={() => runWorkflow(workflow.id)}
                    disabled={isRunning}
                    type="button"
                    className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {getStatusIcon(status)}
                    <span className="ml-2">{getStatusText(status)}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-medium text-gray-900">Recent Activity</h2>
          <div className="space-y-2">
            {Object.entries(runningWorkflows).length > 0 ? (
              Object.entries(runningWorkflows).map(([workflowId, status]) => {
                const workflow = demoWorkflows.find((item) => item.id === workflowId);
                if (!workflow) return null;
                return (
                  <div key={workflowId} className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                    {getStatusIcon(status)}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{workflow.name}</p>
                      <p className="text-xs text-gray-600 capitalize">{status}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">No recent activity. Run a workflow to see it here.</p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
