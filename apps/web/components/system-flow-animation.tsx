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
const pulseStops = nodeLeft.map((left) => left + nodeWidth / 2 - pulseStart);
const holdSeconds = 0.45;
const moveSeconds = 0.9;
const cycleSeconds = pulseStops.length * holdSeconds + (pulseStops.length - 1) * moveSeconds;

function buildPulseKeyframes() {
  const keyframes: number[] = [];
  const times: number[] = [];
  const arrivals: number[] = [];
  let elapsed = 0;

  for (let i = 0; i < pulseStops.length; i += 1) {
    const current = pulseStops[i];
    arrivals.push(elapsed / cycleSeconds);

    keyframes.push(current);
    times.push(elapsed / cycleSeconds);

    elapsed += holdSeconds;
    keyframes.push(current);
    times.push(elapsed / cycleSeconds);

    if (i < pulseStops.length - 1) {
      const next = pulseStops[i + 1];
      elapsed += moveSeconds;
      keyframes.push(next);
      times.push(elapsed / cycleSeconds);
    }
  }

  return { keyframes, times, arrivals };
}

export function SystemFlowAnimation() {
  const shouldReduceMotion = useReducedMotion();
  const { keyframes: pulseX, times: pulseTimes, arrivals } = buildPulseKeyframes();

  return (
    <div className="relative w-full overflow-x-auto">
      <div className="flex w-full justify-center">
        <div className="relative w-[1220px] overflow-hidden rounded-2xl border border-white/10 bg-[#0F141D] shadow-2xl">
        <div className="pointer-events-none absolute -top-20 left-10 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 -bottom-20 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />

        <div className="relative h-[270px]">
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
                animate={{ x: pulseX }}
                transition={{ duration: cycleSeconds, times: pulseTimes, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="absolute top-[149px] h-3 w-3 rounded-full bg-blue-300 shadow-[0_0_16px_4px_rgba(96,165,250,0.45)]"
                style={{ left: pulseStart - 6 }}
                animate={{ x: pulseX }}
                transition={{ duration: cycleSeconds, times: pulseTimes, repeat: Infinity, ease: "linear" }}
              />
            </>
          )}

          {nodes.map((node, index) => {
            const activationStart = arrivals[index];
            const activationPeak = Math.min(activationStart + 0.045, 1);
            const activationEnd = Math.min(activationStart + 0.14, 1);
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
                        scale: [1, 1, 1.02, 1, 1],
                        boxShadow: [
                          "0 0 0 rgba(96,165,250,0)",
                          "0 0 0 rgba(96,165,250,0)",
                          "0 0 22px rgba(96,165,250,0.22)",
                          "0 0 0 rgba(96,165,250,0)",
                          "0 0 0 rgba(96,165,250,0)",
                        ],
                        borderColor: ["#2A3F5E", "#2A3F5E", "#4B6EA6", "#2A3F5E", "#2A3F5E"],
                      }
                }
                transition={{
                  duration: cycleSeconds,
                  repeat: Infinity,
                  ease: "easeInOut",
                  times: [0, activationStart, activationPeak, activationEnd, 1],
                }}
              >
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="text-[15px] font-semibold text-gray-100">{node.title}</div>
                  {"subtitle" in node && node.subtitle && <div className="mt-2 text-[12px] text-gray-400">{node.subtitle}</div>}
                  {"items" in node && node.items && (
                    <div className="mt-3 space-y-1 text-[12px] text-gray-300">
                      {node.items.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  )}

                  {isDashboard && (
                    <div className="mt-4 w-full space-y-1.5">
                      <motion.div
                        className="h-4 rounded bg-blue-400/20"
                        animate={
                          shouldReduceMotion
                            ? { opacity: 0.75 }
                            : { opacity: [0.3, 0.3, 0.85, 0.5, 0.5], y: [1, 1, 0, 0, 0] }
                        }
                        transition={{
                          duration: cycleSeconds,
                          repeat: Infinity,
                          ease: "easeInOut",
                          times: [0, arrivals[arrivals.length - 1], Math.min(arrivals[arrivals.length - 1] + 0.07, 1), Math.min(arrivals[arrivals.length - 1] + 0.2, 1), 1],
                        }}
                      />
                      <motion.div
                        className="h-4 rounded bg-purple-400/20"
                        animate={
                          shouldReduceMotion
                            ? { opacity: 0.75 }
                            : { opacity: [0.3, 0.3, 0.85, 0.5, 0.5], y: [1, 1, 0, 0, 0] }
                        }
                        transition={{
                          duration: cycleSeconds,
                          repeat: Infinity,
                          ease: "easeInOut",
                          times: [0, Math.min(arrivals[arrivals.length - 1] + 0.03, 1), Math.min(arrivals[arrivals.length - 1] + 0.1, 1), Math.min(arrivals[arrivals.length - 1] + 0.23, 1), 1],
                        }}
                      />
                      <motion.div
                        className="h-4 rounded border border-blue-300/40 bg-blue-300/10"
                        animate={
                          shouldReduceMotion
                            ? { opacity: 0.8 }
                            : {
                                opacity: [0.4, 0.4, 0.95, 0.6, 0.6],
                                borderColor: [
                                  "rgba(147,197,253,0.35)",
                                  "rgba(147,197,253,0.35)",
                                  "rgba(147,197,253,0.85)",
                                  "rgba(147,197,253,0.35)",
                                  "rgba(147,197,253,0.35)",
                                ],
                              }
                        }
                        transition={{
                          duration: cycleSeconds,
                          repeat: Infinity,
                          ease: "easeInOut",
                          times: [0, Math.min(arrivals[arrivals.length - 1] + 0.06, 1), Math.min(arrivals[arrivals.length - 1] + 0.13, 1), Math.min(arrivals[arrivals.length - 1] + 0.26, 1), 1],
                        }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
