import type { Item, Quotation, Vendor } from "@/lib/domain-types";

export const DEFAULT_WEIGHTS = {
  spec: 0.3,
  price: 0.25,
  delivery: 0.15,
  payment: 0.1,
  compliance: 0.1,
  rating: 0.1,
} as const;

export type ScoreBreakdown = {
  spec: number;
  price: number;
  delivery: number;
  payment: number;
  compliance: number;
  rating: number;
  total: number;
  explain: string[];
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reference price: lowest unit price among quotes for normalization. */
export function scoreQuotation(
  q: Quotation,
  vendor: Vendor,
  item: Item,
  referenceLowPrice: number | null
): ScoreBreakdown {
  const explain: string[] = [];
  const raw = (q.rawExtractionJson as Record<string, unknown> | null) ?? {};
  const unitPrice = q.unitPrice ? Number(q.unitPrice) : num(raw.unitPrice);
  const lead = q.leadTimeDays ?? num(raw.leadTimeDays);
  const pay = (q.paymentTerms ?? (raw.paymentTerms as string)) || vendor.paymentTerms;

  // Spec match heuristic: fewer deviations -> higher score
  const devs = (raw.deviations as string[] | undefined) ?? (q.deviations as string[] | null) ?? [];
  const spec = Math.max(0, 1 - Math.min(1, devs.length * 0.15));
  if (devs.length) explain.push(`${devs.length} spec deviation(s) noted.`);

  // Price: lower is better vs reference
  let price = 0.7;
  if (unitPrice != null && referenceLowPrice != null && referenceLowPrice > 0) {
    const ratio = unitPrice / referenceLowPrice;
    price = Math.max(0, Math.min(1, 2 - ratio));
    explain.push(`Price ratio vs best: ${ratio.toFixed(2)}.`);
  } else {
    explain.push("Price incomplete — neutral score.");
  }

  // Delivery: assume 21 days baseline
  let delivery = 0.7;
  if (lead != null) {
    delivery = Math.max(0, Math.min(1, 1 - Math.max(0, lead - 7) / 45));
    explain.push(`Lead time ${lead} days.`);
  } else explain.push("Lead time unknown.");

  // Payment terms: shorter / Net 30 baseline
  let payment = 0.75;
  if (/net\s*15/i.test(pay)) payment = 1;
  else if (/net\s*30/i.test(pay)) payment = 0.85;
  else if (/advance/i.test(pay)) payment = 0.6;
  explain.push(`Payment: ${pay}.`);

  const certs = (raw.certifications as string[] | undefined) ?? [];
  const compliance = Math.min(1, 0.5 + certs.length * 0.15);
  if (certs.length) explain.push(`${certs.length} certification(s) listed.`);

  const rating = Math.max(0, Math.min(1, vendor.rating / 5));

  const w = DEFAULT_WEIGHTS;
  const total =
    spec * w.spec +
    price * w.price +
    delivery * w.delivery +
    payment * w.payment +
    compliance * w.compliance +
    rating * w.rating;

  return {
    spec,
    price,
    delivery,
    payment,
    compliance,
    rating,
    total,
    explain,
  };
}

export function pickBestVendor(
  scored: { vendorId: string; total: number }[]
): string | null {
  if (!scored.length) return null;
  return scored.reduce((a, b) => (b.total > a.total ? b : a)).vendorId;
}
