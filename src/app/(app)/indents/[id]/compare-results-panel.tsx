"use client";

type QuoteLite = {
  id?: string;
  vendorId: string;
  vendor?: { companyName?: string };
  unitPrice?: string | null;
  leadTimeDays?: number | null;
  summaryText?: string | null;
};

type ScoreRow = { vendorId: string; vendor: string };

function dedupeScoreRows(rows: ScoreRow[]): ScoreRow[] {
  const seen = new Set<string>();
  const out: ScoreRow[] = [];
  for (const r of rows) {
    if (seen.has(r.vendorId)) continue;
    seen.add(r.vendorId);
    out.push(r);
  }
  return out;
}

function normVendor(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function ProcurementCompareView({
  compareResult,
  quotations,
}: {
  compareResult: Record<string, unknown>;
  quotations: QuoteLite[];
}) {
  if (typeof compareResult.apiError === "string") {
    return <p className="text-sm text-black">{compareResult.apiError}</p>;
  }
  if (typeof compareResult.parseError === "string") {
    return <p className="text-sm text-black">{compareResult.parseError}</p>;
  }

  const s = compareResult.suitability;
  const su = s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null;
  const exec = su && typeof su.executiveSummary === "string" ? su.executiveSummary : null;
  const narrative = typeof compareResult.narrative === "string" ? compareResult.narrative : null;
  const aiSummary = exec?.trim() || narrative?.trim() || null;

  const rows = dedupeScoreRows(
    Array.isArray(compareResult.rows) ? (compareResult.rows as ScoreRow[]) : []
  );
  const wMatchId =
    typeof compareResult.winnerVendorIdByRequirementMatch === "string"
      ? compareResult.winnerVendorIdByRequirementMatch
      : null;
  const wMatchPct =
    typeof compareResult.winnerRequirementMatchPercent === "number"
      ? compareResult.winnerRequirementMatchPercent
      : null;
  const winnerName = wMatchId != null ? rows.find((r) => r.vendorId === wMatchId)?.vendor ?? null : null;

  const suitVendors = su && Array.isArray(su.vendors) ? (su.vendors as Record<string, unknown>[]) : [];
  const suitByName = new Map<string, Record<string, unknown>>();
  for (const v of suitVendors) {
    const n = String(v.vendor ?? "");
    if (n) suitByName.set(normVendor(n), v);
  }

  const qByVendor = new Map<string, QuoteLite>();
  for (const q of quotations) {
    const prev = qByVendor.get(q.vendorId);
    if (!prev) {
      qByVendor.set(q.vendorId, q);
      continue;
    }
    const prevScore =
      prev.unitPrice != null && String(prev.unitPrice).trim() ? 1 : 0;
    const nextScore = q.unitPrice != null && String(q.unitPrice).trim() ? 1 : 0;
    if (nextScore >= prevScore) qByVendor.set(q.vendorId, q);
  }

  return (
    <div className="space-y-4">
      {typeof compareResult.suitabilityError === "string" && compareResult.suitabilityError ? (
        <p className="text-xs text-black/80">{compareResult.suitabilityError}</p>
      ) : null}
      {aiSummary ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-black">AI summary</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-black">{aiSummary}</p>
        </div>
      ) : null}
      {winnerName ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-black">Finalized vendor</div>
          <p className="mt-1 text-sm text-black">
            <span className="font-semibold">{winnerName}</span>
            {wMatchPct != null ? (
              <span className="text-black/80">
                {" "}
                · match {wMatchPct}%
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-black/10">
          <table className="w-full min-w-[640px] text-left text-sm text-black">
            <thead className="border-b border-black/10 bg-neutral-100 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">Vendor</th>
                <th className="px-2 py-2">Delivery</th>
                <th className="px-2 py-2">Cost</th>
                <th className="px-2 py-2">Specifications</th>
                <th className="px-2 py-2">Remarks</th>
                <th className="px-2 py-2">Preferred</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rowIndex) => {
                const q = qByVendor.get(r.vendorId);
                const delivery =
                  q?.leadTimeDays != null && q.leadTimeDays !== undefined
                    ? `${q.leadTimeDays} days`
                    : "—";
                const cost = q?.unitPrice != null && String(q.unitPrice).trim() ? String(q.unitPrice) : "—";
                const st = q?.summaryText?.trim();
                const spec =
                  st && st.length > 0
                    ? st.length > 160
                      ? `${st.slice(0, 160)}…`
                      : st
                    : "—";
                const sv = suitByName.get(normVendor(r.vendor));
                const remarks =
                  sv && typeof sv.rationale === "string" && sv.rationale.trim()
                    ? sv.rationale.trim().length > 200
                      ? `${sv.rationale.trim().slice(0, 200)}…`
                      : sv.rationale.trim()
                    : "—";
                const preferred = wMatchId != null && r.vendorId === wMatchId ? "Y" : "N";
                return (
                  <tr key={`${r.vendorId}-${rowIndex}`} className="border-b border-black/5 align-top">
                    <td className="px-2 py-2 font-medium">{r.vendor}</td>
                    <td className="px-2 py-2 text-xs">{delivery}</td>
                    <td className="px-2 py-2 text-xs">{cost}</td>
                    <td className="max-w-[220px] px-2 py-2 text-xs">{spec}</td>
                    <td className="max-w-[220px] px-2 py-2 text-xs">{remarks}</td>
                    <td className="px-2 py-2 font-mono text-xs">{preferred}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function CompareResultsPanel({
  compareResult,
  variant = "full",
  quotations = [],
}: {
  compareResult: Record<string, unknown>;
  variant?: "full" | "procurement";
  quotations?: QuoteLite[];
}) {
  if (variant === "procurement") {
    return <ProcurementCompareView compareResult={compareResult} quotations={quotations} />;
  }

  return (
    <div className="space-y-4 border-t border-black/10 pt-4">
      {typeof compareResult.apiError === "string" ? (
        <p className="text-sm text-black">{compareResult.apiError}</p>
      ) : null}
      {typeof compareResult.parseError === "string" ? (
        <p className="text-sm text-black">{compareResult.parseError}</p>
      ) : null}
      {typeof compareResult.narrative === "string" ? (
        <div className="rounded-lg border border-black/10 bg-neutral-50 p-4 text-sm leading-relaxed text-black">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-black">Score-based narrative</div>
          {compareResult.narrative}
        </div>
      ) : null}
      {typeof compareResult.suitabilityError === "string" && compareResult.suitabilityError ? (
        <p className="text-xs text-black/80">Suitability model: {compareResult.suitabilityError}</p>
      ) : null}
      {(() => {
        const s = compareResult.suitability;
        if (!s || typeof s !== "object" || Array.isArray(s)) return null;
        const su = s as Record<string, unknown>;
        const exec = su.executiveSummary;
        const rec = su.recommendedVendor;
        const oneLine = typeof su.finalSummaryOneLine === "string" ? su.finalSummaryOneLine : null;
        const hiV = typeof su.highestMatchVendor === "string" ? su.highestMatchVendor : null;
        const hiPraw = su.highestMatchPercent;
        const hiP =
          typeof hiPraw === "number"
            ? hiPraw
            : typeof hiPraw === "string"
              ? Number.parseInt(hiPraw, 10)
              : null;
        const vendors = Array.isArray(su.vendors) ? (su.vendors as Record<string, unknown>[]) : [];
        const risks = Array.isArray(su.risks) ? (su.risks as string[]) : [];
        const scoreRows = dedupeScoreRows(
          Array.isArray(compareResult.rows) ? (compareResult.rows as ScoreRow[]) : []
        );
        const wMatchId =
          typeof compareResult.winnerVendorIdByRequirementMatch === "string"
            ? compareResult.winnerVendorIdByRequirementMatch
            : null;
        const wMatchPct =
          typeof compareResult.winnerRequirementMatchPercent === "number"
            ? compareResult.winnerRequirementMatchPercent
            : null;
        const winnerByMatchName =
          wMatchId != null ? scoreRows.find((r) => r.vendorId === wMatchId)?.vendor : null;

        const readPct = (v: Record<string, unknown>): number | null => {
          const n = v.requirementMatchPercent;
          if (typeof n === "number" && Number.isFinite(n)) {
            return Math.min(100, Math.max(0, Math.round(n)));
          }
          if (typeof n === "string") {
            const p = Number.parseFloat(n);
            if (Number.isFinite(p)) return Math.min(100, Math.max(0, Math.round(p)));
          }
          return null;
        };
        const readDim = (ds: unknown, key: string): string => {
          if (!ds || typeof ds !== "object" || Array.isArray(ds)) return "—";
          const x = (ds as Record<string, unknown>)[key];
          if (typeof x === "number" && Number.isFinite(x)) return `${Math.round(x)}%`;
          if (typeof x === "string") {
            const p = Number.parseFloat(x);
            if (Number.isFinite(p)) return `${Math.round(p)}%`;
          }
          return "—";
        };

        return (
          <div className="space-y-4">
            {wMatchPct != null && winnerByMatchName ? (
              <div className="rounded-lg border border-black/10 bg-neutral-50 p-4 text-sm text-black">
                <div className="text-xs font-medium uppercase tracking-wide text-black">
                  Final pick (highest requirement match)
                </div>
                <p className="mt-1 text-base">
                  <span className="font-semibold text-black">{winnerByMatchName}</span>
                  <span className="text-black/50"> · </span>
                  <span className="font-mono text-lg text-black">{wMatchPct}%</span>
                  <span className="text-black/70"> match</span>
                </p>
                {hiV && hiP != null && Number.isFinite(hiP) ? (
                  <p className="mt-1 text-xs text-black/75">
                    AI headline: {hiV} at {hiP}%
                  </p>
                ) : null}
                {oneLine ? (
                  <p className="mt-2 border-t border-black/10 pt-2 text-black/85">{oneLine}</p>
                ) : null}
              </div>
            ) : null}
            {typeof exec === "string" && exec ? (
              <div className="rounded-lg border border-black/10 bg-neutral-50 p-4 text-sm leading-relaxed text-black">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-black">
                  Executive summary (requirements vs quotes)
                </div>
                {exec}
              </div>
            ) : null}
            {typeof rec === "string" && rec ? (
              <p className="text-sm text-black">
                <span className="text-black/70">AI recommended vendor:</span>{" "}
                <span className="font-semibold text-black">{rec}</span>
              </p>
            ) : null}
            {vendors.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-black/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-black/10 bg-neutral-100 text-xs uppercase tracking-wide text-black">
                    <tr>
                      <th className="px-3 py-2">Vendor</th>
                      <th className="px-3 py-2">Match</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Delivery</th>
                      <th className="px-3 py-2">Specs</th>
                      <th className="px-3 py-2">Fit</th>
                      <th className="px-3 py-2">OK?</th>
                      <th className="px-3 py-2">Rationale</th>
                      <th className="px-3 py-2">Gaps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v, i) => {
                      const name = String(v.vendor ?? "—");
                      const fit = String(v.fit ?? "—");
                      const suitable = Boolean(v.suitable);
                      const rationale = String(v.rationale ?? "");
                      const gaps = Array.isArray(v.gapsVsRequirements) ? (v.gapsVsRequirements as string[]) : [];
                      const pct = readPct(v);
                      const ds = v.dimensionScores;
                      const rowVid = scoreRows.find(
                        (r) => r.vendor.trim().toLowerCase() === name.trim().toLowerCase()
                      )?.vendorId;
                      const isTopMatch = wMatchId != null && rowVid != null && rowVid === wMatchId;
                      return (
                        <tr
                          key={`${name}-${i}`}
                          className={
                            isTopMatch
                              ? "border-b border-black/5 bg-neutral-100 align-top"
                              : "border-b border-black/5 align-top"
                          }
                        >
                          <td className="px-3 py-2 font-medium text-black">{name}</td>
                          <td className="px-3 py-2 font-mono text-black">{pct != null ? `${pct}%` : "—"}</td>
                          <td className="px-3 py-2 text-xs text-black/75">{readDim(ds, "priceAlignment")}</td>
                          <td className="px-3 py-2 text-xs text-black/75">{readDim(ds, "deliveryAlignment")}</td>
                          <td className="px-3 py-2 text-xs text-black/75">{readDim(ds, "specificationsAlignment")}</td>
                          <td className="px-3 py-2 text-black">{fit}</td>
                          <td className="px-3 py-2">
                            <span className={suitable ? "text-black" : "text-black/80"}>
                              {suitable ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="max-w-[200px] px-3 py-2 text-xs text-black/75">{rationale}</td>
                          <td className="max-w-[180px] px-3 py-2 text-xs text-black/70">
                            {gaps.length ? (
                              <ul className="list-inside list-disc space-y-0.5">
                                {gaps.map((g, gi) => (
                                  <li key={gi}>{g}</li>
                                ))}
                              </ul>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {risks.length > 0 ? (
              <div className="rounded-lg border border-black/10 bg-amber-50 p-3 text-xs text-black">
                <div className="mb-1 font-medium uppercase tracking-wide text-black">Risks</div>
                <ul className="list-inside list-disc space-y-1">
                  {risks.map((r, ri) => (
                    <li key={ri}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })()}
      <details className="text-xs text-black/70">
        <summary className="cursor-pointer text-black">Raw API response</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-black/10 bg-neutral-100 p-3 text-[11px] text-black">
          {JSON.stringify(compareResult, null, 2)}
        </pre>
      </details>
    </div>
  );
}
