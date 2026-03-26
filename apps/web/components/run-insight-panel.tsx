"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";

type RunInsightPanelProps = {
  insightTitle: string;
  causeLine: string;
  fixOne: string;
  fixTwo: string;
  contextTokens: number;
};

export function RunInsightPanel({ insightTitle, causeLine, fixOne, fixTwo, contextTokens }: RunInsightPanelProps) {
  const [isContextExpanded, setIsContextExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-[#0f0f1e]">
      <div className="p-6">
        <h2 className="mb-6 text-lg font-medium">Insight</h2>

        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <div className="font-medium text-white">{insightTitle}</div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Cause</h3>
          <p className="text-sm leading-relaxed text-gray-300">{causeLine}</p>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Fix</h3>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-sm text-gray-300">
              <span className="mt-0.5 text-gray-500">•</span>
              <span>{fixOne}</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-gray-300">
              <span className="mt-0.5 text-gray-500">•</span>
              <span>{fixTwo}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-gray-800">
        <button
          onClick={() => setIsContextExpanded(!isContextExpanded)}
          className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-gray-900/30"
        >
          <div className="flex items-center gap-3">
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isContextExpanded ? "rotate-180" : ""}`} />
            <span className="text-sm font-medium text-gray-400">Context</span>
          </div>
          <span className="text-sm text-gray-500">{contextTokens.toLocaleString()} tokens</span>
        </button>

        {isContextExpanded && (
          <div className="px-6 pb-6">
            <div className="rounded border border-gray-800 bg-[#0a0a14] p-4">
              <p className="text-sm text-gray-400">
                Context information would appear here, including the full context window with all injected tool outputs and conversation history.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
