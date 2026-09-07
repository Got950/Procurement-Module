import { describe, expect, it } from "vitest";
import { assertSafeOrigin } from "@/lib/csrf";

describe("origin check", () => {
  it("allows GET without Origin", () => {
    expect(assertSafeOrigin(new Request("http://localhost/api/x", { method: "GET" }))).toBe(true);
  });

  it("allows same-origin POST", () => {
    const req = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    });
    expect(assertSafeOrigin(req)).toBe(true);
  });

  it("rejects a cross-site POST", () => {
    const req = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(assertSafeOrigin(req)).toBe(false);
  });
});
