"use client";

import { type ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type AppShellProps = {
  activePath?: string;
  children: ReactNode;
  mainClassName?: string;
};

export function AppShell({ activePath = "/runs", children, mainClassName }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen w-full">
        <Sidebar activePath={activePath} />
        <main className={cn("min-w-0 flex-1 bg-background lg:pl-0", mainClassName)}>{children}</main>
      </div>
    </div>
  );
}
