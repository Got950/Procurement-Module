import { describe, expect, it } from "vitest";
import { canManageMasters, canAccessItemCatalog } from "@/lib/rbac/policies";
import { Role } from "@/lib/domain-types";
import { INDENT_PAGE_SIZE, parsePage, paginationHref } from "@/components/app/pagination-controls";
import { systemPrompt, COPILOT_PROMPT_VERSION } from "@/server/copilot/prompt";

describe("P2 remediation helpers", () => {
  it("keeps item write masters restricted to PROCUREMENT/ADMIN", () => {
    expect(canManageMasters(Role.PROCUREMENT)).toBe(true);
    expect(canManageMasters(Role.ADMIN)).toBe(true);
    expect(canManageMasters(Role.REQUESTER)).toBe(false);
    expect(canManageMasters(Role.TEAM_LEADER)).toBe(false);
    expect(canAccessItemCatalog(Role.REQUESTER)).toBe(true);
  });

  it("parses pagination pages safely", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("2")).toBe(2);
    expect(INDENT_PAGE_SIZE).toBeGreaterThan(0);
    expect(paginationHref("/indents", { q: "api" }, 2)).toBe("/indents?q=api&page=2");
    expect(paginationHref("/indents", {}, 1)).toBe("/indents");
  });

  it("prompt documents permission denials and uses v3", () => {
    expect(COPILOT_PROMPT_VERSION).toBe("copilot-system-v3");
    const prompt = systemPrompt({
      id: "u1",
      role: "REQUESTER",
      name: "Test",
    });
    expect(prompt).toMatch(/do not have permission/i);
    expect(prompt).toMatch(/PERMISSIONS/);
  });
});
