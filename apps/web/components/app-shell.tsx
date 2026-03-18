"use client";

import { type ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type AppShellProps = {
  activePath?: string;
  children: ReactNode;
  mainClassName?: string;
};

export function AppShell({ activePath = "/dashboard", children, mainClassName }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8eefc,transparent_35%),radial-gradient(circle_at_80%_20%,#dff6f3,transparent_35%),#f6f8fb]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar activePath={activePath} />
        <main className={cn("min-w-0 flex-1 px-2 pb-6 lg:px-4", mainClassName)}>{children}</main>
      </div>
    </div>
  );
}
