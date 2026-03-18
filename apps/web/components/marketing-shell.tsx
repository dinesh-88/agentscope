import Link from "next/link";
import { cookies } from "next/headers";
import { type ReactNode } from "react";
import { Activity } from "lucide-react";

import { UI_SESSION_COOKIE_NAME } from "@/lib/api";

type MarketingShellProps = {
  children: ReactNode;
};

export async function MarketingShell({ children }: MarketingShellProps) {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = Boolean(token);

  return (
    <div className="min-h-screen bg-[#0B0F14] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0B0F14]/80 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-[1368px] items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-semibold">AgentScope</span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-sm md:flex">
              <Link href="/#features" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Features
              </Link>
              <Link href="/demo" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Demo
              </Link>
              <Link href="/pricing" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Pricing
              </Link>
              <Link href="/docs" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Docs
              </Link>
            </div>
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              >
                Go to Dashboard
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-sm text-gray-400 transition-colors hover:text-white">
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                >
                  Start Free and Send First Trace
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      {children}

      <footer className="border-t border-white/10 px-6 py-12">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-8 grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <span className="font-semibold">AgentScope</span>
              </div>
              <p className="text-sm text-gray-400">Debug and optimize your AI agents with confidence.</p>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/#features" className="transition-colors hover:text-white">Features</Link></li>
                <li><Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link></li>
                <li><Link href="/docs" className="transition-colors hover:text-white">Docs</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/docs" className="transition-colors hover:text-white">About</Link></li>
                <li><Link href="/demo" className="transition-colors hover:text-white">Product Tour</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/legal/privacy" className="transition-colors hover:text-white">Privacy</Link></li>
                <li><Link href="/legal/terms" className="transition-colors hover:text-white">Terms</Link></li>
                <li><Link href="/docs/security" className="transition-colors hover:text-white">Security</Link></li>
                <li><Link href="/status" className="transition-colors hover:text-white">Status</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 text-sm text-gray-400">© 2026 AgentScope. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
