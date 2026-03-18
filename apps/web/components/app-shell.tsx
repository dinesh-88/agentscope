"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type AppShellProps = {
  activePath?: string;
  children: ReactNode;
  mainClassName?: string;
  theme?: "light" | "dark";
};

type AppThemeContextValue = {
  theme: "light" | "dark";
  toggleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    return { theme: "dark" as const, toggleTheme: () => {} };
  }
  return context;
}

export function AppShell({ activePath = "/dashboard", children, mainClassName, theme = "dark" }: AppShellProps) {
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") {
      return theme;
    }
    const storedTheme = window.localStorage.getItem("agentscope-theme");
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : theme;
  });

  useEffect(() => {
    window.localStorage.setItem("agentscope-theme", resolvedTheme);
  }, [resolvedTheme]);

  const toggleTheme = () => {
    setResolvedTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  };

  return (
    <AppThemeContext.Provider value={{ theme: resolvedTheme, toggleTheme }}>
      <div
        className={cn(
          "min-h-screen",
          resolvedTheme === "dark" ? "dark bg-[#0B0F14] text-gray-100" : "bg-gray-50 text-gray-900",
        )}
      >
        <div className="flex min-h-screen w-full">
          <Sidebar activePath={activePath} theme={resolvedTheme} onToggleTheme={toggleTheme} />
          <main className={cn("min-w-0 flex-1", mainClassName)}>
            {children}
          </main>
        </div>
      </div>
    </AppThemeContext.Provider>
  );
}
