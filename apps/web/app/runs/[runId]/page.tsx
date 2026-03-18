"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Clock, Database, Zap } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { mockRuns, mockSpans } from "@/figma/src/app/data/mockData";
import { type Span } from "@/figma/src/app/types";

function getSpanIcon(type: string) {
  switch (type) {
    case "llm":
      return Zap;
    case "tool":
    case "retrieval":
      return Database;
    case "agent":
      return Bot;
    default:
      return Clock;
  }
}

function getSpanColor(type: string) {
  switch (type) {
    case "llm":
      return "bg-purple-100 text-purple-700";
    case "tool":
      return "bg-blue-100 text-blue-700";
    case "agent":
      return "bg-green-100 text-green-700";
    case "retrieval":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "running":
      return "bg-blue-100 text-blue-800";
    case "failed":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(date);
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params?.runId;
  const run = mockRuns.find((item) => item.id === runId);
  const spans = mockSpans.filter((item) => item.runId === runId);
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  function toggleSpan(spanId: string) {
    const next = new Set(expandedSpans);
    if (next.has(spanId)) {
      next.delete(spanId);
    } else {
      next.add(spanId);
    }
    setExpandedSpans(next);
  }

  if (!run) {
    return (
      <AppShell activePath="/runs">
        <div className="p-8">
          <p className="text-gray-600">Run not found</p>
        </div>
      </AppShell>
    );
  }

  const rootSpans = spans.filter((span) => !span.parentId);
  const getChildSpans = (parentId: string) => spans.filter((span) => span.parentId === parentId);

  function renderSpan(span: Span, level = 0): React.ReactNode {
    const isExpanded = expandedSpans.has(span.id);
    const hasChildren = spans.some((item) => item.parentId === span.id);
    const Icon = getSpanIcon(span.type);

    return (
      <div key={span.id} className="border-b border-gray-100 last:border-0">
        <div
          className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
          style={{ paddingLeft: `${level * 24 + 16}px` }}
          onClick={() => {
            if (hasChildren) toggleSpan(span.id);
            setSelectedSpan(span);
          }}
        >
          {hasChildren ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleSpan(span.id);
              }}
              type="button"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </button>
          ) : (
            <div className="w-4" />
          )}

          <div className={`rounded p-1.5 ${getSpanColor(span.type)}`}>
            <Icon className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{span.name}</p>
            <p className="text-xs text-gray-500">{formatTime(span.startTime)}</p>
          </div>

          <div className="flex items-center gap-4">
            <span className={`rounded px-2 py-1 text-xs font-medium capitalize ${getSpanColor(span.type)}`}>{span.type}</span>
            <span className="min-w-[60px] text-right text-sm text-gray-600">{formatDuration(span.duration)}</span>
          </div>
        </div>

        {hasChildren && isExpanded ? <div>{getChildSpans(span.id).map((child) => renderSpan(child, level + 1))}</div> : null}
      </div>
    );
  }

  return (
    <AppShell activePath="/runs">
      <div className="p-8">
        <div className="mb-6">
          <Link href="/runs" className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            Back to Runs
          </Link>
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">{run.name}</h1>
          <div className="flex items-center gap-4">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium capitalize ${getStatusColor(run.status)}`}>
              {run.status}
            </span>
            <span className="text-sm text-gray-600">Agent: {run.agentName}</span>
            <span className="text-sm text-gray-600">Duration: {formatDuration(run.duration)}</span>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">Tokens Used</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{run.tokensUsed.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">Cost</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">${run.cost.toFixed(3)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">Spans</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{spans.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">Created At</p>
            <p className="mt-2 text-base font-semibold text-gray-900">
              {new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(run.createdAt)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="p-6 pb-4">
              <h2 className="text-base font-medium text-gray-900">Span Timeline</h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto p-0">{rootSpans.map((span) => renderSpan(span))}</div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="p-6 pb-4">
              <h2 className="text-base font-medium text-gray-900">Span Details</h2>
            </div>
            <div className="p-6">
              {selectedSpan ? (
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-gray-900">Metadata</h4>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <dl className="space-y-2">
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-600">Type</dt>
                          <dd className="text-sm font-medium capitalize text-gray-900">{selectedSpan.type}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-600">Duration</dt>
                          <dd className="text-sm font-medium text-gray-900">{formatDuration(selectedSpan.duration)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-600">Status</dt>
                          <dd className="text-sm font-medium capitalize text-gray-900">{selectedSpan.status}</dd>
                        </div>
                        {Object.entries(selectedSpan.metadata).map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-6">
                            <dt className="text-sm capitalize text-gray-600">{key.replace(/_/g, " ")}</dt>
                            <dd className="text-right text-sm font-medium text-gray-900">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>

                  {selectedSpan.prompt ? (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-gray-900">Prompt</h4>
                      <div className="max-h-[200px] overflow-y-auto rounded-lg bg-gray-50 p-4">
                        <pre className="font-mono text-sm whitespace-pre-wrap text-gray-700">{selectedSpan.prompt}</pre>
                      </div>
                    </div>
                  ) : null}

                  {selectedSpan.response ? (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-gray-900">Response</h4>
                      <div className="max-h-[200px] overflow-y-auto rounded-lg bg-gray-50 p-4">
                        <pre className="font-mono text-sm whitespace-pre-wrap text-gray-700">{selectedSpan.response}</pre>
                      </div>
                    </div>
                  ) : null}

                  {selectedSpan.artifacts && Object.keys(selectedSpan.artifacts).length > 0 ? (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-gray-900">Artifacts</h4>
                      <div className="max-h-[200px] overflow-y-auto rounded-lg bg-gray-50 p-4">
                        <pre className="font-mono text-sm whitespace-pre-wrap text-gray-700">
                          {JSON.stringify(selectedSpan.artifacts, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-sm">Select a span to view details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
