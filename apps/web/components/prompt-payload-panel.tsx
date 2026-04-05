"use client";

import { useMemo } from "react";

import { buildPromptPresentation } from "@/lib/prompt-presentation";

type PromptPayloadPanelProps = {
  title: string;
  payload: unknown;
  variant?: "light" | "dark";
  defaultStructuredOpen?: boolean;
  defaultRawOpen?: boolean;
};

export function PromptPayloadPanel({
  title,
  payload,
  variant = "light",
  defaultStructuredOpen = true,
  defaultRawOpen = false,
}: PromptPayloadPanelProps) {
  const presentation = useMemo(() => buildPromptPresentation(payload), [payload]);

  const tone =
    variant === "dark"
      ? {
          border: "border-white/10",
          panel: "bg-black/20",
          title: "text-gray-300",
          summary: "text-gray-400",
          section: "border-white/10 bg-black/30",
          sectionTitle: "text-gray-400",
          text: "text-gray-100",
          raw: "bg-black/50 text-gray-200",
        }
      : {
          border: "border-black/8",
          panel: "bg-neutral-50",
          title: "text-neutral-600",
          summary: "text-neutral-500",
          section: "border-black/8 bg-white",
          sectionTitle: "text-neutral-500",
          text: "text-neutral-950",
          raw: "bg-slate-950 text-slate-100",
        };

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.panel}`}>
      <div className={`border-b px-3 py-2 text-[11px] uppercase tracking-[0.16em] ${tone.border} ${tone.title}`}>
        {title}
      </div>

      <details open={defaultStructuredOpen} className="px-3 py-2">
        <summary className={`cursor-pointer text-xs font-medium uppercase tracking-wide ${tone.summary}`}>
          Structured View
        </summary>
        <div className="mt-2 space-y-2">
          {presentation.sections.map((section) => (
            <div key={section.id} className={`rounded-lg border p-3 ${tone.section}`}>
              <div className={`mb-2 text-[11px] uppercase tracking-[0.14em] ${tone.sectionTitle}`}>{section.title}</div>
              <pre className={`max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 ${tone.text}`}>
                {section.content}
              </pre>
            </div>
          ))}
        </div>
      </details>

      <details open={defaultRawOpen} className={`border-t px-3 py-2 ${tone.border}`}>
        <summary className={`cursor-pointer text-xs font-medium uppercase tracking-wide ${tone.summary}`}>
          Raw {presentation.rawFormat === "json" ? "JSON" : "Payload"}
        </summary>
        <pre className={`mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs leading-6 ${tone.raw}`}>
          {presentation.raw}
        </pre>
      </details>
    </div>
  );
}
