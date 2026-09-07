"use client";

import { useState } from "react";
import type { Item, Vendor, VendorItem } from "@/lib/domain-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";

type VWith = Vendor & { vendorItems: (VendorItem & { item: Item })[] };

type VendorForm = {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  city: string;
  gstNumber: string;
  itemIds: string[];
};

const emptyForm = (): VendorForm => ({
  companyName: "",
  contactPerson: "",
  email: "",
  phone: "",
  city: "",
  gstNumber: "",
  itemIds: [],
});

export function VendorList({
  initialVendors,
  items,
}: {
  initialVendors: VWith[];
  items: Item[];
}) {
  const router = useRouter();
  const [vendors, setVendors] = useState(initialVendors);
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<VendorForm>(emptyForm());

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const closeForm = () => {
    setMode("closed");
    resetForm();
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setMode("create");
    setError(null);
  };

  const openEdit = (v: VWith) => {
    setForm({
      companyName: v.companyName,
      contactPerson: v.contactPerson ?? "",
      email: v.email,
      phone: v.phone ?? "",
      city: v.city ?? "",
      gstNumber: v.gstNumber ?? "",
      itemIds: v.vendorItems.map((vi) => vi.item.id),
    });
    setEditingId(v.id);
    setMode("edit");
    setError(null);
  };

  const formValid =
    form.companyName.trim().length > 0 &&
    form.contactPerson.trim().length > 0 &&
    form.email.trim().length > 0;

  const filtered = query.trim()
    ? vendors.filter((v) => {
        const q = query.trim().toLowerCase();
        return (
          v.companyName.toLowerCase().includes(q) ||
          v.email.toLowerCase().includes(q) ||
          (v.contactPerson ?? "").toLowerCase().includes(q) ||
          v.vendorItems.some((vi) => vi.item.name.toLowerCase().includes(q))
        );
      })
    : vendors;

  const refreshList = async () => {
    const list = await fetch("/api/vendors").then((x) => x.json());
    setVendors(list.vendors);
  };

  const saveVendor = async () => {
    if (!formValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        companyName: form.companyName.trim(),
        contactPerson: form.contactPerson.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        gstNumber: form.gstNumber.trim() || null,
        itemIds: form.itemIds,
      };
      const url = mode === "edit" && editingId ? `/api/vendors/${editingId}` : "/api/vendors";
      const method = mode === "edit" ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? "Unable to save vendor.");
        return;
      }
      closeForm();
      router.refresh();
      await refreshList();
    } catch {
      setError("Unable to save vendor. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 sm:max-w-xs">
          <Label htmlFor="vendor-search" className="sr-only">
            Search vendors
          </Label>
          <Input
            id="vendor-search"
            type="search"
            placeholder="Search company, contact, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          onClick={() => (mode === "closed" ? openCreate() : closeForm())}
          variant={mode !== "closed" ? "outline" : "primary"}
        >
          {mode !== "closed" ? (
            "Close form"
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Add vendor
            </>
          )}
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
      {mode !== "closed" && (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            {mode === "edit" ? "Edit vendor" : "Add vendor"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-company">
                Company <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="vendor-company"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                required
                autoComplete="organization"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact">
                Contact <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="vendor-contact"
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                required
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-email">
                Email <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="vendor-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-phone">Phone</Label>
              <Input
                id="vendor-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-city">City</Label>
              <Input
                id="vendor-city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-gst">GST number</Label>
              <Input
                id="vendor-gst"
                value={form.gstNumber}
                onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Supplied items</Label>
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
              {items.map((it) => (
                <label
                  key={it.id}
                  className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-white px-2 py-1 text-xs text-[var(--color-fg)] ring-1 ring-[var(--color-border)]"
                >
                  <input
                    type="checkbox"
                    checked={form.itemIds.includes(it.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        itemIds: e.target.checked
                          ? [...form.itemIds, it.id]
                          : form.itemIds.filter((x) => x !== it.id),
                      })
                    }
                  />
                  {it.name}
                </label>
              ))}
              {items.length === 0 ? (
                <span className="text-xs text-[var(--color-muted)]">No catalog items available.</span>
              ) : null}
            </div>
          </div>
          <Button disabled={!formValid || saving} onClick={() => void saveVendor()}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save vendor"}
          </Button>
        </Card>
      )}
      <div className="app-surface overflow-hidden">
        <div className="divide-y divide-[var(--color-border)] md:hidden">
          {filtered.map((v) => (
            <div key={v.id} className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--color-fg)]">{v.companyName}</div>
                  <div className="text-xs text-[var(--color-muted)]">{v.email}</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(v)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
              <p className="text-sm text-[var(--color-muted)]">{v.contactPerson || "—"}</p>
              <p className="text-xs text-[var(--color-muted)]">
                {v.vendorItems.map((vi) => vi.item.name).join(", ") || "No items mapped"}
              </p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="app-table w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Items</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="font-medium text-[var(--color-fg)]">{v.companyName}</div>
                    <div
                      className="max-w-[240px] truncate text-[12px] text-[var(--color-muted)]"
                      title={v.email}
                    >
                      {v.email}
                    </div>
                  </td>
                  <td className="text-[var(--color-muted)]">{v.contactPerson || "—"}</td>
                  <td
                    className="max-w-[280px] truncate text-[var(--color-muted)]"
                    title={v.vendorItems.map((vi) => vi.item.name).join(", ")}
                  >
                    {v.vendorItems.map((vi) => vi.item.name).join(", ") || "—"}
                  </td>
                  <td className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(v)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="app-empty">
                      <p className="text-sm font-medium text-[var(--color-fg)]">
                        {vendors.length === 0 ? "No vendors yet" : "No vendors match your search"}
                      </p>
                      <p className="max-w-sm text-sm text-[var(--color-muted)]">
                        {vendors.length === 0
                          ? "Create your first vendor to map contacts and supplied items."
                          : "Try a different search term, or clear the search field."}
                      </p>
                      {vendors.length === 0 && mode === "closed" ? (
                        <Button className="mt-2" onClick={openCreate}>
                          <Plus className="h-3.5 w-3.5" />
                          Add vendor
                        </Button>
                      ) : null}
                      {vendors.length > 0 && query.trim() ? (
                        <Button className="mt-2" variant="outline" onClick={() => setQuery("")}>
                          Clear search
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && vendors.length > 0 ? null : null}
        {filtered.length === 0 && vendors.length === 0 ? (
          <div className="app-empty md:hidden">
            <p className="text-sm font-medium text-[var(--color-fg)]">No vendors yet</p>
            <Button className="mt-2" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Add vendor
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
