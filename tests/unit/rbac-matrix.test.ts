import { describe, expect, it } from "vitest";
import { IndentStatus, Role, isRole } from "@/lib/domain-types";
import {
  canApproveIndent,
  canApproveVendorChoice,
  canCreateIndent,
  canDirectorApprove,
  canFinance,
  canAccessItemCatalog,
  canManageMasters,
  canManageUsers,
  canMdApprove,
  canProcurement,
  getNavForRole,
} from "@/lib/rbac/policies";
import { canViewIndent, indentListWhereForRole } from "@/lib/indent-access";
import { allTools } from "@/server/copilot/tool-registry";
import "@/server/copilot/tools";

const ROLES = Object.values(Role);
const STATUSES = Object.values(IndentStatus);

describe("RBAC × status full matrix", () => {
  it("only TEAM_LEADER × PENDING_TL_INDENT may approve indent", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const allowed = role === "TEAM_LEADER" && status === "PENDING_TL_INDENT";
        expect(canApproveIndent(role, status), `${role}/${status}`).toBe(allowed);
      }
    }
  });

  it("only TEAM_LEADER × PENDING_TL_VENDOR may approve vendor choice", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const allowed = role === "TEAM_LEADER" && status === "PENDING_TL_VENDOR";
        expect(canApproveVendorChoice(role, status), `${role}/${status}`).toBe(allowed);
      }
    }
  });

  it("only DIRECTOR × PENDING_DIRECTOR may director-approve", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const allowed = role === "DIRECTOR" && status === "PENDING_DIRECTOR";
        expect(canDirectorApprove(role, status), `${role}/${status}`).toBe(allowed);
      }
    }
  });

  it("only MD × PENDING_MD may md-approve", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const allowed = role === "MD" && status === "PENDING_MD";
        expect(canMdApprove(role, status), `${role}/${status}`).toBe(allowed);
      }
    }
  });

  it("ADMIN never owns an approval stage for any status", () => {
    for (const status of STATUSES) {
      expect(canApproveIndent("ADMIN", status)).toBe(false);
      expect(canApproveVendorChoice("ADMIN", status)).toBe(false);
      expect(canDirectorApprove("ADMIN", status)).toBe(false);
      expect(canMdApprove("ADMIN", status)).toBe(false);
    }
  });

  it("role capability flags are exact for every role", () => {
    for (const role of ROLES) {
      expect(canCreateIndent(role), `create:${role}`).toBe(
        role === "REQUESTER" || role === "ADMIN"
      );
      expect(canProcurement(role), `proc:${role}`).toBe(
        role === "PROCUREMENT" || role === "ADMIN"
      );
      expect(canFinance(role), `fin:${role}`).toBe(role === "FINANCE" || role === "ADMIN");
      expect(canManageMasters(role), `masters:${role}`).toBe(
        role === "PROCUREMENT" || role === "ADMIN"
      );
      expect(canAccessItemCatalog(role), `items:${role}`).toBe(
        role === "REQUESTER" || role === "PROCUREMENT" || role === "ADMIN"
      );
      expect(canManageUsers(role), `users:${role}`).toBe(role === "ADMIN");
    }
  });

  it("every role has a non-empty nav including Copilot", () => {
    for (const role of ROLES) {
      const nav = getNavForRole(role);
      expect(nav.length, role).toBeGreaterThan(0);
      expect(nav.some((l) => l.href === "/copilot"), role).toBe(true);
    }
  });

  it("unknown role values fail closed via isRole", () => {
    expect(isRole("REQUESTER")).toBe(true);
    expect(isRole("SUPERUSER")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(getNavForRole("SUPERUSER")).toEqual([
      { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
    ]);
  });
});

describe("indent visibility matrix", () => {
  const owner = "user-owner";
  const other = "user-other";
  const draft = { requesterId: owner, currentStatus: "DRAFT" as const };
  const tlPending = {
    requesterId: owner,
    currentStatus: "PENDING_TL_INDENT" as const,
  };
  const financePending = {
    requesterId: owner,
    currentStatus: "PENDING_FINANCE" as const,
  };

  it("REQUESTER sees only own indents", () => {
    expect(canViewIndent({ sub: owner, role: "REQUESTER" }, draft)).toBe(true);
    expect(canViewIndent({ sub: other, role: "REQUESTER" }, draft)).toBe(false);
  });

  it("TEAM_LEADER / FINANCE are queue-scoped; PROCUREMENT / ADMIN stay org-wide", () => {
    expect(canViewIndent({ sub: other, role: "TEAM_LEADER" }, draft)).toBe(false);
    expect(canViewIndent({ sub: other, role: "TEAM_LEADER" }, tlPending)).toBe(true);
    expect(canViewIndent({ sub: other, role: "FINANCE" }, draft)).toBe(false);
    expect(canViewIndent({ sub: other, role: "FINANCE" }, financePending)).toBe(true);
    expect(canViewIndent({ sub: other, role: "PROCUREMENT" }, draft)).toBe(true);
    expect(canViewIndent({ sub: other, role: "ADMIN" }, draft)).toBe(true);
  });

  it("list scope scopes REQUESTER / TL / FINANCE; PROCUREMENT and ADMIN are unscoped", () => {
    expect(indentListWhereForRole("REQUESTER", owner)).toEqual({ requesterId: owner });
    expect(indentListWhereForRole("TEAM_LEADER", owner)).toEqual({
      currentStatus: { in: ["PENDING_TL_INDENT", "PENDING_TL_VENDOR"] },
    });
    expect(indentListWhereForRole("FINANCE", owner)).toEqual({
      currentStatus: {
        in: ["PENDING_FINANCE", "PAYMENT_DONE", "PENDING_FINANCE_FINAL"],
      },
    });
    expect(indentListWhereForRole("PROCUREMENT", owner)).toEqual({});
    expect(indentListWhereForRole("ADMIN", owner)).toEqual({});
  });
});

