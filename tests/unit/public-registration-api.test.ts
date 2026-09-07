import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@/lib/domain-types";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => null),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: () => ({ ok: true }),
  defaultMutateRateLimit: () => ({ limit: 240, windowMs: 60_000 }),
}));

vi.mock("@/lib/idempotency", () => ({
  beginIdempotency: async () => "acquired",
  finishIdempotency: async () => undefined,
  hashRequest: () => "hash",
}));

const registerPublicUser = vi.fn();

vi.mock("@/server/public-registration", async () => {
  const actual = await vi.importActual<typeof import("@/server/public-registration")>(
    "@/server/public-registration"
  );
  return {
    ...actual,
    registerPublicUser: (...args: unknown[]) => registerPublicUser(...args),
  };
});

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    registerPublicUser.mockReset();
  });

  it("rejects ADMIN and never returns password hashes", async () => {
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hacker",
          email: "hacker@test.local",
          username: "hacker",
          password: "StrongPassword12!",
          confirmPassword: "StrongPassword12!",
          role: Role.ADMIN,
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(400);
    expect(registerPublicUser).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/scrypt:|passwordHash/i);
  });

  it("creates an account for an allowlisted role", async () => {
    registerPublicUser.mockResolvedValue({
      id: "u1",
      email: "proc@test.local",
      username: "proc.user",
      name: "Proc User",
      role: Role.PROCUREMENT,
    });
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Proc User",
          email: "proc@test.local",
          username: "proc.user",
          password: "StrongPassword12!",
          confirmPassword: "StrongPassword12!",
          role: Role.PROCUREMENT,
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(200);
    expect(registerPublicUser).toHaveBeenCalledOnce();
    const json = (await res.json()) as {
      ok: boolean;
      user: { role: string; passwordHash?: string };
    };
    expect(json.ok).toBe(true);
    expect(json.user.role).toBe(Role.PROCUREMENT);
    expect(json.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(json)).not.toMatch(/scrypt:|passwordHash/i);
  });
});
