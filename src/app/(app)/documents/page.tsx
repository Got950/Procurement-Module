import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { indentListWhere } from "@/lib/indent-access";
import { PageHeader } from "@/components/app/page-header";

export default async function DocumentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== Role.PROCUREMENT && session.role !== Role.FINANCE && session.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  const indentScope = indentListWhere(session.role, session.sub);
  const orgWide = Object.keys(indentScope).length === 0;
  let documentWhere: Record<string, unknown> = {};
  if (!orgWide) {
    const visible = await prisma.indent.findMany({
      where: indentScope,
      select: { id: true },
    });
    const indentIds = visible.map((i) => i.id);
    documentWhere = indentIds.length
      ? { indentId: { in: indentIds } }
      : { id: "__none__" };
  }
  const docs = await prisma.document.findMany({
    where: documentWhere,
    orderBy: { createdAt: "desc" },
    take: 80,
    include: { indent: { select: { reference: true, id: true } } },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Document center"
        description="Versioned files linked to indents."
      />
      <div className="app-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="app-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Indent</th>
                <th className="text-right">Created</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="max-w-[220px] truncate font-medium text-[var(--color-fg)]" title={d.filename}>
                    {d.filename}
                  </td>
                  <td className="text-[var(--color-muted)]">
                    {d.type} · v{d.version}
                  </td>
                  <td>
                    {d.indent ? (
                      <Link
                        href={`/indents/${d.indent.id}`}
                        className="font-medium text-[var(--color-accent)] hover:underline"
                      >
                        {d.indent.reference}
                      </Link>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="text-right text-xs text-[var(--color-muted)]">
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td className="text-right">
                    <a
                      href={`/api/documents/${d.id}/file`}
                      className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {docs.length === 0 && (
          <div className="app-empty">
            <p className="text-sm font-medium text-[var(--color-fg)]">No documents yet</p>
            <p className="max-w-sm text-sm text-[var(--color-muted)]">
              Files uploaded on indent cases will be listed here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
