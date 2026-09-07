import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { PageHeader } from "@/components/app/page-header";
import { VendorList } from "./vendor-list";

export default async function VendorsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== Role.PROCUREMENT && session.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  const vendors = await prisma.vendor.findMany({
    include: { vendorItems: { include: { item: true } } },
    orderBy: { companyName: "asc" },
  });
  const items = await prisma.item.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor master"
        description="Compliance, contacts, and item mappings."
      />
      <VendorList initialVendors={JSON.parse(JSON.stringify(vendors))} items={JSON.parse(JSON.stringify(items))} />
    </div>
  );
}
