"use client";

import { Loader2, X } from "lucide-react";
import { useState } from "react";

import { createContactRequest } from "@/lib/api";

type GetHelpModalProps = {
  runId?: string | null;
  triggerLabel?: string;
  triggerClassName?: string;
};

export function GetHelpModal({
  runId,
  triggerLabel = "Get Help Debugging",
  triggerClassName,
}: GetHelpModalProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim();
    const normalizedMessage = message.trim();
    if (!normalizedEmail || !normalizedMessage) {
      setError("Email and message are required.");
      return;
    }

    setSubmitting(true);
    try {
      await createContactRequest({
        email: normalizedEmail,
        message: normalizedMessage,
        run_id: runId ?? undefined,
      });
      setSuccess(true);
    } catch (submitError) {
      const fallback = "Unable to submit request right now. Please try again.";
      if (
        submitError &&
        typeof submitError === "object" &&
        "response" in submitError &&
        submitError.response &&
        typeof submitError.response === "object" &&
        "data" in submitError.response &&
        typeof submitError.response.data === "string"
      ) {
        setError(submitError.response.data);
      } else {
        setError(fallback);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    setOpen(false);
    setSubmitting(false);
    setError(null);
    setSuccess(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "rounded-lg border border-blue-400/40 bg-blue-500/20 px-3 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-blue-500/30"
        }
      >
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#101525] p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Having trouble debugging your AI agent?</h2>
                <p className="mt-1 text-sm text-gray-300">
                  Send us a failing run - we'll help you find the root cause.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {success ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Got it. We'll get back to you shortly.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-300">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-md border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-gray-500 focus:border-blue-400/40"
                    placeholder="you@company.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-300">Message</label>
                  <textarea
                    required
                    rows={5}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className="w-full rounded-md border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-gray-500 focus:border-blue-400/40"
                    placeholder="Tell us what failed and what you expected."
                  />
                </div>
                {runId ? (
                  <p className="text-xs text-gray-400">
                    Attached run: <span className="font-mono text-gray-300">{runId}</span>
                  </p>
                ) : null}
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-white/10 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Get help
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
