"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Profile = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  department: string | null;
};

export function SettingsForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const j = (await res.json().catch(() => ({}))) as { user?: Profile; error?: string };
        if (!res.ok) {
          setLoadError(j.error ?? "Unable to load profile");
          return;
        }
        setProfile(j.user ?? null);
      } catch {
        setLoadError("Unable to load profile");
      }
    })();
  }, []);

  if (loadError) {
    return <p className="text-sm text-[var(--color-danger)]">{loadError}</p>;
  }
  if (!profile) {
    return (
      <div className="h-32 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-border)]/40" />
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Profile</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="text-[var(--color-muted)]">Name</dt>
            <dd className="font-medium text-[var(--color-fg)]">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Email</dt>
            <dd className="font-medium text-[var(--color-fg)]">{profile.email}</dd>
          </div>
          {profile.username ? (
            <div>
              <dt className="text-[var(--color-muted)]">Username</dt>
              <dd className="font-medium text-[var(--color-fg)]">{profile.username}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[var(--color-muted)]">Role</dt>
            <dd className="font-medium capitalize text-[var(--color-fg)]">
              {profile.role.replace(/_/g, " ").toLowerCase()}
            </dd>
          </div>
          {profile.department ? (
            <div>
              <dt className="text-[var(--color-muted)]">Department</dt>
              <dd className="font-medium text-[var(--color-fg)]">{profile.department}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Change password</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Minimum 12 characters. Other sessions will be signed out.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (saving) return;
            if (newPassword !== confirm) {
              setError("New passwords do not match");
              return;
            }
            void (async () => {
              setSaving(true);
              setError("");
              setFeedback(null);
              try {
                const res = await fetch("/api/settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ currentPassword, newPassword }),
                });
                const j = (await res.json().catch(() => ({}))) as {
                  message?: string;
                  error?: string;
                };
                if (!res.ok) {
                  setError(j.error ?? "Unable to update password");
                  return;
                }
                setFeedback(j.message ?? "Password updated.");
                setCurrentPassword("");
                setNewPassword("");
                setConfirm("");
              } catch {
                setError("Unable to update password");
              } finally {
                setSaving(false);
              }
            })();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={12}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
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
          {feedback ? <p className="text-sm text-[var(--color-accent)]">{feedback}</p> : null}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Update password"}
          </Button>
        </form>
      </section>
    </div>
  );
}
