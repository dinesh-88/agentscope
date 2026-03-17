"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Github } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_BASE_URL, login, register } from "@/lib/api";

type LoginFormProps = {
  nextPath?: string;
  initialMode?: "login" | "register";
};

export function LoginForm({ nextPath, initialMode = "login" }: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("owner@demo.agentscope.local");
  const [password, setPassword] = useState("demo-password");
  const [displayName, setDisplayName] = useState("Demo Owner");
  const [organizationName, setOrganizationName] = useState("Acme Agents");
  const [projectName, setProjectName] = useState("Primary Project");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

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
        !response.onboarding.has_first_run || !response.onboarding.has_project
          ? "/onboarding"
          : nextPath || "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch (error) {
      if (axios.isAxiosError(error) && typeof error.response?.data === "string") {
        setError(error.response.data);
      } else {
        setError(
          mode === "login"
            ? "Login failed. Check your email and password."
            : "Registration failed. Check the submitted details."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.22),_transparent_38%),linear-gradient(180deg,_#f8fbff_0%,_#eef4ff_40%,_#f4f6fb_100%)] px-6 py-12 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="flex flex-col justify-center gap-6">
            <div className="inline-flex w-fit rounded-full border border-primary/20 bg-white/70 px-3 py-1 text-xs font-medium tracking-[0.24em] text-primary uppercase shadow-sm backdrop-blur">
              AgentScope Console
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-slate-950">
                JWT-backed access for the UI. API-key access for SDK ingest.
              </h1>
              <p className="max-w-xl text-base text-slate-600">
                Sign in or create a workspace owner account to inspect runs, replay traces, and access sandbox controls.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-4 shadow-sm backdrop-blur">
                <div className="font-medium text-slate-900">UI routes</div>
                <p>Require `Authorization: Bearer &lt;jwt&gt;` at the API layer.</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-4 shadow-sm backdrop-blur">
                <div className="font-medium text-slate-900">SDK ingest</div>
                <p>Locked to project-scoped API keys.</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-4 shadow-sm backdrop-blur">
                <div className="font-medium text-slate-900">Sandbox</div>
                <p>Restricted to organization owners and admins.</p>
              </div>
            </div>
          </section>

          <Card className="border border-slate-200/80 bg-white/90 py-0 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
            <CardHeader className="border-b border-slate-200/70 px-8 py-8">
              <CardTitle className="text-2xl text-slate-950">
                {mode === "login" ? "Sign in" : "Create account"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                {mode === "login"
                  ? "Use the seeded demo owner account or any provisioned UI user."
                  : "Registration creates a user session and a default workspace for onboarding."}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 py-8">
              {!isHydrated ? (
                <div className="space-y-5" suppressHydrationWarning>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                    <div className="h-10 rounded-xl bg-white shadow-sm" />
                    <div className="h-10 rounded-xl bg-transparent" />
                  </div>
                  <div className="h-20 rounded-2xl bg-slate-100" />
                  <div className="h-20 rounded-2xl bg-slate-100" />
                  <div className="h-11 rounded-xl bg-slate-950/10" />
                </div>
              ) : (
                <>
              <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                <button
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}
                  onClick={() => {
                    setError(null);
                    setMode("login");
                  }}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${mode === "register" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}
                  onClick={() => {
                    setError(null);
                    setMode("register");
                  }}
                  type="button"
                >
                  Register
                </button>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <a
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                  href={`${API_BASE_URL}/v1/auth/oauth/google`}
                >
                  Continue with Google
                </a>
                <a
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                  href={`${API_BASE_URL}/v1/auth/oauth/github`}
                >
                  <Github className="size-4" />
                  Continue with GitHub
                </a>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                {mode === "register" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">Display name</span>
                    <input
                      autoComplete="name"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      onChange={(event) => setDisplayName(event.target.value)}
                      type="text"
                      value={displayName}
                    />
                  </label>
                ) : null}

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-700">Email</span>
                  <input
                    autoComplete="email"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    value={email}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-700">Password</span>
                  <input
                    autoComplete="current-password"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </label>

                {mode === "register" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">Organization</span>
                    <input
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      onChange={(event) => setOrganizationName(event.target.value)}
                      required
                      type="text"
                      value={organizationName}
                    />
                  </label>
                ) : null}

                {mode === "register" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-700">Project</span>
                    <input
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      onChange={(event) => setProjectName(event.target.value)}
                      type="text"
                      value={projectName}
                    />
                  </label>
                ) : null}

                {error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <Button className="h-11 w-full rounded-xl text-sm font-medium" disabled={isSubmitting} type="submit">
                  {isSubmitting
                    ? mode === "login"
                      ? "Signing in..."
                      : "Creating account..."
                    : mode === "login"
                      ? "Sign in"
                      : "Create account"}
                </Button>
              </form>

              <div className="mt-6 rounded-2xl bg-slate-950 px-4 py-4 text-sm text-slate-200">
                <div className="font-medium text-white">Demo credentials</div>
                <p className="mt-1">Email: owner@demo.agentscope.local</p>
                <p>Password: demo-password</p>
              </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
