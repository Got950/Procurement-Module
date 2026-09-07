import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma, query } from "@/lib/db";
import { NewIndentForm } from "./new-indent-form";
import { computeNextIndentReference } from "@/lib/indent-reference";
import { PageHeader } from "@/components/app/page-header";

export default async function NewIndentPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "REQUESTER" && session.role !== "ADMIN") {
    redirect("/indents");
  }
  const items = await prisma.item.findMany({ orderBy: { name: "asc" } });
  const counter = await query<{ last_value: number }>(
    "SELECT last_value FROM indent_reference_counters WHERE year = $1",
    [new Date().getFullYear()]
  );
  const previewReference = computeNextIndentReference(counter.rows[0]?.last_value ?? 0);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Raise indent"
        description="Structured procurement request with enterprise document layout."
      />
      <NewIndentForm items={items} requesterName={session.name} previewReference={previewReference} />
    </div>
  );
}
