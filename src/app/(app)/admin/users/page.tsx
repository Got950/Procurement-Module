import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canManageUsers } from "@/lib/rbac/policies";
import { PageHeader } from "@/components/app/page-header";
import { UserManagementPanel } from "./user-management-panel";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageUsers(session.role)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="User management"
        description="Manage roles, user accounts, and access for the procurement workspace. Users sign in with email or username and password."
      />
      <UserManagementPanel currentUserId={session.sub} />
    </div>
  );
}
