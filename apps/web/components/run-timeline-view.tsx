"use client";

import { Maximize2, Search, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";

import { PromptPayloadPanel } from "@/components/prompt-payload-panel";
import { type Artifact, type Span } from "@/lib/api";

type TimelineStepType = "llm" | "tool";
type TimelineStepStatus = "success" | "warning" | "error";

type TimelineStep = {
  id: number;
  stepKey: string;
  type: TimelineStepType;
  name: string;
  status: TimelineStepStatus;
  start: number;
  end: number;
  depth: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
  model?: string;
  promptPayload?: unknown;
  prompt?: string;
  responsePayload?: unknown;
  response?: string;
  metadata?: Record<string, unknown>;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  warning?: string;
  error?: string;
  errorDetails?: string;
  stackTrace?: string;
};

type TimelineLogEntry = {
  id: string;
  level: "error" | "warning" | "info";
  source: string;
  message: string;
};

type RunTimelineViewProps = {
  spans: Span[];
  artifacts?: Artifact[];
};

function chooseTickStep(maxTimeMs: number) {
  if (!Number.isFinite(maxTimeMs) || maxTimeMs <= 0) return 5;
  const targetTickCount = 14;
  const rawStep = maxTimeMs / targetTickCount;
  const candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const step of candidates) {
    if (rawStep <= step) return step;
  }
  return 5000;
}

