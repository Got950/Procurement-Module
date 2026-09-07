import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { IndentWorkspace } from "./indent-workspace";

export default async function IndentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const indent = await prisma.indent.findUnique({
    where: { id },
    include: {
      item: true,
      requester: { select: { id: true, name: true, email: true, role: true } },
      stateHistory: { orderBy: { createdAt: "asc" } },
      approvalEvents: { include: { actor: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } },
      documents: { orderBy: { createdAt: "desc" } },
      rfqs: {
        orderBy: { sentAt: "desc" },
        include: { vendors: { include: { vendor: true } } },
      },
      quotations: { include: { vendor: true, document: true } },
      vendorSelection: {
        include: { selectedVendor: true, aiRecommendedVendor: true },
      },
      purchaseOrders: true,
      invoices: true,
      payments: true,
      aiRuns: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  if (!indent || !canViewIndent(session, indent)) notFound();
  const plain = JSON.parse(JSON.stringify(indent)) as unknown;
  return (
    <IndentWorkspace
      indent={plain as never}
      sessionRole={session.role}
      sessionId={session.sub}
    />
  );
}
