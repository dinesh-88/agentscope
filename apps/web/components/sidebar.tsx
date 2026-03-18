"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertCircle,
  Bell,
  ChartColumn,
  FlaskConical,
  LayoutDashboard,
  Menu,
  PlaySquare,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { getCurrentUser, logout } from "@/lib/api";

type SidebarProps = {
  activePath?: string;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: PlaySquare },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/usage", label: "Usage", icon: ChartColumn },
  { href: "/sandbox", label: "Sandbox", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ activePath = "/dashboard" }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const currentPath = pathname ?? activePath;

  useEffect(() => {
    let cancelled = false;
    void getCurrentUser()
      .then((me) => {
        if (!cancelled) {
          setPermissions(me.user.permissions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleItems = navItems.filter((item) => {
    if (!permissions) return item.href !== "/settings";
    if (item.href === "/sandbox") return permissions.includes("sandbox:run");
    if (item.href === "/settings") return permissions.includes("project:manage");
    return true;
  });

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  const SidebarBody = (
    <aside className="flex h-full w-72 flex-col border-r border-black/5 bg-white/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 border-b border-black/5 px-5">
        <div className="grid size-9 place-content-center rounded-xl bg-neutral-900 text-white">
          <Activity className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-neutral-900">AgentScope</p>
          <p className="text-xs text-neutral-500">Operations Console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.href || (item.href === "/dashboard" && currentPath === "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-900",
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute inset-0 -z-10 rounded-xl bg-neutral-900/8"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              ) : null}
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-black/5 p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
        >
          <AlertCircle className="size-4" />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-black/5 bg-white/80 px-4 backdrop-blur-xl lg:hidden">
        <div className="text-sm font-semibold text-neutral-900">AgentScope</div>
        <button
          type="button"
          className="grid size-9 place-content-center rounded-lg border border-black/10"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">{SidebarBody}</div>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-40 bg-black/20 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            >
              {SidebarBody}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
