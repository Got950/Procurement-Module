import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "fs";
import path from "path";

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("API route wrapping", () => {
  it("every route.ts exports only wrapped handlers", async () => {
    const root = path.join(process.cwd(), "src", "app", "api");
    const files = walk(root);
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const relDir = path.relative(root, path.dirname(file)).replace(/\\/g, "/");
      const importPath = relDir ? `@/app/api/${relDir}/route` : "@/app/api/route";
      const mod = (await import(importPath)) as Record<string, unknown>;
      const handlers = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((k) => k in mod);
      expect(handlers.length, importPath).toBeGreaterThan(0);
      for (const name of handlers) {
        const fn = mod[name] as { __wrapped?: boolean };
        expect(fn.__wrapped, `${importPath} ${name}`).toBe(true);
      }
    }
  });
});
