import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { PageHeader } from "@/components/app/page-header";
import { ItemList } from "./item-list";

export default async function ItemsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== Role.PROCUREMENT && session.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  const items = await prisma.item.findMany({
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Item master"
        description="Pharma catalog for indents and vendor mapping."
      />
      <ItemList initialItems={items} />
    </div>
  );
}
