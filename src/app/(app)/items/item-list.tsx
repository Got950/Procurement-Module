"use client";

import { useState } from "react";
import type { Item } from "@/lib/domain-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";

type ItemForm = {
  sku: string;
  name: string;
  category: string;
  uom: string;
  regulatoryTag: string;
  specNotes: string;
};

const emptyForm = (): ItemForm => ({
  sku: "",
  name: "",
  category: "",
  uom: "",
  regulatoryTag: "",
  specNotes: "",
});

export function ItemList({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formValid =
    form.sku.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.category.trim().length > 0 &&
    form.uom.trim().length > 0;

  const filtered = query.trim()
    ? items.filter((it) => {
        const q = query.trim().toLowerCase();
        return (
          it.name.toLowerCase().includes(q) ||
          it.sku.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          (it.regulatoryTag ?? "").toLowerCase().includes(q)
        );
      })
    : items;

  const closeForm = () => {
    setMode("closed");
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setMode("create");
    setError(null);
  };

  const openEdit = (it: Item) => {
    setForm({
      sku: it.sku,
      name: it.name,
      category: it.category,
      uom: it.uom,
      regulatoryTag: it.regulatoryTag ?? "",
      specNotes: it.specNotes ?? "",
    });
    setEditingId(it.id);
    setMode("edit");
    setError(null);
  };

  const refresh = async () => {
    const r = await fetch("/api/items");
    const j = (await r.json()) as { items?: Item[] };
    setItems(j.items ?? []);
  };

  const saveItem = async () => {
    if (!formValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category.trim(),
        uom: form.uom.trim(),
        regulatoryTag: form.regulatoryTag.trim() || null,
        specNotes: form.specNotes.trim() || null,
      };
      const url = mode === "edit" && editingId ? `/api/items/${editingId}` : "/api/items";
      const method = mode === "edit" ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? "Unable to save item.");
        return;
      }
      closeForm();
      router.refresh();
      await refresh();
    } catch {
      setError("Unable to save item. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (it: Item) => {
    if (deletingId) return;
    const ok = window.confirm(`Delete item ${it.sku} (${it.name})? This cannot be undone.`);
    if (!ok) return;
    setDeletingId(it.id);
    setError(null);
    try {
      const r = await fetch(`/api/items/${it.id}`, { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? "Unable to delete item.");
        return;
      }
      if (editingId === it.id) closeForm();
      router.refresh();
      await refresh();
    } catch {
      setError("Unable to delete item. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1 sm:max-w-xs">
          <Label htmlFor="item-client-search" className="sr-only">
            Search items
          </Label>
          <Input
            id="item-client-search"
            type="search"
            placeholder="Search SKU, name, category…"
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
              Add item
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
      {mode !== "closed" ? (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            {mode === "edit" ? "Edit item" : "Add item"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="item-sku">
                SKU <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="item-sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-name">
                Name <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="item-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-category">
                Category <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="item-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-uom">
                UOM <span className="text-[var(--color-danger)]">*</span>
              </Label>
              <Input
                id="item-uom"
                value={form.uom}
                onChange={(e) => setForm({ ...form, uom: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="item-reg">Regulatory tag</Label>
              <Input
                id="item-reg"
                value={form.regulatoryTag}
                onChange={(e) => setForm({ ...form, regulatoryTag: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="item-spec">Spec notes</Label>
              <textarea
                id="item-spec"
                className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                value={form.specNotes}
                onChange={(e) => setForm({ ...form, specNotes: e.target.value })}
              />
            </div>
          </div>
          <Button disabled={!formValid || saving} onClick={() => void saveItem()}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save item"}
          </Button>
        </Card>
      ) : null}

      <div className="app-surface overflow-hidden">
        <div className="divide-y divide-[var(--color-border)] md:hidden">
          {filtered.map((it) => (
            <div key={it.id} className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--color-fg)]">{it.name}</div>
                  <div className="font-mono text-xs text-[var(--color-muted)]">{it.sku}</div>
                </div>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(it)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={deletingId === it.id}
                    onClick={() => void deleteItem(it)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
                <Badge variant="default">{it.category}</Badge>
                <span>{it.uom}</span>
                <span>{it.regulatoryTag ?? "—"}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="app-table w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>UOM</th>
                <th>Regulatory</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono text-xs text-[var(--color-muted)]">{it.sku}</td>
                  <td
                    className="max-w-[240px] truncate font-medium text-[var(--color-fg)]"
                    title={it.name}
                  >
                    {it.name}
                  </td>
                  <td>
                    <Badge variant="default">{it.category}</Badge>
                  </td>
                  <td className="text-[var(--color-muted)]">{it.uom}</td>
                  <td className="text-xs text-[var(--color-muted)]">{it.regulatoryTag ?? "—"}</td>
                  <td className="text-right">
                    <div className="inline-flex gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(it)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deletingId === it.id}
                        onClick={() => void deleteItem(it)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="app-empty">
                      <p className="text-sm font-medium text-[var(--color-fg)]">
                        {items.length === 0 ? "No items yet" : "No items match your search"}
                      </p>
                      <p className="max-w-sm text-sm text-[var(--color-muted)]">
                        {items.length === 0
                          ? "Create catalog items for indents and vendor mapping."
                          : "Try a different search term."}
                      </p>
                      {items.length === 0 && mode === "closed" ? (
                        <Button className="mt-2" onClick={openCreate}>
                          <Plus className="h-3.5 w-3.5" />
                          Add item
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
