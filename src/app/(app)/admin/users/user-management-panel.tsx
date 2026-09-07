"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

type RoleRow = { id: string; code: string; label: string };
type UserRow = {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: string;
  isActive: boolean;
  hasPassword: boolean;
};

export function UserManagementPanel({ currentUserId }: { currentUserId: string }) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleOpen, setRoleOpen] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleFeedback, setRoleFeedback] = useState<string | null>(null);

  const [userOpen, setUserOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [userFeedback, setUserFeedback] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRoles, rUsers] = await Promise.all([
        fetch("/api/admin/roles"),
        fetch("/api/admin/users"),
      ]);
      const jRoles = (await rRoles.json()) as { roles?: RoleRow[]; error?: string };
      const jUsers = (await rUsers.json()) as { users?: UserRow[]; error?: string };
      if (!rRoles.ok) throw new Error(jRoles.error ?? "Failed to load roles");
      if (!rUsers.ok) throw new Error(jUsers.error ?? "Failed to load users");
      const roleList = jRoles.roles ?? [];
      setRoles(roleList);
      setUsers(jUsers.users ?? []);
      setUserRole((prev) => prev || roleList[0]?.code || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRole = async () => {
    setRoleSaving(true);
    setRoleFeedback(null);
    try {
      const r = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: roleLabel }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      setRoleLabel("");
      setRoleOpen(false);
      await load();
      setRoleFeedback("Role saved.");
    } catch (e) {
      setRoleFeedback(e instanceof Error ? e.message : "Save failed");
    } finally {
      setRoleSaving(false);
    }
  };

  const saveUser = async () => {
    setUserSaving(true);
    setUserFeedback(null);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          username: userUsername,
          password: userPassword,
          role: userRole,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Save failed");
      setUserEmail("");
      setUserUsername("");
      setUserPassword("");
      setUserOpen(false);
      await load();
      setUserFeedback("User created.");
    } catch (e) {
      setUserFeedback(e instanceof Error ? e.message : "Save failed");
    } finally {
      setUserSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setError(null);
    setDeleteFeedback(null);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Delete failed");
      setDeleteTarget(null);
      setDeleteFeedback("User deleted successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const savePasswordForUser = async () => {
    if (!passwordTarget) return;
    setPasswordSaving(true);
    setPasswordFeedback(null);
    setPasswordError(null);
    setError(null);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(passwordTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordValue }),
      });
      const j = (await r.json()) as { error?: string; message?: string };
      if (!r.ok) throw new Error(j.error ?? "Password update failed");
      setPasswordTarget(null);
      setPasswordValue("");
      setPasswordFeedback(j.message ?? "Password updated.");
      await load();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Password update failed");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {roleFeedback || userFeedback || deleteFeedback || passwordFeedback ? (
        <p className="text-sm text-[var(--color-success)]">
          {roleFeedback || userFeedback || deleteFeedback || passwordFeedback}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-[var(--color-muted)]">Loading users…</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Roles */}
        <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-fg)]">Roles</h2>
              <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
                Access profiles available when creating users.
              </p>
            </div>
            <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  Add role
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add role</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <Label htmlFor="role-label">Role name</Label>
                    <Input
                      id="role-label"
                      placeholder="e.g. Warehouse Manager"
                      value={roleLabel}
                      onChange={(e) => setRoleLabel(e.target.value)}
                    />
                  </div>
                  {roleFeedback ? (
                    <p className="text-xs text-[var(--color-muted)]">{roleFeedback}</p>
                  ) : null}
                  <Button disabled={!roleLabel.trim() || roleSaving} onClick={() => void saveRole()}>
                    {roleSaving ? "Saving…" : "Save role"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="overflow-x-auto">
            <table className="app-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Code</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-[var(--color-fg)]">{r.label}</td>
                    <td>
                      <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-muted)]">
                        {r.code}
                      </code>
                    </td>
                  </tr>
                ))}
                {!loading && roles.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-10 text-center text-sm text-[var(--color-muted)]">
                      No roles yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* Users */}
        <section className="app-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-fg)]">Users</h2>
              <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
                Accounts, assigned roles, and account status.
              </p>
            </div>
            <Dialog open={userOpen} onOpenChange={setUserOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  Add user
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add user</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <Label htmlFor="user-email">Email</Label>
                    <Input
                      id="user-email"
                      type="email"
                      placeholder="user@company.com"
                      value={userEmail}
                      onChange={(e) => setUserEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="user-username">Username</Label>
                    <Input
                      id="user-username"
                      placeholder="jane.doe"
                      value={userUsername}
                      onChange={(e) => setUserUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="user-password">Password</Label>
                    <Input
                      id="user-password"
                      type="password"
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={userRole} onValueChange={setUserRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.code}>
                            {r.label} ({r.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {userFeedback ? (
                    <p className="text-xs text-[var(--color-muted)]">{userFeedback}</p>
                  ) : null}
                  <Button
                    disabled={
                      !userEmail.trim() ||
                      !userUsername.trim() ||
                      !userPassword ||
                      !userRole ||
                      userSaving
                    }
                    onClick={() => void saveUser()}
                  >
                    {userSaving ? "Saving…" : "Save user"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="overflow-x-auto">
            <table className="app-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium text-[var(--color-fg)]">
                        {u.name}
                        {u.id === currentUserId ? (
                          <span className="ml-2 text-[11px] font-normal text-[var(--color-muted)]">
                            (you)
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                        {u.email}
                        {u.username ? ` · @${u.username}` : ""}
                      </div>
                    </td>
                    <td>
                      <Badge variant="accent">{u.role.replace(/_/g, " ")}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={u.isActive ? "success" : "default"}>
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {!u.hasPassword ? <Badge variant="warning">No password</Badge> : null}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPasswordFeedback(null);
                            setPasswordError(null);
                            setPasswordValue("");
                            setPasswordTarget(u);
                          }}
                        >
                          Set password
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                          disabled={deletingId === u.id || u.id === currentUserId}
                          title={u.id === currentUserId ? "Cannot delete yourself" : "Delete user"}
                          onClick={() => {
                            setDeleteFeedback(null);
                            setDeleteTarget(u);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-[var(--color-muted)]">
                      No users yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Dialog
        open={!!passwordTarget}
        onOpenChange={(open) => {
          if (!open && !passwordSaving) {
            setPasswordTarget(null);
            setPasswordValue("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted)]">
            {passwordTarget ? (
              <>
                Set a new password for{" "}
                <span className="font-medium text-[var(--color-fg)]">{passwordTarget.name}</span>.
                Their existing sessions will be signed out.
              </>
            ) : null}
          </p>
          <div className="mt-3 space-y-2">
            <Label htmlFor="admin-set-password">New password</Label>
            <Input
              id="admin-set-password"
              type="password"
              autoComplete="new-password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              minLength={12}
            />
          </div>
          {passwordError ? (
            <p className="mt-2 text-xs text-[var(--color-danger)]">{passwordError}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={passwordSaving}
              onClick={() => {
                setPasswordTarget(null);
                setPasswordValue("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={passwordSaving || passwordValue.length < 12}
              onClick={() => void savePasswordForUser()}
            >
              {passwordSaving ? "Saving…" : "Save password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletingId) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted)]">
            This action cannot be undone.{" "}
            {deleteTarget ? (
              <>
                You are about to delete{" "}
                <span className="font-medium text-[var(--color-fg)]">{deleteTarget.name}</span> (
                {deleteTarget.email}).
              </>
            ) : null}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!!deletingId}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!!deletingId}
              onClick={() => void deleteUser()}
            >
              {deletingId ? "Deleting…" : "Delete user"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
