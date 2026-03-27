import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartPoint = {
  time: number;
  latency: number;
  llm: number | null;
  tool: number | null;
  failed: number | null;
};

type EventMarker = {
  x: number;
  title: string;
  subtitle: string;
  value: string;
  tone: "blue" | "amber" | "red";
};

type RunExecutionChartProps = {
  data: ChartPoint[];
  llmMarker?: EventMarker;
  toolMarker?: EventMarker;
  failedMarker?: EventMarker;
  llmLegend: string;
  toolLegend: string;
  failureLegend: string;
  contextDeltaLabel: string;
  outcomeLabel: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function markerLeftPercent(x: number, maxTime: number) {
  if (maxTime <= 0) return 20;
  return clamp((x / maxTime) * 100, 10, 84);
}

function markerClassByTone(tone: EventMarker["tone"]) {
  if (tone === "blue") {
    return {
      box: "bg-[#1e3a5f] border-blue-500/50",
      icon: "text-blue-400",
      title: "text-blue-300",
      pill: "bg-blue-600",
    };
  }
  if (tone === "red") {
    return {
      box: "bg-[#3f1a1a] border-red-500/50",
      icon: "text-red-400",
      title: "text-red-300",
      pill: "bg-red-600",
    };
  }
  return {
    box: "bg-[#3f2f1a] border-amber-500/50",
    icon: "text-amber-400",
    title: "text-amber-300",
    pill: "bg-amber-600",
  };
}

function EventCard({ marker, maxTime }: { marker?: EventMarker; maxTime: number }) {
  if (!marker) return null;

  const tone = markerClassByTone(marker.tone);
  const left = markerLeftPercent(marker.x, maxTime);

  return (
    <div className="absolute -top-20" style={{ left: `${left}%` }}>
      <div className={`rounded border px-3 py-2 text-xs ${tone.box}`}>
        <div className="mb-1 flex items-center gap-1.5">
          <span className={tone.icon}>{marker.tone === "amber" ? "⬢" : "✕"}</span>
          <span className={`font-medium ${tone.title}`}>{marker.title}</span>
        </div>
        <div className="max-w-40 truncate text-gray-400">{marker.subtitle}</div>
        <div className={`mt-1 inline-block rounded px-2 py-0.5 text-white ${tone.pill}`}>{marker.value}</div>
      </div>
    </div>
  );
}

export function RunExecutionChart({
  data,
  llmMarker,
  toolMarker,
  failedMarker,
  llmLegend,
  toolLegend,
  failureLegend,
  contextDeltaLabel,
  outcomeLabel,
}: RunExecutionChartProps) {
  const safeData = data.length > 0 ? data : [{ time: 0, latency: 0, llm: 0, tool: null, failed: null }];
  const maxTime = Math.max(...safeData.map((point) => point.time), 1);
  const maxLatency = Math.max(...safeData.map((point) => point.latency), 1);
  const yMax = Math.ceil(maxLatency / 5) * 5;

  return (
    <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-6">
      <h2 className="mb-6 text-lg font-medium">Execution Timeline</h2>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={safeData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f2e" />
          <XAxis
            dataKey="time"
            stroke="#6b7280"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            label={{ value: "Time", position: "insideBottom", offset: -15, fill: "#6b7280" }}
            tickFormatter={(value) => `${value}s`}
          />
          <YAxis
            stroke="#6b7280"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            label={{ value: "Latency (s)", angle: -90, position: "insideLeft", fill: "#6b7280" }}
            domain={[0, Math.max(5, yMax)]}
          />
          <Tooltip
            formatter={(value) => {
              if (typeof value === "number") {
                return `${value.toFixed(2)}s`;
              }
              if (typeof value === "string") {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? `${parsed.toFixed(2)}s` : value;
              }
              return "0.00s";
            }}
            labelFormatter={(value) => `t=${value}s`}
            contentStyle={{
              backgroundColor: "#1a1a2e",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#fff",
            }}
          />

          {llmMarker ? <ReferenceLine x={llmMarker.x} stroke="#3b82f6" strokeDasharray="5 5" /> : null}
          {toolMarker ? <ReferenceLine x={toolMarker.x} stroke="#f59e0b" strokeDasharray="5 5" /> : null}
          {failedMarker ? <ReferenceLine x={failedMarker.x} stroke="#ef4444" strokeDasharray="5 5" /> : null}

          <Line type="monotone" dataKey="latency" stroke="url(#colorGradient)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="llm" stroke="#3b82f6" strokeWidth={0} dot={{ fill: "#3b82f6", r: 6 }} />
          <Line type="monotone" dataKey="tool" stroke="#f59e0b" strokeWidth={0} dot={{ fill: "#f59e0b", r: 6 }} />
          <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={0} dot={{ fill: "#ef4444", r: 6 }} />

          <defs>
            <linearGradient id="colorGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
        </LineChart>
      </ResponsiveContainer>

      <div className="relative mt-4">
        <EventCard marker={llmMarker} maxTime={maxTime} />
        <EventCard marker={toolMarker} maxTime={maxTime} />
        <EventCard marker={failedMarker} maxTime={maxTime} />
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-blue-500" />
          <span className="text-gray-400">
            <span className="font-medium text-white">LLM</span> · {llmLegend}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 bg-amber-500" />
          <span className="text-gray-400">
            <span className="font-medium text-white">Tool</span> · {toolLegend}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 bg-amber-500">
            <svg viewBox="0 0 12 12" fill="none" className="h-full w-full">
              <path d="M6 1L1 11h10L6 1z" fill="currentColor" className="text-amber-500" />
            </svg>
          </div>
          <span className="text-gray-400">
            <span className="font-medium text-white">Context Injection</span> ({contextDeltaLabel})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 text-red-500">✕</div>
          <span className="text-gray-400">
            <span className="font-medium text-white">{outcomeLabel}</span> · {failureLegend}
          </span>
        </div>
      </div>
    </div>
  );
}
