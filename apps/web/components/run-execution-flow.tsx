import { AlertTriangle } from "lucide-react";

type RunExecutionFlowProps = {
  llmLabel: string;
  toolLabel: string;
  failedLabel: string;
  llmDuration: string;
  toolDuration: string;
  failedDuration: string;
  toolTokens: number;
  contextNote: string;
  failedState: string;
};

export function RunExecutionFlow({
  llmLabel,
  toolLabel,
  failedLabel,
  llmDuration,
  toolDuration,
  failedDuration,
  toolTokens,
  contextNote,
  failedState,
}: RunExecutionFlowProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-6">
      <h2 className="mb-6 text-lg font-medium">Execution Flow</h2>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="mt-1.5 h-3 w-3 rounded-full bg-blue-500" />
            <div className="flex-1">
              <div className="text-white">
                <span className="font-medium">LLM</span>
                <span className="mx-2 text-gray-500">|</span>
                <span className="text-gray-400">{llmLabel}</span>
              </div>
              <div className="mt-1 text-sm text-gray-500">{llmDuration} · 0 tokens</div>
            </div>
          </div>
          <div className="ml-1.5 flex items-center gap-3">
            <div className="h-6 w-px bg-gray-700" />
            <div />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="mt-1.5 h-3 w-3 bg-amber-500" />
            <div className="flex-1">
              <div className="text-white">
                <span className="font-medium">Tool Call</span>
                <span className="mx-2 text-gray-500">|</span>
                <span className="text-gray-400">{toolLabel}</span>
              </div>
              <div className="mt-1 text-sm text-gray-500">{toolDuration} · +{Math.max(toolTokens, 0).toLocaleString()} tokens</div>
            </div>
          </div>
          <div className="ml-1.5 flex items-center gap-3">
            <div className="h-6 w-px bg-gray-700" />
            <div />
          </div>
        </div>

        <div className="ml-6 rounded-lg border border-amber-900/50 bg-[#2a1f0a] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div className="flex-1">
              <div className="mb-2 font-medium text-white">{contextNote}</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Context expanded</span>
                <span className="rounded bg-amber-900/50 px-2 py-1 text-xs text-amber-400">+{Math.max(toolTokens, 0).toLocaleString()} tokens</span>
              </div>
            </div>
          </div>
        </div>

        <div className="ml-1.5 flex items-center gap-3">
          <div className="h-6 w-px bg-gray-700" />
          <div />
        </div>

        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4">
          <div className="mb-3 flex items-start gap-3">
            <span className="text-lg text-red-500">✕</span>
            <span className="text-sm font-medium uppercase tracking-wide text-red-400">FAILED STEP</span>
          </div>

          <div className="ml-8 flex items-start gap-3">
            <div className="mt-1.5 h-3 w-3 rounded-full bg-red-500" />
            <div className="flex-1">
              <div className="text-white">
                <span className="font-medium">{failedLabel}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-gray-500">Execution halted ({failedDuration})</span>
                <span className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-400">{failedState}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
