"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Lock, Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-14 rounded-[10px] border-[#d7dee8] bg-white pl-11 pr-3 text-[15px] shadow-none placeholder:text-[#94a3b8] focus-visible:border-[#2563eb] focus-visible:ring-[#2563eb]/25";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const registered = searchParams.get("registered") === "1";
  const rawFrom = searchParams.get("from") || "/dashboard";
  // Prevent open redirects — only allow same-origin relative paths
  const from =
    rawFrom.startsWith("/") && !rawFrom.startsWith("//") && !rawFrom.includes("://")
      ? rawFrom
      : "/dashboard";

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="w-full max-w-[420px] rounded-[16px] border border-[#e2e8f0] bg-white/95 p-8 shadow-[0_8px_30px_rgba(15,23,42,0.06),0_2px_8px_rgba(15,23,42,0.04)] backdrop-blur-[2px] sm:p-10"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
      <div className="mb-8">
        <div className="mb-7 flex items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[#2563eb] text-[1.25rem] font-bold tracking-tight text-white shadow-[0_4px_12px_rgba(37,99,235,0.28)] sm:h-[52px] sm:w-[52px]">
            M
          </span>
          <div>
            <span className="block text-[17px] font-semibold tracking-tight text-[#0f2744]">
              MedFlow
            </span>
            <span className="mt-0.5 block text-[12px] font-medium tracking-wide text-[#64748b]">
              Pharmaceutical Procurement
            </span>
          </div>
        </div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-[#0f2744]">
          Sign in
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
          Access your enterprise procurement workspace
        </p>
      </div>

      {registered ? (
        <p
          role="status"
          className="mb-5 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-2.5 text-xs text-[#0f2744]"
        >
          Account created. Sign in with your email or username.
        </p>
      ) : null}

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!identifier.trim() || !password || loading) {
            if (!identifier.trim() || !password) {
              setError("Enter your email/username and password.");
            }
            return;
          }
          void (async () => {
            setLoading(true);
            setError("");
            try {
              const res = await fetch("/api/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: identifier.trim(), password }),
              });
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                setError(j.error ?? "Login failed");
                return;
              }
              router.push(from);
              router.refresh();
            } catch {
              setError("Unable to sign in. Try again.");
            } finally {
              setLoading(false);
            }
          })();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="identifier" className="text-[13px] text-[#0f2744]">
            Email or username
          </Label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              placeholder="admin@must.co.in"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password" className="text-[13px] text-[#0f2744]">
              Password
            </Label>
            <Link
              href="/forgot-password"
              className="text-[12px] font-medium text-[#2563eb] transition-colors hover:text-[#1d4ed8]"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(fieldClass, "pr-11")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#94a3b8] transition-colors hover:text-[#475569] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/35"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <EyeOff className="h-[18px] w-[18px]" aria-hidden />
              ) : (
                <Eye className="h-[18px] w-[18px]" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-[10px] border border-red-200 bg-[var(--color-danger-soft)] px-3.5 py-2.5 text-xs text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          className="mt-1 h-14 w-full rounded-[10px] bg-[#2563eb] text-[15px] font-semibold shadow-[0_4px_14px_rgba(37,99,235,0.25)] transition-all hover:bg-[#1d4ed8] hover:shadow-[0_6px_18px_rgba(37,99,235,0.3)]"
          disabled={loading}
        >
          {loading ? (
            "Signing in…"
          ) : (
            <>
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </Button>

        <div className="flex items-center gap-3 pt-1" aria-hidden>
          <div className="h-px flex-1 bg-[#e2e8f0]" />
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#94a3b8]">
            or
          </span>
          <div className="h-px flex-1 bg-[#e2e8f0]" />
        </div>

        <p className="text-center text-sm text-[#64748b]">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-[#2563eb] transition-colors hover:text-[#1d4ed8]"
          >
            Create Account
          </Link>
        </p>
      </form>

      <div className="mt-8 flex items-center justify-center gap-1.5 border-t border-[#eef2f7] pt-5 text-[12px] text-[#94a3b8]">
        <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Secure enterprise access</span>
      </div>
    </motion.div>
    </MotionConfig>
  );
}
