"use client";

import { motion, useReducedMotion } from "framer-motion";

const nodes = [
  { title: "User App", subtitle: "Your AI App" },
  { title: "SDK", subtitle: "AgentScope SDK" },
  { title: "API", subtitle: "Ingestion API" },
  { title: "Processing", items: ["Runs", "Spans", "Artifacts"] },
  { title: "Insights", items: ["Root Cause", "Optimization"] },
  { title: "Dashboard", subtitle: "AgentScope UI" },
] as const;

const nodeLeft = [30, 230, 430, 630, 830, 1030] as const;
const nodeWidth = 160;
const pulseStart = nodeLeft[0] + nodeWidth / 2;
const pulseDistance = nodeLeft[nodeLeft.length - 1] - nodeLeft[0];

export function SystemFlowAnimation() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative overflow-x-auto">
      <div className="relative mx-auto min-w-[1220px] overflow-hidden rounded-2xl border border-white/10 bg-[#0F141D] p-8 shadow-2xl">
        <div className="pointer-events-none absolute -top-20 left-10 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 -bottom-20 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />

        <div className="mb-8 flex items-center justify-between">
          <h3 className="text-sm font-medium tracking-wide text-gray-300">SYSTEM FLOW</h3>
          <span className="text-xs text-gray-500">User App to Dashboard</span>
        </div>

        <div className="relative h-[250px]">
          <div className="absolute left-[110px] right-[110px] top-[155px] h-px bg-gradient-to-r from-purple-400/70 to-blue-400/70" />

          {nodeLeft.slice(0, -1).map((left) => (
            <div
              key={`arrow-${left}`}
              className="absolute top-[152px] h-2 w-2 rotate-45 border-r border-t border-blue-400/70"
              style={{ left: left + 196 }}
            />
          ))}

          {!shouldReduceMotion && (
            <>
              <motion.div
                className="absolute top-[147px] h-4 w-20 rounded-full bg-gradient-to-r from-transparent via-purple-400/35 to-transparent blur-md"
                style={{ left: pulseStart - 40 }}
                animate={{ x: [0, pulseDistance] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="absolute top-[149px] h-3 w-3 rounded-full bg-blue-300 shadow-[0_0_16px_4px_rgba(96,165,250,0.45)]"
                style={{ left: pulseStart - 6 }}
                animate={{ x: [0, pulseDistance] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </>
          )}

          {nodes.map((node, index) => {
            const delay = (index / (nodes.length - 1)) * 2;
            const isDashboard = index === nodes.length - 1;

            return (
              <motion.div
                key={node.title}
                className="absolute top-[65px] rounded-2xl border border-[#2A3F5E] bg-[#131C29] px-3 py-4"
                style={{ left: nodeLeft[index], width: nodeWidth, height: 180 }}
                animate={
                  shouldReduceMotion
                    ? { scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }
                    : {
                        scale: [1, 1.02, 1],
                        boxShadow: [
                          "0 0 0 rgba(96,165,250,0)",
                          "0 0 22px rgba(96,165,250,0.22)",
                          "0 0 0 rgba(96,165,250,0)",
                        ],
                        borderColor: ["#2A3F5E", "#4B6EA6", "#2A3F5E"],
                      }
                }
                transition={{ duration: 2, repeat: Infinity, ease: "linear", delay }}
              >
                <div className="text-center text-[15px] font-semibold text-gray-100">{node.title}</div>
                {node.subtitle && <div className="mt-2 text-center text-[12px] text-gray-400">{node.subtitle}</div>}
                {node.items && (
                  <div className="mt-3 space-y-1 text-center text-[12px] text-gray-300">
                    {node.items.map((item) => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>
                )}

                {isDashboard && (
                  <div className="mt-3 space-y-1.5">
                    <motion.div
                      className="h-4 rounded bg-blue-400/20"
                      animate={
                        shouldReduceMotion
                          ? { opacity: 0.75 }
                          : { opacity: [0.35, 0.9, 0.55], y: [2, 0, 0] }
                      }
                      transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 1.65 }}
                    />
                    <motion.div
                      className="h-4 rounded bg-purple-400/20"
                      animate={
                        shouldReduceMotion
                          ? { opacity: 0.75 }
                          : { opacity: [0.35, 0.9, 0.55], y: [2, 0, 0] }
                      }
                      transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 1.75 }}
                    />
                    <motion.div
                      className="h-4 rounded border border-blue-300/40 bg-blue-300/10"
                      animate={
                        shouldReduceMotion
                          ? { opacity: 0.8 }
                          : { opacity: [0.45, 1, 0.65], borderColor: ["rgba(147,197,253,0.35)", "rgba(147,197,253,0.85)", "rgba(147,197,253,0.35)"] }
                      }
                      transition={{ duration: 2, repeat: Infinity, ease: "linear", delay: 1.85 }}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
