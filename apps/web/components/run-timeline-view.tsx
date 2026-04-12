"use client";

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

function formatTimelineTime(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatDuration(ms: number) {
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
    const direct =
      toStringValue(object.message) ??
      toStringValue(object.content) ??
      toStringValue(object.output) ??
      toStringValue(object.result);
    if (direct) return direct;
    try {
      return JSON.stringify(object, null, 2);
    } catch {
      return undefined;
    }
  }
  return undefined;
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
      message: trimmed,
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
      error: pickStringFromObjects([metadata, context, evaluation], ["error", "error_type", "message"]) ?? span.error_type ?? undefined,
      errorDetails:
        span.error_source ??
        pickStringFromObjects([metadata, context, evaluation], ["error_details", "details"]) ??
        undefined,
      stackTrace: pickStringFromObjects([metadata, context, evaluation], ["stack_trace", "traceback"]),
    };
  });
}

function stepCategory(step: TimelineStep) {
  const name = step.name.toLowerCase();
  if (step.depth === 0 && name.includes("agent")) return "agent" as const;
  if (step.type === "tool" && (name.includes("retriev") || name.includes("search"))) return "retrieval" as const;
  if (step.type === "tool") return "tool" as const;
  return "llm" as const;
}

export function RunTimelineView({ spans, artifacts }: RunTimelineViewProps) {
  const steps = useMemo(() => toTimelineSteps(spans, artifacts), [spans, artifacts]);
  const maxTime = steps.length > 0 ? Math.max(...steps.map((s) => s.end)) : 0;
  const timeScale = Math.max(10, Math.ceil(maxTime / 10) * 10);
  const [activeStepId, setActiveStepId] = useState<number | null>(steps[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<"info" | "prompt" | "issues">("info");

  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
  const activeLogs = useMemo(() => (activeStep ? buildStepLogs(activeStep) : []), [activeStep]);

  const tickMarks = useMemo(() => {
    const marks = [0, 0.25, 0.5, 0.75, 0.99];
    return marks.map((value) => ({
      left: value * 100,
      label: formatTimelineTime(timeScale * value),
    }));
  }, [timeScale]);

  const issueCount = activeLogs.filter((log) => log.level !== "info").length;

  return (
    <div className="grid min-h-[620px] grid-cols-1 overflow-hidden rounded-lg border border-white/5 bg-[#0b0b14] text-white lg:grid-cols-[1fr_1fr]">
      <div className="flex min-w-0 flex-col border-b border-white/5 lg:border-b-0 lg:border-r lg:border-white/5">
        <div className="grid h-7 grid-cols-[192px_1fr] border-b border-white/10 bg-[#10101b] text-[10px] uppercase tracking-[0.15em] text-gray-500">
          <div className="flex items-center border-r border-white/10 px-3">Span</div>
          <div className="flex items-center px-3">Timeline · {formatTimelineTime(maxTime)}</div>
        </div>

        <div className="grid h-5 grid-cols-[192px_1fr] border-b border-white/10 bg-[#10101b] text-[9px] text-gray-500">
          <div className="border-r border-white/10" />
          <div className="relative">
            {tickMarks.map((mark) => (
              <div key={mark.left} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${mark.left}%` }}>
                <div className="h-1 w-px bg-white/20" />
                <div className="mt-0.5 whitespace-nowrap text-[8px] text-gray-500">{mark.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {steps.length === 0 ? (
            <div className="p-6 text-sm text-gray-400">No spans available.</div>
          ) : (
            steps.map((step) => (
              <TimelineRow
                key={step.stepKey}
                step={step}
                maxTime={timeScale}
                isActive={step.id === activeStepId}
                onClick={() => setActiveStepId(step.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col bg-[#0b0b14]">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
            <span>{activeStep?.name ?? "Select a span"}</span>
            {activeStep ? <StatusBadge status={activeStep.status} /> : null}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>{activeStep?.stepKey ?? ""}</span>
            {activeStep ? <span>·</span> : null}
            <span>{activeStep ? stepCategory(activeStep) : ""}</span>
          </div>
        </div>

        <div className="flex border-b border-white/10 text-[9px] uppercase tracking-[0.15em] text-gray-500">
          <button
            type="button"
            onClick={() => setActiveTab("info")}
            className={`flex-1 border-r border-white/10 py-2 transition ${
              activeTab === "info" ? "bg-[#0b0b14] text-white" : "bg-[#10101b] hover:text-gray-300"
            }`}
          >
            Info
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompt")}
            className={`flex-1 border-r border-white/10 py-2 transition ${
              activeTab === "prompt" ? "bg-[#0b0b14] text-white" : "bg-[#10101b] hover:text-gray-300"
            }`}
          >
            Prompt
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("issues")}
            className={`flex-1 py-2 transition ${
              activeTab === "issues" ? "bg-[#0b0b14] text-white" : "bg-[#10101b] hover:text-gray-300"
            }`}
          >
            Issues {issueCount > 0 ? `(${issueCount})` : ""}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "info" ? (
            <InfoPanel step={activeStep} maxTime={maxTime} />
          ) : activeTab === "prompt" ? (
            <PromptPanel step={activeStep} />
          ) : (
            <IssuesPanel logs={activeLogs} />
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  step,
  maxTime,
  isActive,
  onClick,
}: {
  step: TimelineStep;
  maxTime: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const duration = step.end - step.start;
  const leftPercent = maxTime > 0 ? (step.start / maxTime) * 100 : 0;
  const widthPercent = maxTime > 0 ? (duration / maxTime) * 100 : 0;
  const indentPx = step.depth * 14;
  const category = stepCategory(step);
  const isSlow = duration >= 3000;

  const barClass =
    category === "agent"
      ? "bg-white/15 text-white"
      : isSlow || step.status === "warning"
        ? "bg-amber-500/30 border border-amber-400/40 text-amber-100"
        : step.status === "error"
          ? "bg-red-500/25 border border-red-400/40 text-red-100"
          : category === "tool"
            ? "bg-emerald-500/25 border border-emerald-400/40 text-emerald-100"
            : category === "retrieval"
              ? "bg-indigo-500/25 border border-indigo-400/40 text-indigo-100"
              : "bg-blue-500/25 border border-blue-400/40 text-blue-100";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => (event.key === "Enter" ? onClick() : null)}
      className={`grid h-9 grid-cols-[192px_1fr] border-b border-white/5 text-[10px] transition ${
        isActive ? "bg-white/5" : "hover:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-2 border-r border-white/5 px-3" style={{ paddingLeft: `${12 + indentPx}px` }}>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            category === "agent"
              ? "bg-white"
              : category === "tool"
                ? "bg-emerald-300"
                : category === "retrieval"
                  ? "bg-indigo-300"
                  : "bg-blue-300"
          }`}
        />
        <span className={`truncate ${isActive ? "font-medium text-white" : "text-gray-400"}`}>{step.name}</span>
      </div>
      <div className="relative flex items-center">
        <div className="absolute inset-y-0 left-1/4 w-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <div className="absolute inset-y-0 left-3/4 w-px bg-white/10" />
        <div
          className={`absolute flex h-4 items-center gap-2 overflow-hidden rounded-sm px-2 text-[9px] ${barClass}`}
          style={{ left: `calc(${leftPercent}% + 6px)`, width: `calc(${Math.max(widthPercent, 0.5)}% - 12px)` }}
        >
          <span className="font-medium">{step.name}</span>
          <span className="text-white/50">{formatDuration(duration)}</span>
          {isSlow ? <span className="text-amber-200">↑</span> : null}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TimelineStepStatus }) {
  const className =
    status === "error"
      ? "bg-red-500/20 border border-red-400/30 text-red-200"
      : status === "warning"
        ? "bg-amber-500/20 border border-amber-400/30 text-amber-200"
        : "bg-emerald-500/20 border border-emerald-400/30 text-emerald-200";
  const label = status === "error" ? "error" : status === "warning" ? "warning" : "ok";
  return <span className={`rounded-sm px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] ${className}`}>{label}</span>;
}

function InfoPanel({ step, maxTime }: { step: TimelineStep | null; maxTime: number }) {
  if (!step) {
    return <div className="p-4 text-sm text-gray-400">Select a span to see details.</div>;
  }
  const duration = step.end - step.start;
  return (
    <div className="p-4">
      <div className="mb-3 border-b border-white/10 pb-2 text-[8px] uppercase tracking-[0.15em] text-gray-500">Performance</div>
      <div className="space-y-2 text-[10px]">
        <InfoField label="duration" value={formatDuration(duration)} highlight={duration >= 3000 ? "warn" : "ok"} />
        <InfoField label="status" value={step.status} highlight={step.status === "error" ? "err" : step.status === "warning" ? "warn" : "ok"} />
        <InfoField label="tokens" value={step.tokens.total.toLocaleString()} />
        <InfoField label="cost" value={`$${step.cost.toFixed(4)}`} />
        <InfoField label="model" value={step.model ?? "-"} dim={!step.model} />
        <InfoField label="timeline" value={`${formatDuration(step.start)} → ${formatDuration(step.end)} (${formatTimelineTime(maxTime)} total)`} />
      </div>
    </div>
  );
}

function InfoField({
  label,
  value,
  highlight,
  dim,
}: {
  label: string;
  value: string;
  highlight?: "warn" | "ok" | "err";
  dim?: boolean;
}) {
  const color =
    highlight === "err" ? "text-red-200" : highlight === "warn" ? "text-amber-200" : highlight === "ok" ? "text-emerald-200" : "text-white";
  return (
    <div className="flex items-baseline justify-between border-b border-white/10 pb-1">
      <span className="text-gray-500">{label}</span>
      <span className={`text-right font-medium ${dim ? "text-gray-500" : color}`}>{value}</span>
    </div>
  );
}

function PromptPanel({ step }: { step: TimelineStep | null }) {
  if (!step) {
    return <div className="p-4 text-sm text-gray-400">Select a span to see prompt details.</div>;
  }

  return (
    <div className="space-y-4 p-4">
      {step.promptPayload !== undefined ? (
        <PromptPayloadPanel title="Prompt" payload={step.promptPayload} variant="dark" />
      ) : (
        <div className="rounded border border-white/10 bg-black/20 p-3 text-[9px] text-gray-400">No prompt payload captured.</div>
      )}
      {step.responsePayload !== undefined ? (
        <PromptPayloadPanel title="Response" payload={step.responsePayload} variant="dark" defaultStructuredOpen={false} />
      ) : (
        <div className="rounded border border-white/10 bg-black/20 p-3 text-[9px] text-gray-400">No response payload captured.</div>
      )}
    </div>
  );
}

function IssuesPanel({ logs }: { logs: TimelineLogEntry[] }) {
  if (logs.length === 0) {
    return <div className="p-4 text-sm text-gray-400">No issues detected.</div>;
  }

  return (
    <div className="divide-y divide-white/10">
      {logs.map((entry) => (
        <div key={entry.id} className="p-4 transition hover:bg-white/[0.03]">
          <div className="mb-1 flex items-center justify-between text-[9px]">
            <div className="text-[13px] text-white">{entry.source}</div>
            <span
              className={`text-[8px] uppercase tracking-[0.1em] ${
                entry.level === "error" ? "text-red-300" : entry.level === "warning" ? "text-amber-300" : "text-emerald-300"
              }`}
            >
              {entry.level}
            </span>
          </div>
          <div className="text-[9px] leading-relaxed text-gray-400">{entry.message}</div>
        </div>
      ))}
    </div>
  );
}
