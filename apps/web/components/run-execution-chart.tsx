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

const data = [
  { time: 0, latency: 0, llm: 0, tool: null, failed: null },
  { time: 5, latency: 3, llm: 3, tool: null, failed: null },
  { time: 10, latency: 8, llm: 8, tool: null, failed: null },
  { time: 14.2, latency: 10, llm: 10, tool: null, failed: null },
  { time: 15, latency: 9, llm: null, tool: null, failed: null },
  { time: 20, latency: 8, llm: null, tool: null, failed: null },
  { time: 25, latency: 9, llm: null, tool: null, failed: null },
  { time: 30, latency: 10, llm: null, tool: 10, failed: null },
  { time: 35, latency: 11, llm: null, tool: null, failed: null },
  { time: 40, latency: 12, llm: null, tool: null, failed: null },
  { time: 45, latency: 13, llm: null, tool: null, failed: null },
  { time: 50, latency: 14, llm: null, tool: null, failed: 14 },
  { time: 55, latency: 11, llm: null, tool: null, failed: null },
  { time: 60, latency: 7, llm: null, tool: null, failed: null },
  { time: 70, latency: 2, llm: null, tool: null, failed: null },
];

export function RunExecutionChart() {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-6">
      <h2 className="mb-6 text-lg font-medium">Execution Timeline</h2>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
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
            domain={[0, 15]}
            ticks={[0, 5, 10, 15]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1a2e",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#fff",
            }}
          />

          <ReferenceLine x={14.2} stroke="#3b82f6" strokeDasharray="5 5" />
          <ReferenceLine x={30} stroke="#f59e0b" strokeDasharray="5 5" />
          <ReferenceLine x={50} stroke="#ef4444" strokeDasharray="5 5" />

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
        <div className="absolute -top-20 left-[18%]">
          <div className="rounded border border-blue-500/50 bg-[#1e3a5f] px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-blue-400">✕</span>
              <span className="font-medium text-blue-300">LLM Call</span>
            </div>
            <div className="text-gray-400">router</div>
            <div className="mt-1 inline-block rounded bg-blue-600 px-2 py-0.5 text-white">14.2s</div>
          </div>
        </div>

        <div className="absolute -top-20 left-[42%]">
          <div className="rounded border border-amber-500/50 bg-[#3f2f1a] px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-amber-400">⬢</span>
              <span className="font-medium text-amber-300">Tool Call</span>
            </div>
            <div className="text-gray-400">get_order_status</div>
            <div className="mt-1 inline-block rounded bg-amber-600 px-2 py-0.5 text-white">+1,200 tokens</div>
          </div>
        </div>

        <div className="absolute -top-20 left-[70%]">
          <div className="rounded border border-red-500/50 bg-[#3f1a1a] px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-red-400">✕</span>
              <span className="font-medium text-red-300">FAILED</span>
            </div>
            <div className="text-gray-400">llm_call</div>
            <div className="mt-1 inline-block rounded bg-red-600 px-2 py-0.5 text-white">9.8s</div>
          </div>
        </div>
      </div>

      <div className="mt-12 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-blue-500" />
          <span className="text-gray-400">
            <span className="font-medium text-white">LLM</span> · router
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 bg-amber-500" />
          <span className="text-gray-400">
            <span className="font-medium text-white">Tool</span> · get_order_status
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 bg-amber-500">
            <svg viewBox="0 0 12 12" fill="none" className="h-full w-full">
              <path d="M6 1L1 11h10L6 1z" fill="currentColor" className="text-amber-500" />
            </svg>
          </div>
          <span className="text-gray-400">
            <span className="font-medium text-white">Context Injection</span> (+1200 tokens)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 text-red-500">✕</div>
          <span className="text-gray-400">
            <span className="font-medium text-white">Failure</span> · llm_call
          </span>
        </div>
      </div>
    </div>
  );
}
