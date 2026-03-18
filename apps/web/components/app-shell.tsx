"use client";

import { type ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type AppShellProps = {
  activePath?: string;
  children: ReactNode;
  mainClassName?: string;
  theme?: "light" | "dark";
};

export function AppShell({ activePath = "/dashboard", children, mainClassName, theme = "dark" }: AppShellProps) {
  return (
    <div className={cn("min-h-screen", theme === "dark" ? "dark bg-[#0B0F14] text-gray-100" : "bg-gray-50")}>
      <div className="flex min-h-screen w-full">
        <Sidebar activePath={activePath} theme={theme} />
        <main className={cn("min-w-0 flex-1", mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}
