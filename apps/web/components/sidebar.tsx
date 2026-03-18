"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, FlaskConical, LayoutDashboard, Menu, PlaySquare, Settings, Users, X } from "lucide-react";

import { getCurrentUser, logout } from "@/lib/api";

type SidebarProps = {
  activePath?: string;
  theme?: "light" | "dark";
};

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs", label: "Runs", icon: PlaySquare },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/insights", label: "Insights", icon: AlertCircle },
  { href: "/sandbox", label: "Sandbox", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ activePath = "/dashboard", theme = "light" }: SidebarProps) {
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
        className={`fixed inset-y-0 left-0 z-30 w-64 transition-transform duration-300 lg:translate-x-0 ${
          theme === "dark" ? "border-r border-white/10 bg-[#0F141B]" : "border-r border-gray-200 bg-white"
        } ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div
            className={`hidden h-16 items-center px-6 lg:flex ${theme === "dark" ? "border-b border-white/10" : "border-b border-gray-200"}`}
          >
            <h1 className={`text-lg font-semibold ${theme === "dark" ? "text-gray-100" : "text-gray-900"}`}>AgentScope</h1>
          </div>

          <nav className="flex-1 space-y-1 px-3 pt-20 pb-4 lg:pt-4">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.href || (item.href === "/dashboard" && currentPath === "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? theme === "dark"
                        ? "bg-white/10 text-gray-100"
                        : "bg-gray-100 text-gray-900"
                      : theme === "dark"
                        ? "text-gray-400 hover:bg-white/5 hover:text-gray-100"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className={`p-3 ${theme === "dark" ? "border-t border-white/10" : "border-t border-gray-200"}`}>
            <button
              type="button"
              onClick={handleLogout}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                theme === "dark"
                  ? "text-gray-400 hover:bg-white/5 hover:text-gray-100"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              Sign out
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

      <div className="w-0 lg:w-64" />
      <div className="h-16 lg:hidden" />
    </>
  );
}