function formatTimelineTime(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function spanDurationMs(span: Span) {
  if (typeof span.latency_ms === "number" && Number.isFinite(span.latency_ms)) {
    return Math.max(0, span.latency_ms);
  }
  if (!span.started_at || !span.ended_at) return 0;
  const start = new Date(span.started_at).getTime();
  const end = new Date(span.ended_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function isToolSpan(span: Span) {
  return span.span_type.toLowerCase().includes("tool") || typeof span.tool_name === "string";
}

function toTimelineStatus(span: Span): TimelineStepStatus {
  const status = span.status.toLowerCase();
  if (status === "failed" || status === "error" || span.success === false) return "error";
  if (status === "warning") return "warning";
  return "success";
}

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function pickStringFromObjects(objects: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const source of objects) {
    if (!source) continue;
    for (const key of keys) {
      const value = toStringValue(source[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function pickObjectFromObjects(objects: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const source of objects) {
    if (!source) continue;
    for (const key of keys) {
      const value = toObject(source[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function pickValueFromObjects(objects: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const source of objects) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function payloadToText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const direct = toStringValue(object.message) ?? toStringValue(object.content) ?? toStringValue(object.output) ?? toStringValue(object.result);
    if (direct) return direct;
    try {
      return JSON.stringify(object, null, 2);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function truncateText(value: string, max = 320) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function toLogText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const fromMessage = toStringValue(object.message) ?? toStringValue(object.error) ?? toStringValue(object.detail);
    if (fromMessage) return fromMessage;
    try {
      return JSON.stringify(object);
    } catch {
      return null;
    }
  }
  return null;
}

function extractLogsFromMetadata(metadata?: Record<string, unknown>): string[] {
  if (!metadata) return [];
  const keys = ["log", "logs", "message", "messages", "event", "events", "stderr", "stdout"];
  const entries: string[] = [];

  for (const key of keys) {
    const raw = metadata[key];
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      for (const item of raw) {
        const text = toLogText(item);
        if (text) entries.push(text);
      }
      continue;
    }

    const text = toLogText(raw);
    if (text) entries.push(text);
  }

  const deduped = Array.from(new Set(entries.map((entry) => entry.trim()).filter(Boolean)));
  return deduped.slice(0, 8);
}

function buildStepLogs(step: TimelineStep): TimelineLogEntry[] {
  const items: TimelineLogEntry[] = [];
  const seen = new Set<string>();

  const push = (level: TimelineLogEntry["level"], source: string, message?: string) => {
    if (!message) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    const key = `${level}|${source}|${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: `${step.stepKey}-${items.length + 1}`,
      level,
      source,
      message: truncateText(trimmed),
    });
  };

  push("info", "status", `${step.status.toUpperCase()} (${Math.round(step.end - step.start)}ms)`);
  push("error", "error", step.error);
  push("error", "details", step.errorDetails);
  push("error", "stack", step.stackTrace);
  push("warning", "warning", step.warning);
  push("info", "response", step.response);

  for (const metadataLog of extractLogsFromMetadata(step.metadata)) {
    const level = /error|fail|exception/i.test(metadataLog) ? "error" : /warn/i.test(metadataLog) ? "warning" : "info";
    push(level, "metadata", metadataLog);
  }

  return items;
}

function buildDepthResolver(spans: Span[]) {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const memo = new Map<string, number>();

  function resolveDepth(span: Span, stack = new Set<string>()): number {
    const cached = memo.get(span.id);
    if (cached !== undefined) return cached;
    if (!span.parent_span_id || !byId.has(span.parent_span_id)) {
      memo.set(span.id, 0);
      return 0;
    }
    if (stack.has(span.id)) {
      memo.set(span.id, 0);
      return 0;
    }
    stack.add(span.id);
    const parent = byId.get(span.parent_span_id);
    const depth = parent ? resolveDepth(parent, stack) + 1 : 0;
    stack.delete(span.id);
    memo.set(span.id, depth);
    return depth;
  }

  return resolveDepth;
}

function buildArtifactPayloadIndex(artifacts: Artifact[] | undefined) {
  const promptPayloadBySpan = new Map<string, Record<string, unknown>>();
  const responsePayloadBySpan = new Map<string, Record<string, unknown>>();

  for (const artifact of artifacts ?? []) {
    if (!artifact.span_id) continue;
    const payload = toObject(artifact.payload);
    if (!payload) continue;

    const kind = artifact.kind.toLowerCase();
    if (kind.includes("prompt")) {
      promptPayloadBySpan.set(artifact.span_id, payload);
      continue;
    }
    if (kind.includes("response")) {
      responsePayloadBySpan.set(artifact.span_id, payload);
    }
  }

  return { promptPayloadBySpan, responsePayloadBySpan };
}

function toTimelineSteps(spans: Span[], artifacts?: Artifact[]): TimelineStep[] {
  if (spans.length === 0) return [];
  const ordered = [...spans].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
  const firstStart = +new Date(ordered[0].started_at);
  const resolveDepth = buildDepthResolver(ordered);
  const artifactIndex = buildArtifactPayloadIndex(artifacts);

  return ordered.map((span, index) => {
    const startAbsolute = +new Date(span.started_at);
    const duration = spanDurationMs(span);
    const start = Math.max(0, Number.isFinite(startAbsolute) ? startAbsolute - firstStart : index);
    const end = start + Math.max(0.1, duration);
    const metadata = toObject(span.metadata);
    const context = toObject(span.context);
    const evaluation = toObject(span.evaluation);
    const status: TimelineStepStatus = toTimelineStatus(span);
    const type: TimelineStepType = isToolSpan(span) ? "tool" : "llm";

    const promptPayload =
      artifactIndex.promptPayloadBySpan.get(span.id) ??
      pickValueFromObjects([metadata, context], ["prompt", "input", "request", "query", "message"]);
    const responsePayload =
      artifactIndex.responsePayloadBySpan.get(span.id) ??
      pickValueFromObjects([metadata, context, evaluation], ["response", "output", "result", "content"]);

    return {
      id: index + 1,
      stepKey: span.id,
      type,
      name: span.tool_name || span.name || span.span_type,
      status,
      start,
      end,
      depth: resolveDepth(span),
      tokens: {
        input: Math.max(0, span.input_tokens ?? 0),
        output: Math.max(0, span.output_tokens ?? 0),
        total: Math.max(0, span.total_tokens ?? (span.input_tokens ?? 0) + (span.output_tokens ?? 0)),
      },
      cost: Math.max(0, span.estimated_cost ?? 0),
      model: span.model ?? undefined,
      promptPayload,
      prompt: payloadToText(promptPayload),
      responsePayload,
      response: payloadToText(responsePayload),
      params: pickObjectFromObjects([metadata, context], ["params", "arguments", "input", "request"]),
      result: pickObjectFromObjects([metadata, context, evaluation], ["result", "output", "response"]),
      metadata: metadata,
      warning:
        status === "warning"
          ? pickStringFromObjects([metadata, context, evaluation], ["warning", "warning_message", "message"])
          : undefined,
      error:
        pickStringFromObjects([metadata, context, evaluation], ["error", "error_type", "message"]) ??
        span.error_type ??
        undefined,
      errorDetails:
        span.error_source ??
        pickStringFromObjects([metadata, context, evaluation], ["error_details", "details"]) ??
        undefined,
      stackTrace: pickStringFromObjects([metadata, context, evaluation], ["stack_trace", "traceback"]),
    };
  });
}

export function RunTimelineView({ spans, artifacts }: RunTimelineViewProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const steps = useMemo(() => toTimelineSteps(spans, artifacts), [spans, artifacts]);

  const maxTime = steps.length > 0 ? Math.max(...steps.map((s) => s.end)) : 0;
  const timeScale = Math.max(10, Math.ceil(maxTime / 10) * 10);
  const tickStep = chooseTickStep(timeScale);
  const timeTicks = Array.from({ length: Math.ceil(timeScale / tickStep) + 1 }, (_, i) => i * tickStep);
  const selectedStepData = selectedStep ? steps.find((s) => s.id === selectedStep) ?? null : null;
  const selectedStepLogs = useMemo(() => (selectedStepData ? buildStepLogs(selectedStepData) : []), [selectedStepData]);

  return (
    <div className="space-y-3">
      <div className="flex min-h-[640px] overflow-x-hidden rounded-lg border border-white/5 bg-gray-950">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-white/5 bg-gray-900/40 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-gray-300">Timeline</h2>
            <div className="text-xs text-gray-500">{maxTime.toFixed(1)}ms total</div>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setZoom(Math.min(zoom + 0.2, 2))} className="rounded p-1.5 transition-colors hover:bg-gray-800" title="Zoom In">
              <ZoomIn className="h-3.5 w-3.5 text-gray-400" />
            </button>
            <button onClick={() => setZoom(Math.max(zoom - 0.2, 0.5))} className="rounded p-1.5 transition-colors hover:bg-gray-800" title="Zoom Out">
              <ZoomOut className="h-3.5 w-3.5 text-gray-400" />
            </button>
            <button onClick={() => setZoom(1)} className="rounded p-1.5 transition-colors hover:bg-gray-800" title="Reset Zoom">
              <Maximize2 className="h-3.5 w-3.5 text-gray-400" />
            </button>
            <div className="mx-1 h-4 w-px bg-gray-700" />
            <button className="rounded p-1.5 transition-colors hover:bg-gray-800">
              <Search className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>
        </div>

          <div className="flex flex-1 flex-col bg-gray-950">
            <div className="flex-shrink-0 border-b border-white/5 bg-gray-950">
            <div className="relative flex h-12">
              <div className="w-[220px] flex-shrink-0 border-r border-white/5" />
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="absolute left-2 top-1 text-[10px] text-gray-500">
                  {formatTimelineTime(0)} → {formatTimelineTime(maxTime)}
                </div>
                <div className="flex h-full">
                  {timeTicks.map((time) => (
                    <div key={time} className="relative flex-1 pt-3" style={{ minWidth: `${((tickStep / timeScale) * 100) * zoom}%` }}>
                      <div className="absolute left-0 top-0 flex h-full flex-col">
                        <span className="text-[10px] font-medium text-gray-500/80">{time}ms</span>
                        <div className="mt-1 w-px flex-1 bg-white/10" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

            <div className="flex-1">
              <div className="relative">
                {steps.map((step) => (
                  <div key={step.stepKey}>
                    <WaterfallBar
                      step={step}
                      maxTime={timeScale}
                      tickStep={tickStep}
                      zoom={zoom}
                      isSelected={selectedStep === step.id}
                      onClick={() => setSelectedStep(selectedStep === step.id ? null : step.id)}
                    />
                    {selectedStep === step.id ? (
                      <div className="border-b border-white/5 bg-black/20 px-3 py-3">
                        <DetailsPanel step={step} logs={selectedStepLogs} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 border-t border-white/5 bg-gray-900/40 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-emerald-500" />
              <span className="text-gray-400">Success</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-amber-500" />
              <span className="text-gray-400">Slow / Warning</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-red-500" />
              <span className="text-gray-400">Failed</span>
            </div>
          </div>
        </div>
      </div>
      </div>
  );
}

function WaterfallBar({
  step,
  maxTime,
  tickStep,
  zoom,
  isSelected,
  onClick,
}: {
  step: TimelineStep;
  maxTime: number;
  tickStep: number;
  zoom: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const duration = step.end - step.start;
  const leftPercent = (step.start / maxTime) * 100;
  const widthPercent = (duration / maxTime) * 100;
  const indentPx = step.depth * 20;

  const isSlow = duration >= 3000;
  const barColor =
    step.status === "error"
      ? "bg-red-500 border-red-300 shadow-[0_0_0_1px_rgba(248,113,113,0.4)]"
      : step.status === "warning" || isSlow
        ? "bg-amber-500 border-amber-300 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]"
        : "bg-emerald-500 border-emerald-300";
  const statusIcon = step.status === "error" ? "✗" : step.status === "warning" || isSlow ? "!" : "✓";
  const statusLabel = step.status === "error" ? "failed" : step.status === "warning" || isSlow ? "slow/warn" : "success";

  return (
    <div
      className={`group relative flex h-9 cursor-pointer border-b border-white/5 transition-all ${isSelected ? "bg-blue-500/10" : "hover:bg-white/[0.03]"}`}
      onClick={onClick}
    >
      <div className="flex w-[220px] flex-shrink-0 items-center border-r border-white/5 px-3" style={{ paddingLeft: `${12 + indentPx}px` }}>
        <span className="truncate text-[11px] text-gray-300">
          Step {step.id} · {step.model ?? "unknown-model"} · {statusIcon} {statusLabel} · {step.tokens.total} tok · ${step.cost.toFixed(3)}
        </span>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex">
          {Array.from({ length: Math.ceil(maxTime / tickStep) + 1 }, (_, i) => (
            <div key={i} className="border-r border-white/10" style={{ width: `${((tickStep / maxTime) * 100) * zoom}%` }} />
          ))}
        </div>
        <div
          className={`absolute bottom-1 top-1 rounded-sm border transition-all ${barColor} ${
            isSelected ? "ring-1 ring-white ring-opacity-50 brightness-125" : ""
          }`}
          style={{ left: `${leftPercent * zoom}%`, width: `${Math.max(widthPercent * zoom, 0.2)}%`, minWidth: "2px" }}
        >
          {widthPercent > 4 ? (
            <div className="flex h-full items-center px-2">
              <span className="whitespace-nowrap text-[10px] font-medium text-white/90">{step.name} · {duration.toFixed(1)}ms</span>
            </div>
          ) : null}
        </div>
        <div className="pointer-events-none absolute right-2 top-1 hidden rounded border border-white/10 bg-black/90 px-2 py-1 text-[10px] text-gray-200 shadow-lg group-hover:block">
          {step.name} · {step.model ?? "n/a"} · {statusLabel} · {step.tokens.total} tokens · ${step.cost.toFixed(4)}
        </div>
      </div>
    </div>
  );
}

function DetailsPanel({ step, logs }: { step: TimelineStep; logs: TimelineLogEntry[] }) {
  const duration = step.end - step.start;
  const statusLabel =
    step.status === "error"
      ? `❌ ${step.error ?? step.status}`
      : step.status === "warning"
        ? `⚠ ${step.warning ?? step.status}`
        : `✓ ${step.status}`;
  const sourceLabel = step.type === "tool" ? "tool" : "system";

  return (
    <div className="space-y-4 p-4">
      <div>
        <h4 className="text-base font-semibold text-white">{step.name}</h4>
      </div>

      <div className="space-y-2 border-t border-white/5 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Status</span>
          <span className="text-gray-200">
            {statusLabel} <span className="text-gray-500">({sourceLabel})</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Duration</span>
          <span className="font-mono text-gray-200">{Math.round(duration)} ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Tokens</span>
          <span className="font-mono text-gray-200">{step.tokens.total.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Cost</span>
          <span className="font-mono text-gray-200">${step.cost.toFixed(4)}</span>
        </div>
      </div>

      {step.promptPayload !== undefined ? (
        <div className="border-t border-white/5 pt-3">
          <PromptPayloadPanel title="Prompt" payload={step.promptPayload} variant="dark" />
        </div>
      ) : null}

      {step.responsePayload !== undefined ? (
        <div className="border-t border-white/5 pt-3">
          <PromptPayloadPanel title="Response" payload={step.responsePayload} variant="dark" defaultStructuredOpen={false} />
        </div>
      ) : null}

      {step.errorDetails ? <p className="border-t border-white/5 pt-3 text-xs text-gray-400">{step.errorDetails}</p> : null}
      <div className="border-t border-white/5 pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Related Logs</div>
        {logs.length > 0 ? (
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {logs.map((entry) => (
              <div key={entry.id} className="rounded border border-white/5 bg-black/20 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                      entry.level === "error"
                        ? "bg-red-500/20 text-red-300"
                        : entry.level === "warning"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-blue-500/20 text-blue-300"
                    }`}
                  >
                    {entry.level}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">{entry.source}</span>
                </div>
                <p className="text-xs text-gray-300">{entry.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No related logs for this step.</p>
        )}
      </div>
    </div>
  );
}
