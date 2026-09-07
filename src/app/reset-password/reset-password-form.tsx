"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-sm)] sm:p-10">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Invalid reset link
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          This link is missing a token. Request a new password reset.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-sm)] sm:p-10">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Password updated
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          You can sign in with your new password.
        </p>
        <Button className="mt-6 w-full" onClick={() => router.push("/login")}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-sm)] sm:p-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Choose a new password
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Use at least 12 characters. This link works once and expires in one hour.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (loading) return;
          if (password !== confirm) {
            setError("Passwords do not match");
            return;
          }
          void (async () => {
            setLoading(true);
            setError("");
            try {
              const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
              });
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                setError(j.error ?? "Unable to reset password");
                return;
              }
              setDone(true);
            } catch {
              setError("Unable to reset password. Try again.");
            } finally {
              setLoading(false);
            }
          })();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
          />
        </div>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense
      fallback={
        <div className="h-48 w-full max-w-md animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-border)]/50" />
      }
    >
      <ResetPasswordFormInner />
    </Suspense>
  );
}
