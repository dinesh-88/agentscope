"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, CreditCard, FileText, LayoutDashboard, Menu, Moon, PlaySquare, Settings, ShieldCheck, Sun, Users, X } from "lucide-react";

import { UI_SESSION_COOKIE_NAME, getCurrentUser, logout } from "@/lib/api";

type SidebarProps = {
  activePath?: string;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: PlaySquare },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/insights", label: "Insights", icon: AlertCircle },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin/telemetry", label: "Admin Telemetry", icon: ShieldCheck },
];

export function Sidebar({ activePath = "/dashboard", theme = "light", onToggleTheme }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("agentscope-sidebar-collapsed") === "true";
  });
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const currentPath = pathname ?? activePath;

  useEffect(() => {
    let cancelled = false;
    void getCurrentUser()
      .then((me) => {
        if (!cancelled) {
          setPermissions(me.user.permissions);
          setIsSuperAdmin(me.user.is_super_admin);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions([]);
          setIsSuperAdmin(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("agentscope-sidebar-collapsed", desktopCollapsed ? "true" : "false");
  }, [desktopCollapsed]);

  const visibleItems = navItems.filter((item) => {
    if (!permissions) return item.href !== "/settings" && item.href !== "/settings/team" && item.href !== "/admin/telemetry";
    if (item.href === "/settings" || item.href === "/settings/team") return permissions.includes("project:manage");
    if (item.href === "/admin/telemetry") return isSuperAdmin;
    return true;
  });

  async function handleLogout() {
    await logout();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${UI_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    window.location.href = "/login";
  }

  return (
    <>
      <div
        className={`fixed top-0 right-0 left-0 z-20 lg:hidden ${
          theme === "dark" ? "border-b border-white/10 bg-[#0F141B]" : "border-b border-gray-200 bg-white"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <h1 className={`text-lg font-semibold ${theme === "dark" ? "text-gray-100" : "text-gray-900"}`}>AgentScope</h1>
          <button
            onClick={() => setMobileOpen((value) => !value)}
            className={`rounded-lg p-2 ${theme === "dark" ? "hover:bg-white/10" : "hover:bg-gray-100"}`}
            type="button"
          >
            {mobileOpen ? (
              <X className={`h-6 w-6 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`} />
            ) : (
              <Menu className={`h-6 w-6 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`} />
            )}
          </button>
        </div>
      </div>

      <aside
        className={`fixed inset-y-0 left-0 z-30 transition-transform duration-300 lg:translate-x-0 ${
          desktopCollapsed ? "w-20" : "w-64"
        } ${
          theme === "dark" ? "border-r border-white/10 bg-[#0F141B]" : "border-r border-gray-200 bg-white"
        } ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className={`hidden h-16 items-center justify-between px-3 lg:flex ${theme === "dark" ? "border-b border-white/10" : "border-b border-gray-200"}`}>
            <h1 className={`text-lg font-semibold ${theme === "dark" ? "text-gray-100" : "text-gray-900"} ${desktopCollapsed ? "hidden" : "block"}`}>
              AgentScope
            </h1>
            <button
              type="button"
              onClick={() => setDesktopCollapsed((value) => !value)}
              className={`rounded-lg p-1.5 ${
                theme === "dark" ? "text-gray-300 hover:bg-white/10" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {desktopCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className={`flex-1 space-y-1 px-3 pt-20 pb-4 lg:pt-4 ${desktopCollapsed ? "lg:px-2" : ""}`}>
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.href || (item.href === "/dashboard" && currentPath === "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    desktopCollapsed ? "justify-center gap-0" : "gap-3"
                  } ${
                    isActive
                      ? theme === "dark"
                        ? "bg-white/10 text-gray-100"
                        : "bg-gray-100 text-gray-900"
                      : theme === "dark"
                        ? "text-gray-400 hover:bg-white/5 hover:text-gray-100"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                  title={desktopCollapsed ? item.label : undefined}
                >
                  <Icon className="h-5 w-5" />
                  {!desktopCollapsed ? <span>{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>

          <div className={`p-3 ${theme === "dark" ? "border-t border-white/10" : "border-t border-gray-200"} ${desktopCollapsed ? "lg:px-2" : ""}`}>
            <button
              type="button"
              onClick={onToggleTheme}
              className={`mb-2 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                desktopCollapsed ? "justify-center gap-0" : "gap-3"
              } ${
                theme === "dark"
                  ? "text-gray-400 hover:bg-white/5 hover:text-gray-100"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              title={desktopCollapsed ? (theme === "dark" ? "Light theme" : "Dark theme") : undefined}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              {!desktopCollapsed ? <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span> : null}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                desktopCollapsed ? "hidden lg:block lg:text-center" : ""
              } ${
                theme === "dark"
                  ? "text-gray-400 hover:bg-white/5 hover:text-gray-100"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              title={desktopCollapsed ? "Sign out" : undefined}
            >
              {desktopCollapsed ? "↪" : "Sign out"}
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-10 bg-black/20 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className={`w-0 transition-all lg:block ${desktopCollapsed ? "lg:w-20" : "lg:w-64"}`} />
      <div className="h-16 lg:hidden" />
    </>
  );
}