describe("copilot tool × role matrix", () => {
  const EXPECTED_WRITE: Record<string, Role[]> = {
    submit_indent: ["REQUESTER", "ADMIN"],
    create_indent: ["REQUESTER", "ADMIN"],
    update_draft_indent: ["REQUESTER", "ADMIN"],
    mark_quotations_ready: ["PROCUREMENT", "ADMIN"],
    send_rfq: ["PROCUREMENT", "ADMIN"],
    select_vendor: ["PROCUREMENT", "ADMIN"],
    record_approval_decision: ["TEAM_LEADER", "DIRECTOR", "MD"],
    send_to_finance: ["PROCUREMENT", "ADMIN"],
    send_final_invoice_to_finance: ["PROCUREMENT", "ADMIN"],
    complete_finance_final_review: ["FINANCE", "ADMIN"],
    send_purchase_order: ["PROCUREMENT", "ADMIN"],
    sync_gmail: ["PROCUREMENT", "ADMIN"],
    create_vendor: ["PROCUREMENT", "ADMIN"],
    update_vendor: ["PROCUREMENT", "ADMIN"],
    mark_notifications_read: [
      "REQUESTER",
      "TEAM_LEADER",
      "PROCUREMENT",
      "DIRECTOR",
      "MD",
      "FINANCE",
      "ADMIN",
    ],
    complete_payment: ["FINANCE", "ADMIN"],
  };

  it("every registered write tool matches the expected role set exactly", () => {
    const tools = allTools();
    expect(tools.length).toBeGreaterThan(15);
    for (const [name, roles] of Object.entries(EXPECTED_WRITE)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.kind).toBe("write");
      expect([...tool!.allowedRoles].sort()).toEqual([...roles].sort());
    }
  });

  it("no role may see a write tool outside its allow-list", () => {
    for (const role of ROLES) {
      for (const tool of allTools().filter((t) => t.kind === "write")) {
        const allowed = tool.allowedRoles.includes(role);
        const expected = (EXPECTED_WRITE[tool.name] ?? []).includes(role);
        expect(allowed, `${role}→${tool.name}`).toBe(expected);
      }
    }
  });

  it("gmail status and vendor/item masters are role-scoped reads", () => {
    const gmail = allTools().find((t) => t.name === "get_gmail_status");
    expect(gmail?.allowedRoles).toEqual(["PROCUREMENT", "ADMIN"]);
    for (const name of ["list_vendors", "get_vendor", "download_vendor_pdf"]) {
      const tool = allTools().find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect([...tool!.allowedRoles].sort()).toEqual(["ADMIN", "PROCUREMENT"]);
    }
    for (const name of ["list_items", "get_item"]) {
      const tool = allTools().find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect([...tool!.allowedRoles].sort()).toEqual(["ADMIN", "PROCUREMENT", "REQUESTER"]);
    }
    const unrestrictedReads = allTools().filter(
      (t) =>
        t.kind === "read" &&
        ![
          "get_gmail_status",
          "list_vendors",
          "get_vendor",
          "download_vendor_pdf",
          "list_items",
          "get_item",
        ].includes(t.name)
    );
    for (const tool of unrestrictedReads) {
      expect(tool.allowedRoles.length, tool.name).toBe(ROLES.length);
    }
  });

  it("every write tool that requires confirmation has a preview", () => {
    for (const tool of allTools().filter((t) => t.kind === "write" && t.requiresConfirmation)) {
      expect(tool.preview, tool.name).toBeTypeOf("function");
    }
  });

  it("registry never exposes arbitrary SQL / shell tools", () => {
    const names = allTools().map((t) => t.name);
    expect(names).not.toContain("execute_sql");
    expect(names).not.toContain("database");
    expect(names).not.toContain("shell");
  });
});
