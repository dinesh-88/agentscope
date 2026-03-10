import Link from "next/link";
import { Activity, ChevronsRight, DatabaseZap, Rows3, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

type SidebarProps = {
  activePath?: string;
};

const navItems = [
  { href: "/runs", label: "Runs", icon: Rows3 },
  { href: "/runs?panel=insights", label: "Insights", icon: Sparkles },
  { href: "/runs?panel=root-cause", label: "Root Cause", icon: DatabaseZap },
];

export function Sidebar({ activePath = "/runs" }: SidebarProps) {
  return (
    <aside className="relative overflow-hidden rounded-[28px] border border-white/45 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(22,32,56,0.92))] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      <div className="mb-10 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-100/15">
          <Activity className="size-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-100/55">AgentScope</p>
          <h1 className="text-lg font-semibold tracking-tight">Run Console</h1>
        </div>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePath.startsWith(item.href.split("?")[0]);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center justify-between rounded-2xl px-4 py-3 text-sm transition",
                isActive
                  ? "bg-white text-slate-950 shadow-lg shadow-cyan-950/20"
                  : "text-slate-200 hover:bg-white/8 hover:text-white",
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className="size-4" />
                {item.label}
              </span>
              <ChevronsRight className={cn("size-4", isActive ? "text-slate-400" : "text-slate-500")} />
            </Link>
          );
        })}
      </nav>

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/6 p-4">
        <p className="text-xs uppercase tracking-[0.25em] text-white/45">Stack</p>
        <p className="mt-2 text-sm text-slate-200">Next.js + shadcn/ui + Recharts</p>
      </div>
    </aside>
  );
}
