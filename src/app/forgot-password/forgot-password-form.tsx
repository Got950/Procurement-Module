"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-sm)] sm:p-10">
      <div className="mb-8">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-sm font-bold text-white">
            M
          </span>
          <div>
            <span className="block text-[13px] font-semibold tracking-[0.08em] text-[var(--color-fg)]">
              MedFlow
            </span>
            <span className="block text-[11px] text-[var(--color-muted)]">
              Pharmaceutical Procurement
            </span>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Reset password
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Enter your account email. If it exists, we will send reset instructions.
        </p>
      </div>

      {message ? (
        <div className="space-y-4">
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-fg)]">
            {message}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            If Gmail is not connected for this deployment, ask an administrator to set a new
            password under User management.
          </p>
          <Link
            href="/login"
            className="inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || loading) return;
            void (async () => {
              setLoading(true);
              setError("");
              try {
                const res = await fetch("/api/auth/forgot-password", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: email.trim() }),
                });
                const j = (await res.json().catch(() => ({}))) as {
                  message?: string;
                  error?: string;
                };
                if (!res.ok) {
                  setError(j.error ?? "Unable to request a reset");
                  return;
                }
                setMessage(
                  j.message ??
                    "If an account exists for that email, password reset instructions have been sent."
                );
              } catch {
                setError("Unable to request a reset. Try again.");
              } finally {
                setLoading(false);
              }
            })();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </Button>
          <Link
            href="/login"
            className="block text-center text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
