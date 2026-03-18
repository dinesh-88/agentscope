"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Activity, Eye, EyeOff, Github, Lock, Mail, User } from "lucide-react";

import { API_BASE_URL, login, register } from "@/lib/api";

type LoginFormProps = {
  nextPath?: string;
  initialMode?: "login" | "register";
};

export function LoginForm({ nextPath, initialMode = "login" }: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState(mode === "login" ? "owner@demo.agentscope.local" : "");
  const [password, setPassword] = useState(mode === "login" ? "demo-password" : "");
  const [displayName, setDisplayName] = useState("Demo Owner");
  const [organizationName, setOrganizationName] = useState("Acme Agents");
  const [projectName, setProjectName] = useState("Primary Project");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response =
        mode === "login"
          ? await login(email, password)
          : await register({
              email,
              password,
              display_name: displayName,
              organization_name: organizationName,
              project_name: projectName,
            });

      const destination =
        mode === "login"
          ? nextPath || "/dashboard"
          : !response.onboarding.has_first_run || !response.onboarding.has_project
            ? "/onboarding"
            : "/dashboard";

      router.replace(destination);
      router.refresh();
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && typeof requestError.response?.data === "string") {
        setError(requestError.response.data);
      } else {
        setError(
          mode === "login"
            ? "Login failed. Check your email and password."
            : "Registration failed. Check the submitted details.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "login") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0B0F14] px-6 py-12 text-white">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-semibold">AgentScope</span>
          </Link>

          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8 backdrop-blur-sm">
            <div className="mb-8 text-center">
              <h1 className="mb-2 text-2xl font-bold">Welcome back</h1>
              <p className="text-sm text-gray-400">Sign in to your AgentScope account</p>
            </div>

            <div className="mb-6 space-y-3">
              <a
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
                href={`${API_BASE_URL}/v1/auth/oauth/github`}
              >
                <Github className="h-5 w-5" />
                <span className="font-medium">Continue with GitHub</span>
              </a>
              <a
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
                href={`${API_BASE_URL}/v1/auth/oauth/google`}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                <span className="font-medium">Continue with Google</span>
              </a>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-gradient-to-br from-gray-900/50 to-gray-800/50 px-2 text-gray-400">
                  Or continue with email
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pr-4 pl-10 transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pr-12 pl-10 transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 transition-colors hover:text-white"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/10 bg-white/5 text-purple-500 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0"
                  />
                  <span className="text-gray-400">Remember me</span>
                </label>
                <Link href="/settings" className="text-purple-400 transition-colors hover:text-purple-300">
                  Forgot password?
                </Link>
              </div>

              {error ? (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-3 font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-400">
              Don&apos;t have an account?{" "}
              <Link
                href="/signup"
                onClick={() => setMode("register")}
                className="font-medium text-purple-400 transition-colors hover:text-purple-300"
              >
                Sign up
              </Link>
            </p>
          </div>

          <p className="mt-8 text-center text-xs text-gray-500">
            By signing in, you agree to our{" "}
            <Link href="/settings/team" className="text-gray-400 transition-colors hover:text-white">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/settings" className="text-gray-400 transition-colors hover:text-white">
              Privacy Policy
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0F14] px-6 py-12 text-white">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-semibold">AgentScope</span>
        </Link>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8 backdrop-blur-sm">
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-2xl font-bold">Create your account</h1>
            <p className="text-sm text-gray-400">Start debugging your AI agents today</p>
          </div>

          <div className="mb-6 space-y-3">
            <a
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
              href={`${API_BASE_URL}/v1/auth/oauth/github`}
            >
              <Github className="h-5 w-5" />
              <span className="font-medium">Continue with GitHub</span>
            </a>
            <a
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
              href={`${API_BASE_URL}/v1/auth/oauth/google`}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span className="font-medium">Continue with Google</span>
            </a>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-gradient-to-br from-gray-900/50 to-gray-800/50 px-2 text-gray-400">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-2 block text-sm font-medium">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="name"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="John Doe"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pr-4 pl-10 transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="email-signup" className="mb-2 block text-sm font-medium">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="email-signup"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pr-4 pl-10 transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password-signup" className="mb-2 block text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="password-signup"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a strong password"
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pr-12 pl-10 transition-all focus:border-transparent focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 transition-colors hover:text-white"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Must be at least 8 characters</p>
            </div>

            <div className="hidden">
              <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required type="text" />
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} type="text" />
            </div>

            <label className="group flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreeToTerms}
                onChange={(event) => setAgreeToTerms(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/10 bg-white/5 text-purple-500 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0"
                required
              />
              <span className="text-sm text-gray-400 transition-colors group-hover:text-gray-300">
                I agree to the{" "}
                <Link href="/settings/team" className="text-purple-400 hover:text-purple-300">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/settings" className="text-purple-400 hover:text-purple-300">
                  Privacy Policy
                </Link>
              </span>
            </label>

            {error ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-3 font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-400">
            Already have an account?{" "}
            <Link href="/login" onClick={() => setMode("login")} className="font-medium text-purple-400 transition-colors hover:text-purple-300">
              Sign in
            </Link>
          </p>
        </div>

        <div className="mt-8 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
          <p className="text-center text-xs text-blue-300">
            Free plan includes 1,000 traces per month. No credit card required.
          </p>
        </div>
      </div>
    </main>
  );
}
