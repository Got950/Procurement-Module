import { beforeEach, expect, it, vi } from "vitest";
import {
  createDocument,
  createIndent,
  createItem,
  createUser,
  describeDb,
  resetData,
} from "../helpers/db";
import { prisma } from "@/lib/db";
import { IndentStatus } from "@/lib/domain-types";
import { canViewIndent, indentListWhere } from "@/lib/indent-access";
import { loadAuthorizedDocument, loadAuthorizedIndent } from "@/server/copilot/access";
import { NotFoundError } from "@/lib/errors";
import { redactIndentBankFields } from "@/lib/api-sanitize";

/**
 * Cross-user indent visibility: dashboard "Recent indents", list APIs, detail
 * IDOR, and document access must all honor indentListWhere / canViewIndent.
 */
describeDb("indent visibility / cross-user data leak", () => {
  let requesterA: string;
  let requesterB: string;
  let teamLeader: string;
  let finance: string;
  let procurement: string;
  let admin: string;
  let itemId: string;
  let indentA: string;

  beforeEach(async () => {
    await resetData();
    requesterA = await createUser("REQUESTER", "Ananya Mehta");
    requesterB = await createUser("REQUESTER", "New User B");
    teamLeader = await createUser("TEAM_LEADER", "New Team Lead");
    finance = await createUser("FINANCE", "New Finance");
    procurement = await createUser("PROCUREMENT", "Procurement");
    admin = await createUser("ADMIN", "Admin");
    itemId = await createItem();
    indentA = await createIndent({
      requesterId: requesterA,
      itemId,
      status: IndentStatus.DRAFT,
    });
  });

  /** Same query shape as dashboard "Recent indents". */
  async function recentFor(role: string, userId: string) {
    return prisma.indent.findMany({
      where: indentListWhere(role, userId),
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: { id: true, reference: true, requesterId: true },
    });
  }

  it("CASE 1+5: newly created requester cannot see another user's recent indents", async () => {
    const recent = await recentFor("REQUESTER", requesterB);
    expect(recent.map((r) => r.id)).not.toContain(indentA);
    expect(recent).toHaveLength(0);
  });

  it("CASE 2: owning requester still sees their own indent", async () => {
    const recent = await recentFor("REQUESTER", requesterA);
    expect(recent.map((r) => r.id)).toContain(indentA);
  });

  it("CASE 3+6: authorized workflow roles see only in-scope indents; admin/procurement stay org-wide", async () => {
    const tlPending = await createIndent({
      requesterId: requesterA,
      itemId,
      status: IndentStatus.PENDING_TL_INDENT,
    });
    const financePending = await createIndent({
      requesterId: requesterA,
      itemId,
      status: IndentStatus.PENDING_FINANCE,
    });

    const tlRecent = await recentFor("TEAM_LEADER", teamLeader);
    expect(tlRecent.map((r) => r.id)).toContain(tlPending);
    expect(tlRecent.map((r) => r.id)).not.toContain(indentA);

    const finRecent = await recentFor("FINANCE", finance);
    expect(finRecent.map((r) => r.id)).toContain(financePending);
    expect(finRecent.map((r) => r.id)).not.toContain(indentA);

    const procRecent = await recentFor("PROCUREMENT", procurement);
    expect(procRecent.map((r) => r.id)).toEqual(
      expect.arrayContaining([indentA, tlPending, financePending])
    );

    const adminRecent = await recentFor("ADMIN", admin);
    expect(adminRecent.map((r) => r.id)).toEqual(
      expect.arrayContaining([indentA, tlPending, financePending])
    );
  });

  it("CASE 4: changing indent id does not bypass authorization for requester / TL / finance", async () => {
    const draft = {
      requesterId: requesterA,
      currentStatus: IndentStatus.DRAFT,
    };
    expect(canViewIndent({ sub: requesterB, role: "REQUESTER" }, draft)).toBe(false);
    expect(canViewIndent({ sub: teamLeader, role: "TEAM_LEADER" }, draft)).toBe(false);
    expect(canViewIndent({ sub: finance, role: "FINANCE" }, draft)).toBe(false);

    await expect(
      loadAuthorizedIndent(
        { actor: { id: requesterB, role: "REQUESTER", name: "B" }, conversationId: "c", correlationId: "x" },
        indentA
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      loadAuthorizedIndent(
        { actor: { id: teamLeader, role: "TEAM_LEADER", name: "TL" }, conversationId: "c", correlationId: "x" },
        indentA
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("GET /api/indents returns only authorized records for requester B", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async () => ({
        sub: requesterB,
        role: "REQUESTER",
        name: "New User B",
        jti: "jti-b",
      })),
    }));
    vi.doMock("@/lib/rate-limit", () => ({
      consumeRateLimit: () => ({ ok: true }),
      defaultMutateRateLimit: () => ({ limit: 240, windowMs: 60_000 }),
    }));
    vi.doMock("@/lib/idempotency", () => ({
      beginIdempotency: async () => "acquired",
      finishIdempotency: async () => undefined,
      hashRequest: () => "hash",
    }));

    const { GET } = await import("@/app/api/indents/route");
    const res = await GET(new Request("http://localhost/api/indents"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      indents: Array<{ id: string; requesterId?: string }>;
    };
    expect(body.indents.map((i) => i.id)).not.toContain(indentA);
    expect(body.indents).toHaveLength(0);
  });

  it("GET /api/indents/[id] returns 404 for unauthorized requester", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({
      getSession: vi.fn(async () => ({
        sub: requesterB,
        role: "REQUESTER",
        name: "New User B",
        jti: "jti-b",
      })),
    }));
    vi.doMock("@/lib/rate-limit", () => ({
      consumeRateLimit: () => ({ ok: true }),
      defaultMutateRateLimit: () => ({ limit: 240, windowMs: 60_000 }),
    }));
    vi.doMock("@/lib/idempotency", () => ({
      beginIdempotency: async () => "acquired",
      finishIdempotency: async () => undefined,
      hashRequest: () => "hash",
    }));

    const { GET } = await import("@/app/api/indents/[id]/route");
    const res = await GET(new Request(`http://localhost/api/indents/${indentA}`), {
      params: Promise.resolve({ id: indentA }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("justification");
    expect(serialized).not.toContain("Ananya");
  });

  it("CASE 7: unauthorized document access for another user's indent is blocked", async () => {
    const docId = await createDocument(indentA, "proof");
    await expect(
      loadAuthorizedDocument(
        {
          actor: { id: requesterB, role: "REQUESTER", name: "B" },
          conversationId: "c",
          correlationId: "x",
        },
        docId
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      loadAuthorizedDocument(
        {
          actor: { id: teamLeader, role: "TEAM_LEADER", name: "TL" },
          conversationId: "c",
          correlationId: "x",
        },
        docId
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("CASE 8: bank fields stay redacted for non-finance roles on authorized reads", async () => {
    const indent = await prisma.indent.findUnique({ where: { id: indentA } });
    expect(indent).toBeTruthy();
    const payload = {
      ...indent!,
      financeAccountNo: "1234567890",
      financeIfscCode: "HDFC0001",
    } as Record<string, unknown>;
    const forRequester = redactIndentBankFields(payload, "REQUESTER");
    expect(forRequester.financeAccountNo).toBeNull();
    expect(forRequester.financeIfscCode).toBeNull();

    const forFinance = redactIndentBankFields(payload, "FINANCE");
    expect(forFinance.financeAccountNo).toBe("1234567890");
  });
});
