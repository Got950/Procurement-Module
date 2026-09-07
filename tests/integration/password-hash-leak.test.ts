import { describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/password";
import { prisma, query } from "@/lib/db";
import { createIndent, createItem, createUser, describeDb, resetData } from "../helpers/db";

describeDb("user projection / passwordHash leak (SEC-001)", () => {
  it("honors select and never returns passwordHash unless explicitly selected", async () => {
    await resetData();
    const passwordHash = await hashPassword("Correct horse battery staple");
    const userId = await createUser("REQUESTER", "Sec User");
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);

    const projected = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, department: true },
    });
    expect(projected).toMatchObject({
      id: userId,
      name: "Sec User",
      role: "REQUESTER",
    });
    expect(projected).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(projected)).not.toMatch(/scrypt:|passwordHash/i);

    const fullDefault = await prisma.user.findUnique({ where: { id: userId } });
    expect(fullDefault).not.toHaveProperty("passwordHash");

    const withSecret = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    expect(withSecret.passwordHash).toMatch(/^scrypt:/);
  });

  it("strips passwordHash from indent requester includes", async () => {
    await resetData();
    const passwordHash = await hashPassword("Correct horse battery staple");
    const requesterId = await createUser("REQUESTER", "Requester");
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [requesterId, passwordHash]);
    const itemId = await createItem();
    const indentId = await createIndent({ requesterId, itemId, status: "DRAFT" });

    const rows = await prisma.indent.findMany({
      where: { id: indentId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].requester).toMatchObject({
      id: requesterId,
      name: "Requester",
    });
    expect(rows[0].requester).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(rows[0])).not.toMatch(/passwordHash|scrypt:/i);

    const raw = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [requesterId]
    );
    expect(raw.rows[0]?.password_hash).toMatch(/^scrypt:/);
  });
});
