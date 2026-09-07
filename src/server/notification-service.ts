import type { NotificationType } from "@/lib/domain-types";
import { prisma } from "@/lib/db";

export async function notifyUsers(
  userIds: string[],
  n: {
    type: NotificationType;
    title: string;
    body: string;
    indentId?: string | null;
    /** Opens in a new tab (e.g. Gmail thread URL). */
    actionUrl?: string | null;
  }
) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;
  await prisma.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      indentId: n.indentId ?? undefined,
      actionUrl: n.actionUrl ?? undefined,
    })),
  });
}
