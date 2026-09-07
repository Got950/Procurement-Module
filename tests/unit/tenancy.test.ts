import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

describe("BUG-049 tenancy architecture", () => {
  it("documents intentional single-tenant design", () => {
    const security = readFileSync(
      path.join(process.cwd(), "docs/architecture/SECURITY.md"),
      "utf8"
    );
    expect(security.toLowerCase()).toMatch(/single-organization|single-tenant|single-org/);
    expect(security).toMatch(/tenant_id/);
  });

  it("schema has no tenant_id column in baseline migrations", () => {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = ["0001_baseline.sql", "0009_sessions_jobs_docs.sql", "0011_copilot.sql"];
    for (const f of files) {
      const p = path.join(migrationsDir, f);
      if (!existsSync(p)) continue;
      const sql = readFileSync(p, "utf8").toLowerCase();
      expect(sql.includes("tenant_id"), f).toBe(false);
    }
  });
});
