"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PUBLIC_REGISTRATION_ROLE_OPTIONS } from "@/lib/public-roles";

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
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
          Create Account
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Register for access to the procurement workspace
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (loading) return;
          if (!name.trim() || !email.trim() || !username.trim() || !role || !password) {
            setError("Please fill in all fields.");
            return;
          }
          if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
          }
          void (async () => {
            setLoading(true);
            setError("");
            try {
              const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: name.trim(),
                  email: email.trim(),
                  username: username.trim(),
                  role,
                  password,
                  confirmPassword,
                }),
              });
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                setError(j.error ?? "Unable to create account");
                return;
              }
              router.push("/login?registered=1");
              router.refresh();
            } catch {
              setError("Unable to create account. Try again.");
            } finally {
              setLoading(false);
            }
          })();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="role" aria-label="Select role">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {PUBLIC_REGISTRATION_ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.code} value={opt.code}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={200}
          />
          <p className="text-[11px] text-[var(--color-muted)]">At least 12 characters</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={12}
            maxLength={200}
          />
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" className="mt-2 w-full" disabled={loading}>
          {loading ? "Creating account…" : "Create Account"}
        </Button>
        <p className="pt-1 text-center text-sm text-[var(--color-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
