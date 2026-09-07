"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Role, DocumentType, type Role as RoleType } from "@/lib/domain-types";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { CompareResultsPanel } from "./compare-results-panel";
import { WorkflowTimeline } from "@/components/procurement/workflow-timeline";
import { DocumentSection } from "@/components/procurement/document-section";
import { ProcurementDocumentFrame } from "@/components/procurement/procurement-document-frame";
import {
  getWorkflowTrackerIndex,
  getWorkflowTrackerSteps,
  hasPassedProcurementStart,
  showEarlyExitRejectedIndent,
} from "@/lib/procurement-workflow-ui";
import {
  budgetTrackLabel,
  getIndentBudgetTrack,
  requiresMdApproval,
  resolveIndentBudgetAmount,
} from "@/lib/budget-approval";
import { formatStableDateTime } from "@/lib/format-date";

type VendorLite = { id: string; companyName: string; email: string };

type VendorGmailReply = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  internalMs: number;
  gmailUrl: string;
  attachments: { filename: string; mimeType: string; size: number; downloadHref: string }[];
};
type QRow = {
  id: string;
  vendorId: string;
  vendor: VendorLite;
  unitPrice: string | null;
  leadTimeDays: number | null;
  summaryText: string | null;
  aiScoresJson: unknown;
  rawExtractionJson?: unknown;
  document?: { id: string; filename: string; mimeType: string; storagePath: string } | null;
};

type IndentDetail = {
  id: string;
  reference: string;
  createdAt?: string;
  currentStatus: string;
  justification: string;
  priority: string;
  quantity: string;
  rejectionReason: string | null;
  approvalBudgetAmount: string | null;
  procurementCostCommercial: string | null;
  procurementDeliveryExpectations: string | null;
  procurementSpecifications: string | null;
  item: { id: string; name: string; sku: string; uom: string; category: string; specNotes?: string | null };
  requester: { id: string; name: string };
  stateHistory: { toStatus: string; createdAt: string; note: string | null }[];
  approvalEvents: {
    stage: string;
    decision: string;
    remarks: string;
    createdAt: string;
    actor: { name: string; role: string };
  }[];
  documents: { id: string; filename: string; type: string; createdAt: string }[];
  rfqs: {
    id: string;
    subject: string;
    bodyTemplate?: string | null;
    sentAt: string | null;
    vendors: { vendor: VendorLite }[];
  }[];
  quotations: QRow[];
  vendorSelection: {
    selectedVendorId: string;
    aiRecommendedVendorId: string | null;
    overrideReason: string | null;
    submittedAt: string | null;
    selectedVendor: VendorLite;
    aiRecommendedVendor: VendorLite | null;
  } | null;
  purchaseOrders: { id: string; poNumber: string; sentAt: string | null; bodyHtml: string }[];
  invoices: {
    id: string;
    vendorName: string;
    amount: string | null;
    kind?: string | null;
    createdAt?: string;
    purchaseOrderId?: string | null;
    documentId?: string | null;
  }[];
  payments: { id: string; status: string; paidAt: string | null; vendorProofSentAt: string | null }[];
  aiRuns: { id: string; resultsJson: unknown; createdAt: string }[];
  financeBudgetAllocation?: string | null;
  financeBudgetUtilized?: string | null;
  financeAvailableBalance?: string | null;
  financeFundsAvailable?: string | null;
  financeAccountNo?: string | null;
  financeIfscCode?: string | null;
  financeBranchName?: string | null;
  financeAccountHolderName?: string | null;
  financeRemarks?: string | null;
  financeCompletedAt?: string | null;
};

function invoiceKind(inv: { kind?: string | null }): "PROFORMA" | "FINAL" {
  return inv.kind === "FINAL" ? "FINAL" : "PROFORMA";
}

function getProformaInvoice(invoices: IndentDetail["invoices"]) {
  const list = invoices.filter((i) => invoiceKind(i) === "PROFORMA");
  return [...list].sort((a, b) => (String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1))[0];
}

function getFinalInvoice(invoices: IndentDetail["invoices"]) {
  const list = invoices.filter((i) => invoiceKind(i) === "FINAL");
  return [...list].sort((a, b) => (String(a.createdAt ?? "") < String(b.createdAt ?? "") ? 1 : -1))[0];
}

function formatAttachmentSize(bytes: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** null clears the stored amount; undefined means the entry is not a usable number. */
function parseApprovalAmount(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normVendorName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function findSuitabilityVendorRow(
  suitability: unknown,
  companyName: string
): Record<string, unknown> | null {
  if (!suitability || typeof suitability !== "object" || Array.isArray(suitability)) return null;
  const vendors = (suitability as Record<string, unknown>).vendors;
  if (!Array.isArray(vendors)) return null;
  const target = normVendorName(companyName);
  for (const raw of vendors) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const v = raw as Record<string, unknown>;
    const name = String(v.vendor ?? "").trim();
    if (normVendorName(name) === target) return v;
  }
  return null;
}

function readRequirementMatchPct(v: Record<string, unknown>): number | null {
  const n = v.requirementMatchPercent;
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  if (typeof n === "string") {
    const p = Number.parseFloat(n);
    if (Number.isFinite(p)) return Math.min(100, Math.max(0, Math.round(p)));
  }
  return null;
}

function formatDimScore(ds: unknown, key: string): string {
  if (!ds || typeof ds !== "object" || Array.isArray(ds)) return "—";
  const x = (ds as Record<string, unknown>)[key];
  if (typeof x === "number" && Number.isFinite(x)) return `${Math.round(x)}%`;
  if (typeof x === "string") {
    const p = Number.parseFloat(x);
    if (Number.isFinite(p)) return `${Math.round(p)}%`;
  }
  return "—";
}

/** Read-only vendor + AI summary for everyone except the Procurement role (TL, Director, Finance, Requester, Admin). */
function ProcurementVendorChoiceBrief({
  vendorSelection,
  quotations,
  latestRun,
}: {
  vendorSelection: NonNullable<IndentDetail["vendorSelection"]>;
  quotations: QRow[];
  latestRun: { resultsJson: unknown; createdAt: string } | undefined;
}) {
  const sel = vendorSelection.selectedVendor;
  const aiRec = vendorSelection.aiRecommendedVendor;
  const overridden =
    vendorSelection.aiRecommendedVendorId != null &&
    vendorSelection.aiRecommendedVendorId !== vendorSelection.selectedVendorId;

  const results =
    latestRun?.resultsJson && typeof latestRun.resultsJson === "object" && !Array.isArray(latestRun.resultsJson)
      ? (latestRun.resultsJson as Record<string, unknown>)
      : null;
  const suitability = results?.suitability;
  const suitabilityError =
    typeof results?.suitabilityError === "string" ? results.suitabilityError : null;
  const suObj =
    suitability && typeof suitability === "object" && !Array.isArray(suitability)
      ? (suitability as Record<string, unknown>)
      : null;
  const executiveSummary = typeof suObj?.executiveSummary === "string" ? suObj.executiveSummary : null;
  const row = findSuitabilityVendorRow(suitability, sel.companyName);
  const quoteRow = quotations.find((q) => q.vendorId === vendorSelection.selectedVendorId);
  const extractSummary = quoteRow?.summaryText?.trim() || null;

  const matchPct = row ? readRequirementMatchPct(row) : null;
  const rationale = row && typeof row.rationale === "string" ? row.rationale : null;
  const fit = row && typeof row.fit === "string" ? row.fit : null;
  const suitable = row ? Boolean(row.suitable) : null;
  const gaps = row && Array.isArray(row.gapsVsRequirements) ? (row.gapsVsRequirements as string[]) : [];
  const priceC = row && typeof row.priceComment === "string" ? row.priceComment : null;
  const delC = row && typeof row.deliveryComplianceComment === "string" ? row.deliveryComplianceComment : null;
  const ds = row?.dimensionScores;

  return (
    <Card className="space-y-4 border border-black/10 bg-neutral-50 p-5">
      <div>
        <CardTitle className="text-base text-black">Procurement&apos;s vendor choice</CardTitle>
        <CardDescription className="mt-1 text-black/75">
          Vendor procurement put forward for approval and downstream steps. AI text comes from the latest quote
          comparison run on this indent.
        </CardDescription>
      </div>
      <div className="rounded-lg border border-black/10 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-black">Selected vendor</div>
        <p className="mt-1 text-lg font-semibold text-black">{sel.companyName}</p>
        {vendorSelection.submittedAt ? (
          <p className="mt-1 text-xs text-black/70">
            Submitted {formatStableDateTime(vendorSelection.submittedAt)}
          </p>
        ) : null}
      </div>
      {aiRec ? (
        <div className="rounded-lg border border-black/10 bg-white p-3 text-sm text-black">
          <span className="text-black/70">AI top match (by score / suitability workflow): </span>
          <span className="font-medium text-black">{aiRec.companyName}</span>
          {overridden ? (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-black">
              Different from procurement pick
            </span>
          ) : (
            <span className="ml-2 text-xs text-black/80">Matches procurement pick</span>
          )}
        </div>
      ) : null}
      {overridden && vendorSelection.overrideReason?.trim() ? (
        <div className="rounded-lg border border-black/10 bg-amber-50 p-3 text-sm text-black">
          <div className="text-xs font-medium uppercase tracking-wide text-black">Override reason</div>
          <p className="mt-1 whitespace-pre-wrap">{vendorSelection.overrideReason}</p>
        </div>
      ) : null}
      {latestRun ? (
        <p className="text-xs text-black/70">Latest AI comparison: {formatStableDateTime(latestRun.createdAt)}</p>
      ) : (
        <p className="text-xs text-black/80">No AI comparison run is stored on this indent yet.</p>
      )}
      {suitabilityError ? (
        <p className="text-xs text-black/80">Suitability model note: {suitabilityError}</p>
      ) : null}
      {executiveSummary ? (
        <div className="rounded-lg border border-black/10 bg-white p-4 text-sm leading-relaxed text-black">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-black">
            Executive summary (all quotes vs requirements)
          </div>
          {executiveSummary}
        </div>
      ) : null}
      {row ? (
        <div className="space-y-3 rounded-lg border border-black/10 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-black">
            AI assessment · {sel.companyName}
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-black">
            {matchPct != null ? (
              <span>
                Requirement match: <span className="font-mono">{matchPct}%</span>
              </span>
            ) : null}
            {fit ? (
              <span>
                Fit: <span className="font-medium">{fit}</span>
              </span>
            ) : null}
            {suitable != null ? (
              <span className="text-black">
                Suitable (AI): {suitable ? "Yes" : "No"}
              </span>
            ) : null}
          </div>
          <div className="grid gap-2 text-xs text-black/75 sm:grid-cols-3">
            <div>Cost alignment: {formatDimScore(ds, "priceAlignment")}</div>
            <div>Delivery alignment: {formatDimScore(ds, "deliveryAlignment")}</div>
            <div>Specs alignment: {formatDimScore(ds, "specificationsAlignment")}</div>
          </div>
          {rationale ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-black">Rationale</div>
              <p className="mt-1 text-sm leading-relaxed text-black/90">{rationale}</p>
            </div>
          ) : null}
          {gaps.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-black">Gaps vs requirements</div>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-black/85">
                {gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(priceC || delC) && (
            <div className="space-y-1 border-t border-black/10 pt-3 text-xs text-black/75">
              {priceC ? <p>Price: {priceC}</p> : null}
              {delC ? <p>Delivery: {delC}</p> : null}
            </div>
          )}
        </div>
      ) : latestRun && !suitabilityError ? (
        <p className="text-sm text-black/75">
          No per-vendor suitability row matched &quot;{sel.companyName}&quot;. Check that the latest compare run used
          the same vendor name, or rely on the extraction summary below.
        </p>
      ) : null}
      {extractSummary ? (
        <div className="rounded-lg border border-black/10 bg-white p-4 text-sm">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-black">
            AI extract summary (from quotation file)
          </div>
          <p className="leading-relaxed text-black/90">{extractSummary}</p>
        </div>
      ) : !row ? (
        <p className="text-sm text-black/75">No stored extraction summary for this vendor&apos;s quotation row.</p>
      ) : null}
    </Card>
  );
}

export function IndentWorkspace({
  indent: initial,
  sessionRole,
  sessionId,
}: {
  indent: IndentDetail;
  sessionRole: RoleType;
  sessionId: string;
}) {
  const router = useRouter();
  const [indent, setIndent] = useState(initial);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/indents/${indent.id}`);
      const text = await r.text();
      if (!text) return;
      const j = JSON.parse(text) as { indent?: unknown };
      if (j.indent) setIndent(JSON.parse(JSON.stringify(j.indent)));
      router.refresh();
    } catch {
      /* ignore bad JSON / network */
    }
  }, [indent.id, router]);

  // Procurement/finance tools: ADMIN may operate. Approval decisions: exact role only (SoD).
  const isProc = sessionRole === Role.PROCUREMENT || sessionRole === Role.ADMIN;
  const isTL = sessionRole === Role.TEAM_LEADER;
  const isDir = sessionRole === Role.DIRECTOR;
  const isMd = sessionRole === Role.MD;
  const isFin = sessionRole === Role.FINANCE || sessionRole === Role.ADMIN;
  /** After procurement submits a vendor, all non-procurement roles see the same brief (Director, Finance, Requester, TL, Admin). */
  const showVendorChoiceReadOnly =
    indent.vendorSelection != null && sessionRole !== Role.PROCUREMENT;

  const [remarks, setRemarks] = useState("");
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [rfqSubject, setRfqSubject] = useState(`RFQ ${indent.reference}`);
  const [rfqBody, setRfqBody] = useState(
    "Dear {{company_name}},\n\nPlease provide your best quotation including lead time, MOQ, and certifications.\n\nRegards,\nProcurement"
  );
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [compareResult, setCompareResult] = useState<Record<string, unknown> | null>(null);
  const [poHtml, setPoHtml] = useState("");
  const [poGenMsg, setPoGenMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const poUploadInputRef = useRef<HTMLInputElement>(null);
  const [poId, setPoId] = useState("");
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [rfqFeedback, setRfqFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sendingRfq, setSendingRfq] = useState(false);
  const [extractingQid, setExtractingQid] = useState<string | null>(null);
  const [extractFeedback, setExtractFeedback] = useState<string | null>(null);
  const [vendorReplies, setVendorReplies] = useState<VendorGmailReply[]>([]);
  const [vendorRepliesLoading, setVendorRepliesLoading] = useState(false);
  const [vendorRepliesError, setVendorRepliesError] = useState<string | null>(null);
  const [gmailInboxConnected, setGmailInboxConnected] = useState<string | null>(null);
  const [compareRequirements, setCompareRequirements] = useState("");
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareCostReq, setCompareCostReq] = useState("");
  const [approvalAmountInput, setApprovalAmountInput] = useState("");
  const [compareDeliveryReq, setCompareDeliveryReq] = useState("");
  const [compareSpecReq, setCompareSpecReq] = useState("");
  const [textOnlyVendorId, setTextOnlyVendorId] = useState("");
  const [textOnlyBody, setTextOnlyBody] = useState("");
  const [textOnlySaving, setTextOnlySaving] = useState(false);
  const [textOnlyFeedback, setTextOnlyFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [sendFinanceFeedback, setSendFinanceFeedback] = useState<string | null>(null);
  const [sendFinalFinanceFeedback, setSendFinalFinanceFeedback] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const postAction = useCallback(
    async (url: string, init?: RequestInit, okMessage?: string) => {
      setActionFeedback(null);
      setActionBusy(true);
      try {
        const r = await fetch(url, init);
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) {
          setActionFeedback({ type: "err", text: j.error ?? `Request failed (${r.status})` });
          return false;
        }
        if (okMessage) setActionFeedback({ type: "ok", text: okMessage });
        await refresh();
        return true;
      } catch (e) {
        setActionFeedback({
          type: "err",
          text: e instanceof Error ? e.message : "Network error. Please try again.",
        });
        return false;
      } finally {
        setActionBusy(false);
      }
    },
    [refresh]
  );

  const latestPoPdfDoc = useMemo(() => {
    return indent.documents
      .filter((d) => d.type === "PURCHASE_ORDER")
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }, [indent.documents]);

  const loadVendorReplies = useCallback(async () => {
    if (!isProc) return;
    setVendorRepliesLoading(true);
    setVendorRepliesError(null);
    try {
      const r = await fetch(`/api/indents/${indent.id}/gmail-replies`);
      const text = await r.text();
      let j: { replies?: VendorGmailReply[]; error?: string; connectedInbox?: string | null } = {};
      try {
        if (text) j = JSON.parse(text) as typeof j;
      } catch {
        setVendorRepliesError("Invalid response from server");
        return;
      }
      if (!r.ok) {
        setVendorRepliesError(j.error ?? `Error ${r.status}`);
        return;
      }
      setGmailInboxConnected(j.connectedInbox ?? null);
      setVendorReplies(
        (j.replies ?? []).map((r) => ({
          ...r,
          attachments: Array.isArray(r.attachments) ? r.attachments : [],
        }))
      );
      if (j.error) setVendorRepliesError(j.error);
    } catch (e) {
      setVendorRepliesError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setVendorRepliesLoading(false);
    }
  }, [indent.id, isProc]);

  useEffect(() => {
    if (isProc) void loadVendorReplies();
  }, [isProc, loadVendorReplies]);

  useEffect(() => {
    setCompareResult(null);
    setTextOnlyVendorId("");
    setTextOnlyBody("");
    setTextOnlyFeedback(null);
    setCompareCostReq(indent.procurementCostCommercial ?? "");
    setCompareDeliveryReq(indent.procurementDeliveryExpectations ?? "");
    setCompareSpecReq(indent.procurementSpecifications ?? "");
    setApprovalAmountInput(indent.approvalBudgetAmount ?? "");
  }, [
    indent.id,
    indent.approvalBudgetAmount,
    indent.procurementCostCommercial,
    indent.procurementDeliveryExpectations,
    indent.procurementSpecifications,
  ]);

  useEffect(() => {
    setCompareRequirements(
      [
        "Optional: add must-haves for the AI compare (pharmacopoeia, COA, lead-time caps, Incoterms, MOQ, etc.).",
        indent.item.specNotes
          ? `\nItem quality bar (from master):\n${indent.item.specNotes}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }, [indent.id, indent.item.specNotes]);

  useEffect(() => {
    const latest = indent.aiRuns[0];
    if (!latest?.resultsJson || typeof latest.resultsJson !== "object") return;
    const r = latest.resultsJson as Record<string, unknown>;
    setCompareResult({
      rows: r.rows,
      winnerVendorId: r.winnerVendorId,
      winnerVendorIdByRequirementMatch: r.winnerVendorIdByRequirementMatch,
      winnerRequirementMatchPercent: r.winnerRequirementMatchPercent,
      matchBreakdown: r.matchBreakdown,
      narrative: r.narrative,
      suitability: r.suitability,
      suitabilityError: r.suitabilityError,
      structuredRequirements: r.structuredRequirements,
      run: { id: latest.id, createdAt: latest.createdAt },
    });
    const sr = r.structuredRequirements;
    if (sr && typeof sr === "object" && !Array.isArray(sr)) {
      const o = sr as Record<string, unknown>;
      if (typeof o.costRequirement === "string") setCompareCostReq(o.costRequirement);
      if (typeof o.deliveryRequirement === "string") setCompareDeliveryReq(o.deliveryRequirement);
      if (typeof o.specificationsRequirement === "string") {
        setCompareSpecReq(o.specificationsRequirement);
      }
    }
  }, [indent.id, indent.aiRuns]);

  useEffect(() => {
    const p = indent.purchaseOrders[0];
    if (p?.bodyHtml) {
      setPoHtml((h) => h || p.bodyHtml);
      setPoId((id) => id || p.id);
    }
  }, [indent.purchaseOrders]);

  const loadVendors = useCallback(() => {
    setVendorsLoading(true);
    fetch(`/api/vendors?itemId=${encodeURIComponent(indent.item.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.vendors ?? []).map((v: { id: string; companyName: string; email: string }) => ({
          id: v.id,
          companyName: v.companyName,
          email: v.email,
        }));
        setVendors(list);
        if (list.length && !vendorIds.length) setVendorIds(list.slice(0, 2).map((x: VendorLite) => x.id));
      })
      .finally(() => setVendorsLoading(false));
  }, [indent.item.id, vendorIds.length]);

  const canShowVendorMapping = useMemo(
    () =>
      indent.currentStatus === "PROCUREMENT_ACTIVE" ||
      indent.currentStatus === "RFQ_SENT" ||
      indent.currentStatus === "AWAITING_QUOTES" ||
      indent.currentStatus === "QUOTES_READY",
    [indent.currentStatus]
  );

  const rfqDisplayForCompare = useMemo(() => {
    const r = indent.rfqs[0];
    if (!r) {
      return "No RFQ has been saved on this case yet. Send an enquiry above first - then the subject and body template you sent will appear here.";
    }
    const bt = r.bodyTemplate ?? "";
    return `Subject: ${r.subject}\n\nBody template (as stored; {{company_name}} is replaced per vendor when sending):\n${bt}`;
  }, [indent.rfqs]);

  useEffect(() => {
    if (!isProc) return;
    if (canShowVendorMapping) loadVendors();
  }, [canShowVendorMapping, isProc, loadVendors]);

  const procurementChainVisible = hasPassedProcurementStart(indent.currentStatus);
  const showProcBlocks =
    procurementChainVisible && !showEarlyExitRejectedIndent(indent.currentStatus);
  const [vendorSearch, setVendorSearch] = useState("");
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) => v.companyName.toLowerCase().includes(q) || v.email.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  const tlIndentEvent = useMemo(
    () => indent.approvalEvents.find((a) => a.stage === "TEAM_LEADER_INDENT"),
    [indent.approvalEvents]
  );
  const tlVendorEvent = useMemo(
    () => indent.approvalEvents.find((a) => a.stage === "TEAM_LEADER_VENDOR"),
    [indent.approvalEvents]
  );
  const directorEvent = useMemo(
    () => indent.approvalEvents.find((a) => a.stage === "DIRECTOR_VENDOR"),
    [indent.approvalEvents]
  );
  const mdEvent = useMemo(
    () => indent.approvalEvents.find((a) => a.stage === "MD_VENDOR"),
    [indent.approvalEvents]
  );
  const budgetTrack = useMemo(() => getIndentBudgetTrack(indent), [indent]);
  const approvalBudget = useMemo(() => resolveIndentBudgetAmount(indent), [indent]);
  const trackerSteps = useMemo(() => getWorkflowTrackerSteps(budgetTrack), [budgetTrack]);
  const wfIndex = useMemo(
    () => getWorkflowTrackerIndex(indent.currentStatus, indent),
    [indent]
  );

  const indentSectionReadOnly = !(
    indent.currentStatus === "DRAFT" && indent.requester.id === sessionId
  );
  const tl1Editable = indent.currentStatus === "PENDING_TL_INDENT" && isTL;
  const tl2Editable = indent.currentStatus === "PENDING_TL_VENDOR" && isTL;
  const directorEditable =
    indent.currentStatus === "PENDING_DIRECTOR" && isDir && budgetTrack !== "TL_ONLY";
  const mdEditable = indent.currentStatus === "PENDING_MD" && isMd;

  const showDirectorSection = useMemo(() => {
    if (budgetTrack === "TL_ONLY") return false;
    const s = indent.currentStatus;
    return (
      !!directorEvent ||
      directorEditable ||
      s === "PENDING_DIRECTOR" ||
      s === "REJECTED_DIRECTOR" ||
      s === "PENDING_MD" ||
      s === "REJECTED_MD" ||
      s === "PROCUREMENT_PO" ||
      s === "PO_DRAFT" ||
      s === "PO_SENT" ||
      s === "AWAITING_INVOICE" ||
      s === "PENDING_FINANCE" ||
      s === "PAYMENT_DONE" ||
      s === "PENDING_FINANCE_FINAL" ||
      s === "PAYMENT_PROOF_TO_VENDOR" ||
      s === "CLOSED"
    );
  }, [budgetTrack, directorEvent, directorEditable, indent.currentStatus]);

  const showMdSection = useMemo(() => {
    if (!requiresMdApproval(budgetTrack)) return false;
    const s = indent.currentStatus;
    return (
      !!mdEvent ||
      mdEditable ||
      s === "PENDING_MD" ||
      s === "REJECTED_MD" ||
      s === "PROCUREMENT_PO" ||
      s === "PO_DRAFT" ||
      s === "PO_SENT" ||
      s === "AWAITING_INVOICE" ||
      s === "PENDING_FINANCE" ||
      s === "PAYMENT_DONE" ||
      s === "PENDING_FINANCE_FINAL" ||
      s === "PAYMENT_PROOF_TO_VENDOR" ||
      s === "CLOSED"
    );
  }, [budgetTrack, mdEvent, mdEditable, indent.currentStatus]);

  const tl2Approved =
    tlVendorEvent?.decision === "APPROVED" ||
    [
      "PROCUREMENT_PO",
      "PO_DRAFT",
      "PO_SENT",
      "AWAITING_INVOICE",
      "PENDING_FINANCE",
      "PAYMENT_DONE",
      "PENDING_FINANCE_FINAL",
      "PAYMENT_PROOF_TO_VENDOR",
      "CLOSED",
    ].includes(indent.currentStatus);

  const poPhaseStatuses = [
    "PROCUREMENT_PO",
    "PO_DRAFT",
    "PO_SENT",
    "AWAITING_INVOICE",
    "PENDING_FINANCE",
    "PAYMENT_DONE",
    "PENDING_FINANCE_FINAL",
    "PAYMENT_PROOF_TO_VENDOR",
    "CLOSED",
  ];

  const showProcSection2 =
    indent.vendorSelection != null && tl2Approved && poPhaseStatuses.includes(indent.currentStatus);

  const procSection2Editable =
    isProc &&
    ["PROCUREMENT_PO", "PO_DRAFT", "PO_SENT", "AWAITING_INVOICE"].includes(indent.currentStatus);

  const showProcSection3 =
    indent.vendorSelection != null &&
    ["PAYMENT_DONE", "PENDING_FINANCE_FINAL", "CLOSED"].includes(indent.currentStatus);

  const procSection3Editable = isProc && indent.currentStatus === "PAYMENT_DONE";

  const proformaInvoice = useMemo(() => getProformaInvoice(indent.invoices), [indent.invoices]);
  const finalInvoice = useMemo(() => getFinalInvoice(indent.invoices), [indent.invoices]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6 pb-16"
    >
      <WorkflowTimeline steps={trackerSteps} activeIndex={wfIndex} />

      {actionFeedback ? (
        <div
          role="alert"
          className={
            actionFeedback.type === "err"
              ? "rounded-[var(--radius-md)] border border-red-200 bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]"
              : "rounded-[var(--radius-md)] border border-emerald-200 bg-[var(--color-success-soft)] px-4 py-3 text-sm text-[var(--color-success)]"
          }
        >
          {actionFeedback.text}
        </div>
      ) : null}

      {String(indent.currentStatus).startsWith("REJECTED") ? (
        <div className="rounded-xl border border-black/15 bg-neutral-100 px-4 py-3 text-sm text-black">
          <strong>Workflow stopped.</strong> This case was rejected and cannot move forward.
          {indent.rejectionReason ? (
            <p className="mt-2 whitespace-pre-wrap text-black/90">{indent.rejectionReason}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-black">
            {indent.item.name} · {indent.item.sku} · Qty {indent.quantity} {indent.item.uom}
          </p>
          {approvalBudget != null ? (
            <p className="mt-1 text-sm text-black">
              Procurement value {formatCurrency(approvalBudget)}
            </p>
          ) : null}
          {approvalBudget != null ? (
            <p className="mt-1 text-xs text-black/80">{budgetTrackLabel(budgetTrack)}</p>
          ) : (
            <p className="mt-1 text-xs text-black/70">
              Approval track set when procurement saves cost / commercial expectations.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" className="text-[10px] uppercase tracking-wide">
            {indent.currentStatus.replace(/_/g, " ")}
          </Badge>
          <Button variant="outline" asChild>
            <a href={`/api/indents/${indent.id}/pdf`}>Download indent PDF</a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/indents">Back to list</Link>
          </Button>
        </div>
      </div>

      <ProcurementDocumentFrame
        reference={indent.reference}
        createdAt={indent.createdAt ?? indent.stateHistory[0]?.createdAt}
      >
        <DocumentSection
          title="Indent Request Form"
          subtitle="Enterprise indent — item, quantity, priority, and business case."
          badge="Requester"
          defaultOpen
          readOnly={indentSectionReadOnly}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Name of item
              </div>
              <p className="mt-1 text-sm font-medium text-black">{indent.item.name}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Quantity
              </div>
              <p className="mt-1 font-mono text-sm font-medium text-black">
                {indent.quantity} {indent.item.uom}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Priority
              </div>
              <div className="mt-2">
                <span
                  className={
                    indent.priority === "HIGH"
                      ? "inline-flex items-center rounded-full border border-red-300/80 bg-red-50 px-3 py-1 text-xs font-semibold text-black"
                      : indent.priority === "LOW"
                        ? "inline-flex items-center rounded-full border border-black/15 bg-neutral-100 px-3 py-1 text-xs font-semibold text-black"
                        : "inline-flex items-center rounded-full border border-amber-300/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-black"
                  }
                >
                  {indent.priority === "HIGH" ? "High" : indent.priority === "LOW" ? "Low" : "Medium"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 sm:col-span-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Specifications
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-black">
                {indent.item.specNotes?.trim() ? indent.item.specNotes : "—"}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Reason for acquiring product
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black">
              {indent.justification}
            </p>
          </div>
          <div className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Requester
              </div>
              <p className="mt-1 text-sm font-medium text-black">{indent.requester.name}</p>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-black">
                Reference
              </div>
              <p className="mt-1 font-mono text-sm text-black">{indent.reference}</p>
            </div>
          </div>
          {indent.rejectionReason && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-black">
              <strong>Rejection:</strong> {indent.rejectionReason}
            </div>
          )}
          {indent.currentStatus === "DRAFT" && indent.requester.id === sessionId && (
            <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-4">
              <Button
                disabled={actionBusy}
                onClick={() =>
                  void postAction(`/api/indents/${indent.id}/submit`, { method: "POST" }, "Sent for Team Lead review.")
                }
              >
                {actionBusy ? "Sending…" : "Send"}
              </Button>
              <p className="text-xs text-[var(--color-muted)]">
                Sends this indent to your Team Lead for review.
              </p>
            </div>
          )}
        </DocumentSection>

        {indent.currentStatus !== "DRAFT" ? (
          <DocumentSection
            title="Team Lead Section 1"
            subtitle="Initial indent decision and remarks."
            badge="Team Lead"
            defaultOpen={tl1Editable}
            readOnly={!tl1Editable}
          >
            {tl1Editable ? (
              <ApprovalCard
                title="Decision"
                busy={actionBusy}
                onDecision={async (decision) => {
                  const ok = await postAction(
                    `/api/indents/${indent.id}/approvals`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ stage: "tl_indent", decision, remarks }),
                    },
                    "Decision recorded."
                  );
                  if (ok) setRemarks("");
                }}
                remarks={remarks}
                setRemarks={setRemarks}
              />
            ) : tlIndentEvent ? (
              <TeamLeadDecisionStamp
                actor={tlIndentEvent.actor.name}
                decision={tlIndentEvent.decision}
                remarks={tlIndentEvent.remarks}
                when={tlIndentEvent.createdAt}
              />
            ) : indent.currentStatus === "PENDING_TL_INDENT" ? (
              <ApprovalObserverBanner actorLabel="Team Lead" />
            ) : (
              <p className="text-sm text-black">Awaiting Team Lead review.</p>
            )}
          </DocumentSection>
        ) : null}

        {showProcBlocks ? (
          <DocumentSection
            title="Procurement Section 1"
            subtitle="Enquiry, quotes, AI match, and vendor nomination."
            defaultOpen
            readOnly={!isProc}
          >
            <div id="procurement" className="space-y-6 scroll-mt-20">
          {isProc && (
            <>
              {(indent.currentStatus === "PROCUREMENT_ACTIVE" ||
                indent.currentStatus === "AWAITING_QUOTES" ||
                indent.currentStatus === "RFQ_SENT") && (
                <Card className="space-y-5 border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
                  <CardTitle className="text-base text-black">Step 1 — Vendors & send enquiry</CardTitle>
                  <Button variant="outline" size="sm" type="button" onClick={loadVendors}>
                    Refresh mapped vendors
                  </Button>
                  <div className="space-y-2">
                    <Label className="text-black">Search / filter vendors</Label>
                    <Input
                      placeholder="Filter by company or Gmail…"
                      value={vendorSearch}
                      onChange={(e) => setVendorSearch(e.target.value)}
                      className="border-[var(--color-border)] bg-[var(--color-surface)]"
                    />
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[10px] font-semibold uppercase tracking-wide text-black">
                          <tr>
                            <th className="px-3 py-2">Select</th>
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2">Vendor name</th>
                            <th className="px-3 py-2">Vendor Gmail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorsLoading ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-4 text-xs text-black">
                                Loading mapped vendors…
                              </td>
                            </tr>
                          ) : filteredVendors.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-4 text-xs text-black">
                                No mapped vendors found for {indent.item.name}. Add item mapping in Vendor Master.
                              </td>
                            </tr>
                          ) : (
                            filteredVendors.map((v) => (
                              <tr key={v.id} className="border-b border-[var(--color-border)] last:border-0">
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={vendorIds.includes(v.id)}
                                    onChange={(e) => {
                                      setVendorIds((prev) =>
                                        e.target.checked ? [...prev, v.id] : prev.filter((x) => x !== v.id)
                                      );
                                    }}
                                    className="accent-black"
                                  />
                                </td>
                                <td className="px-3 py-2 text-black">{indent.item.name}</td>
                                <td className="px-3 py-2 font-medium text-black">{v.companyName}</td>
                                <td className="px-3 py-2 font-mono text-xs text-black">{v.email}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-black">
                      Mail preview
                    </div>
                    <div className="mt-3 space-y-2">
                      <Label className="text-black">Subject</Label>
                      <Input
                        value={rfqSubject}
                        onChange={(e) => setRfqSubject(e.target.value)}
                        className="border-[var(--color-border)] bg-[var(--color-doc-inner)]"
                      />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Label className="text-black">Body (use {"{{company_name}}"} for personalization)</Label>
                      <textarea
                        className="min-h-[120px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-doc-inner)] p-3 text-sm text-black"
                        value={rfqBody}
                        onChange={(e) => setRfqBody(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    disabled={sendingRfq || vendorIds.length === 0}
                    onClick={async () => {
                      setSendingRfq(true);
                      setRfqFeedback(null);
                      try {
                        const res = await fetch(`/api/indents/${indent.id}/rfq/send`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            subject: rfqSubject,
                            bodyTemplate: rfqBody,
                            vendorIds,
                          }),
                        });
                        const text = await res.text();
                        const data = text ? (JSON.parse(text) as { error?: string; message?: string; sentCount?: number }) : {};
                        if (!res.ok) {
                          setRfqFeedback({ type: "error", text: data.error ?? "Failed to send enquiry email." });
                          return;
                        }
                        setRfqFeedback({
                          type: "success",
                          text: data.message ?? `Enquiry email sent to ${data.sentCount ?? vendorIds.length} vendor(s).`,
                        });
                        await refresh();
                        void loadVendorReplies();
                      } catch (error) {
                        setRfqFeedback({
                          type: "error",
                          text: error instanceof Error ? error.message : "Failed to send enquiry email.",
                        });
                      } finally {
                        setSendingRfq(false);
                      }
                    }}
                  >
                    {sendingRfq ? "Sending…" : "Send Gmail"}
                  </Button>
                  {rfqFeedback && (
                    <p className="text-xs text-black">
                      {rfqFeedback.text}
                    </p>
                  )}
                </Card>
              )}

              {isProc && (
                <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <Label className="text-black">Enquiry sent to vendors (latest RFQ — reference only)</Label>
                  <textarea
                    readOnly
                    className="min-h-[120px] w-full resize-y rounded-lg border border-black/15 bg-neutral-50 p-3 text-sm text-black"
                    value={rfqDisplayForCompare}
                  />
                </div>
              )}

              {isProc && (
                <Card className="space-y-6 border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" id="proc-step-2">
                  <CardTitle className="text-base text-black">Step 2 — Quotations & AI match</CardTitle>

                  <div className="space-y-3 border-b border-[var(--color-border)] pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-black">Vendor replies (Gmail)</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-black/15"
                        disabled={vendorRepliesLoading}
                        onClick={() => void loadVendorReplies()}
                      >
                        {vendorRepliesLoading ? "Loading…" : "Refresh from Gmail"}
                      </Button>
                    </div>
                    {gmailInboxConnected ? (
                      <p className="text-xs text-black/75">
                        Reading inbox: <span className="font-medium text-black">{gmailInboxConnected}</span>
                        . Vendors must reply to this address (re-send RFQ with Send Gmail after connecting).
                      </p>
                    ) : null}
                    {vendorRepliesError ? <p className="text-xs text-black">{vendorRepliesError}</p> : null}
                    {!vendorRepliesLoading && vendorReplies.length === 0 ? (
                      <p className="text-xs text-black/75">
                        No vendor replies detected yet. Vendors should reply to your connected Gmail (use Send Gmail
                        above). For demo: if you reply from the same mailbox, set the vendor&apos;s email in Vendor
                        Master to match and include a quote (e.g. &quot;Thank you for your enquiry&quot;, cost, lead time).
                      </p>
                    ) : null}
                    {vendorReplies.length > 0 ? (
                      <ul className="space-y-3">
                        {vendorReplies.map((row) => (
                          <li
                            key={row.messageId}
                            className="rounded-lg border border-black/10 bg-white p-3 text-sm text-black"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-black">{row.subject}</div>
                                <div className="truncate text-xs text-black/70">{row.from}</div>
                                {row.snippet ? (
                                  <p className="mt-2 line-clamp-2 text-xs text-black/75">{row.snippet}</p>
                                ) : null}
                                {row.attachments?.length ? (
                                  <div className="mt-3 space-y-1.5">
                                    <div className="text-[10px] font-medium uppercase tracking-wide text-black/70">
                                      Attachments
                                    </div>
                                    <ul className="flex flex-col gap-1.5">
                                      {row.attachments.map((att) => (
                                        <li key={`${row.messageId}-${att.filename}-${att.downloadHref}`}>
                                          <a
                                            href={att.downloadHref}
                                            className="inline-flex max-w-full items-center gap-2 rounded-md border border-black/15 bg-neutral-50 px-2 py-1 text-xs text-black hover:border-black/30 hover:bg-neutral-100"
                                          >
                                            <span className="truncate font-medium">{att.filename}</span>
                                            {att.size > 0 ? (
                                              <span className="shrink-0 text-black/60">
                                                {formatAttachmentSize(att.size)}
                                              </span>
                                            ) : null}
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                <div className="mt-2 text-xs text-black/70">
                                  {formatStableDateTime(new Date(row.internalMs).toISOString())}
                                </div>
                              </div>
                              <a
                                href={row.gmailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-xs font-medium text-black underline hover:text-black/80"
                              >
                                Open in Gmail
                              </a>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
                    <div className="text-sm font-medium text-black">Upload quote (PDF)</div>
                    <Button variant="outline" size="sm" type="button" onClick={loadVendors}>
                      Load vendors for item
                    </Button>
                    {vendorsLoading ? (
                      <p className="text-xs text-black/70">Loading vendors...</p>
                    ) : vendors.length === 0 ? (
                      <p className="text-xs text-black/80">
                        No mapped vendors - add mapping in Vendor Master, then refresh.
                      </p>
                    ) : (
                      <ManualQuoteUpload indentId={indent.id} vendors={vendors} onDone={refresh} />
                    )}
                  </div>

                  <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
                    <div className="text-sm font-medium text-black">Paste text quotation</div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label className="normal-case">Vendor</Label>
                        <select
                          className="h-9 min-w-[200px] rounded-lg border border-black/15 bg-white px-2 text-sm text-black"
                          value={textOnlyVendorId}
                          onChange={(e) => setTextOnlyVendorId(e.target.value)}
                        >
                          <option value="">Select...</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id} className="bg-white text-black">
                              {v.companyName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={textOnlySaving || !textOnlyVendorId.trim() || !textOnlyBody.trim()}
                        onClick={async () => {
                          setTextOnlySaving(true);
                          setTextOnlyFeedback(null);
                          try {
                            const r = await fetch(`/api/indents/${indent.id}/quotations/from-text`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ vendorId: textOnlyVendorId, text: textOnlyBody }),
                            });
                            const j = await r.json().catch(() => ({}));
                            if (!r.ok) {
                              setTextOnlyFeedback({
                                type: "err",
                                text: (j as { error?: string }).error ?? "Save failed",
                              });
                              return;
                            }
                            setTextOnlyFeedback({ type: "ok", text: "Saved. Refreshing..." });
                            setTextOnlyBody("");
                            await refresh();
                            setTextOnlyFeedback(null);
                          } finally {
                            setTextOnlySaving(false);
                          }
                        }}
                      >
                        {textOnlySaving ? "Saving..." : "Save text as quotation"}
                      </Button>
                    </div>
                    <textarea
                      className="min-h-[120px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/40"
                      placeholder="Paste the vendor's full quotation email or typed offer here..."
                      value={textOnlyBody}
                      onChange={(e) => setTextOnlyBody(e.target.value)}
                    />
                    {textOnlyFeedback ? (
                      <p className="text-xs text-black">
                        {textOnlyFeedback.text}
                      </p>
                    ) : null}
                  </div>

                  {indent.quotations.length === 0 ? (
                    <p className="text-xs text-black/75">Add a quotation (upload or paste) before Match with AI.</p>
                  ) : null}

                  <div className="space-y-2">
                    <Label>Additional notes for the AI (optional)</Label>
                    <textarea
                      className="min-h-[80px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/40"
                      value={compareRequirements}
                      onChange={(e) => setCompareRequirements(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="approval-amount">Approval value (INR)</Label>
                      <p className="text-[11px] text-black/70">
                        Total or max value in rupees. This alone drives Team Lead / Director / MD
                        approval routing, so enter the figure you want approved.
                      </p>
                      <Input
                        id="approval-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="e.g. 450000"
                        value={approvalAmountInput}
                        onChange={(e) => setApprovalAmountInput(e.target.value)}
                      />
                      <Label>Cost / commercial expectations</Label>
                      <textarea
                        className="min-h-[100px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/40"
                        placeholder="e.g. max total ₹4,50,000, payment terms Net 30..."
                        value={compareCostReq}
                        onChange={(e) => setCompareCostReq(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Delivery / timeline expectations</Label>
                      <textarea
                        className="min-h-[100px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/40"
                        placeholder="e.g. required on-site date, max lead time in days, Incoterms..."
                        value={compareDeliveryReq}
                        onChange={(e) => setCompareDeliveryReq(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Specifications / quality</Label>
                      <textarea
                        className="min-h-[100px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/40"
                        placeholder="e.g. grade, pharmacopoeia, COA, packaging, shelf life..."
                        value={compareSpecReq}
                        onChange={(e) => setCompareSpecReq(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="border-black/15"
                    onClick={async () => {
                      const approvalBudgetAmount = parseApprovalAmount(approvalAmountInput);
                      if (approvalBudgetAmount === undefined) {
                        setActionFeedback({
                          type: "err",
                          text: "Approval value must be a number of zero or more.",
                        });
                        return;
                      }
                      await postAction(
                        `/api/indents/${indent.id}/procurement-requirements`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            costRequirement: compareCostReq,
                            deliveryRequirement: compareDeliveryReq,
                            specificationsRequirement: compareSpecReq,
                            approvalBudgetAmount,
                          }),
                        },
                        "Commercial requirements saved."
                      );
                    }}
                  >
                    Save commercial requirements
                  </Button>

                  {indent.quotations.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-black">AI extract (per quote)</div>
                      {extractFeedback ? <p className="text-xs text-black/75">{extractFeedback}</p> : null}
                      <ul className="space-y-3">
                        {indent.quotations.map((q) => (
                          <li
                            key={q.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-sm text-black"
                          >
                            <span className="font-medium">{q.vendor.companyName}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-black/15"
                              disabled={extractingQid !== null}
                              onClick={async () => {
                                setExtractFeedback(null);
                                setExtractingQid(q.id);
                                try {
                                  const r = await fetch(
                                    `/api/indents/${indent.id}/quotations/${q.id}/extract`,
                                    { method: "POST" }
                                  );
                                  const j = await r.json().catch(() => ({}));
                                  if (!r.ok) {
                                    setExtractFeedback((j as { error?: string }).error ?? "Extract failed");
                                    return;
                                  }
                                  setExtractFeedback("Extract updated. Refreshing…");
                                  await refresh();
                                  setExtractFeedback(null);
                                } finally {
                                  setExtractingQid(null);
                                }
                              }}
                            >
                              {extractingQid === q.id ? "Extracting…" : "Extract with AI"}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <Button
                    disabled={compareRunning || indent.quotations.length === 0}
                    onClick={async () => {
                      setCompareRunning(true);
                      try {
                        const r = await fetch(`/api/indents/${indent.id}/compare`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            costRequirement: compareCostReq,
                            deliveryRequirement: compareDeliveryReq,
                            specificationsRequirement: compareSpecReq,
                            procurementRequirements: compareRequirements,
                          }),
                        });
                        const text = await r.text();
                        let j: Record<string, unknown> = {};
                        try {
                          if (text) j = JSON.parse(text) as Record<string, unknown>;
                        } catch {
                          setCompareResult({ parseError: "Invalid JSON from server" });
                          return;
                        }
                        if (!r.ok) {
                          setCompareResult({ apiError: String(j.error ?? r.status) });
                          return;
                        }
                        setCompareResult(j);
                        await refresh();
                      } finally {
                        setCompareRunning(false);
                      }
                    }}
                  >
                    {compareRunning ? "Matching…" : "Match with AI"}
                  </Button>

                </Card>
              )}

              {isProc && compareResult != null ? (
                <Card className="space-y-4 border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" id="proc-step-3">
                  <CardTitle className="text-base text-black">Step 3 — AI comparison</CardTitle>
                  <CompareResultsPanel
                    variant="procurement"
                    compareResult={compareResult}
                    quotations={indent.quotations}
                  />
                </Card>
              ) : null}

              {(indent.currentStatus === "RFQ_SENT" ||
                indent.currentStatus === "AWAITING_QUOTES" ||
                indent.currentStatus === "PROCUREMENT_ACTIVE") && (
                <Card className="p-4">
                  <Button
                    variant="outline"
                    disabled={actionBusy}
                    onClick={() =>
                      void postAction(
                        `/api/indents/${indent.id}/quotes/ready`,
                        { method: "POST" },
                        "Quotations marked ready."
                      )
                    }
                  >
                    {actionBusy ? "Updating…" : "Mark quotations ready"}
                  </Button>
                </Card>
              )}

              {indent.currentStatus === "QUOTES_READY" && (
                <Card className="space-y-4 border-[var(--color-border)] bg-[var(--color-surface-2)] p-5" id="proc-step-4">
                  <CardTitle className="text-base text-black">Step 4 — Finalize vendor (Team Lead)</CardTitle>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-black">
                      <thead>
                        <tr className="border-b border-black/10 text-black/75">
                          <th className="py-2">Vendor</th>
                          <th className="py-2">Price</th>
                          <th className="py-2">Lead</th>
                          <th className="py-2">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {indent.quotations.map((q) => (
                          <tr key={q.id} className="border-b border-black/5">
                            <td className="py-2 font-medium">{q.vendor.companyName}</td>
                            <td className="py-2">{q.unitPrice ?? "—"}</td>
                            <td className="py-2">{q.leadTimeDays ?? "—"}</td>
                            <td className="py-2 text-xs text-black/70">
                              {q.aiScoresJson &&
                              typeof q.aiScoresJson === "object" &&
                              "total" in q.aiScoresJson
                                ? String((q.aiScoresJson as { total: number }).total.toFixed(2))
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Select vendor for Team Lead approval</Label>
                      <select
                        className="h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-black"
                        value={selectedVendorId}
                        onChange={(e) => setSelectedVendorId(e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {[...new Map(indent.quotations.map((q) => [q.vendorId, q])).values()].map(
                          (q) => (
                            <option key={q.vendorId} value={q.vendorId} className="bg-white text-black">
                              {q.vendor.companyName}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Override reason (if not AI top pick)</Label>
                      <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    disabled={!selectedVendorId || actionBusy}
                    onClick={async () => {
                      const byMatch = compareResult?.winnerVendorIdByRequirementMatch;
                      const byScore = compareResult?.winnerVendorId;
                      const winner =
                        typeof byMatch === "string"
                          ? byMatch
                          : typeof byScore === "string"
                            ? byScore
                            : null;
                      const approvalBudgetAmount = parseApprovalAmount(approvalAmountInput);
                      if (approvalBudgetAmount === undefined) {
                        setActionFeedback({
                          type: "err",
                          text: "Approval value must be a number of zero or more.",
                        });
                        return;
                      }
                      await postAction(
                        `/api/indents/${indent.id}/vendor-selection`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            selectedVendorId,
                            aiRecommendedVendorId: winner ?? null,
                            overrideReason: overrideReason || null,
                            costRequirement: compareCostReq,
                            deliveryRequirement: compareDeliveryReq,
                            specificationsRequirement: compareSpecReq,
                            approvalBudgetAmount,
                          }),
                        },
                        "Vendor selection sent for approval."
                      );
                    }}
                  >
                    {actionBusy ? "Sending…" : "Send"}
                  </Button>
                </Card>
              )}
            </>
          )}
          {showVendorChoiceReadOnly ? (
            <ProcurementVendorChoiceBrief
              vendorSelection={indent.vendorSelection!}
              quotations={indent.quotations}
              latestRun={indent.aiRuns[0]}
            />
          ) : null}
          {!isProc && !showVendorChoiceReadOnly ? (
            <p className="text-sm text-black">Procurement tools are visible to procurement users.</p>
          ) : null}
            </div>
          </DocumentSection>
        ) : null}

        {indent.vendorSelection != null && indent.currentStatus !== "DRAFT" ? (
          <DocumentSection
            title="Team Lead Section 2"
            subtitle="Review the vendor nominated by procurement against AI outputs."
            badge="Team Lead"
            defaultOpen={tl2Editable}
            readOnly={!tl2Editable}
          >
            {tl2Editable ? (
              <ApprovalCard
                title="Selected vendor decision"
                busy={actionBusy}
                onDecision={async (decision) => {
                  const ok = await postAction(
                    `/api/indents/${indent.id}/approvals`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ stage: "tl_vendor", decision, remarks }),
                    },
                    "Decision recorded."
                  );
                  if (ok) setRemarks("");
                }}
                remarks={remarks}
                setRemarks={setRemarks}
              />
            ) : tlVendorEvent ? (
              <TeamLeadDecisionStamp
                actor={tlVendorEvent.actor.name}
                decision={tlVendorEvent.decision}
                remarks={tlVendorEvent.remarks}
                when={tlVendorEvent.createdAt}
              />
            ) : indent.currentStatus === "PENDING_TL_VENDOR" ? (
              <ApprovalObserverBanner actorLabel="Team Lead" />
            ) : (
              <p className="text-sm text-black">
                Awaiting Team Lead review of the vendor selection from procurement.
              </p>
            )}
          </DocumentSection>
        ) : null}

        {showDirectorSection ? (
          <DocumentSection
            title="Director Approval Section"
            subtitle="Executive sign-off on vendor and commercial posture."
            badge="Director"
            defaultOpen={directorEditable}
            readOnly={!directorEditable}
          >
            {directorEditable ? (
              <ApprovalCard
                title="Director decision"
                busy={actionBusy}
                onDecision={async (decision) => {
                  const ok = await postAction(
                    `/api/indents/${indent.id}/approvals`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ stage: "director", decision, remarks }),
                    },
                    "Decision recorded."
                  );
                  if (ok) setRemarks("");
                }}
                remarks={remarks}
                setRemarks={setRemarks}
              />
            ) : directorEvent ? (
              <TeamLeadDecisionStamp
                actor={directorEvent.actor.name}
                decision={directorEvent.decision}
                remarks={directorEvent.remarks}
                when={directorEvent.createdAt}
              />
            ) : indent.currentStatus === "PENDING_DIRECTOR" ? (
              <ApprovalObserverBanner actorLabel="Director" />
            ) : (
              <p className="text-sm text-black">This stage activates when the case is with the Director.</p>
            )}
          </DocumentSection>
        ) : null}

        {showMdSection ? (
          <DocumentSection
            title="MD Approval Section"
            subtitle="Managing Director sign-off for budgets above ₹5,00,000."
            badge="MD"
            defaultOpen={mdEditable}
            readOnly={!mdEditable}
          >
            {mdEditable ? (
              <ApprovalCard
                title="MD decision"
                busy={actionBusy}
                onDecision={async (decision) => {
                  const ok = await postAction(
                    `/api/indents/${indent.id}/approvals`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ stage: "md", decision, remarks }),
                    },
                    "Decision recorded."
                  );
                  if (ok) setRemarks("");
                }}
                remarks={remarks}
                setRemarks={setRemarks}
              />
            ) : mdEvent ? (
              <TeamLeadDecisionStamp
                actor={mdEvent.actor.name}
                decision={mdEvent.decision}
                remarks={mdEvent.remarks}
                when={mdEvent.createdAt}
              />
            ) : indent.currentStatus === "PENDING_MD" ? (
              <ApprovalObserverBanner actorLabel="Managing Director" />
            ) : (
              <p className="text-sm text-black">This stage activates after Director approval for high-value cases.</p>
            )}
          </DocumentSection>
        ) : null}

        {showProcSection2 ? (
          <DocumentSection
            title="Procurement Section 2 — PO & Proforma"
            subtitle="Upload the signed PO and vendor proforma, then send the case to finance."
            badge="Procurement"
            defaultOpen={procSection2Editable}
            readOnly={!procSection2Editable}
          >
            {(indent.currentStatus === "PROCUREMENT_PO" ||
              indent.currentStatus === "PO_DRAFT" ||
              indent.currentStatus === "PO_SENT" ||
              indent.currentStatus === "AWAITING_INVOICE" ||
              indent.currentStatus === "PENDING_FINANCE" ||
              indent.currentStatus === "PAYMENT_DONE" ||
              indent.currentStatus === "PENDING_FINANCE_FINAL" ||
              indent.currentStatus === "CLOSED") && (
              <Card className="space-y-3 border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
                {procSection2Editable ? (
                  <>
                    <input
                      ref={poUploadInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={async (ev) => {
                        const f = ev.target.files?.[0];
                        ev.target.value = "";
                        if (!f) return;
                        setPoGenMsg(null);
                        try {
                          const fd = new FormData();
                          fd.append("file", f);
                          const r = await fetch(`/api/po/${indent.id}/upload`, { method: "POST", body: fd });
                          const text = await r.text();
                          let j: {
                            po?: { id: string; bodyHtml?: string };
                            error?: string;
                            pdfDocument?: { id: string };
                          } = {};
                          try {
                            if (text) j = JSON.parse(text) as typeof j;
                          } catch {
                            setPoGenMsg({
                              kind: "err",
                              text: "Server returned invalid JSON (check terminal / network).",
                            });
                            return;
                          }
                          if (!r.ok) {
                            setPoGenMsg({
                              kind: "err",
                              text: j.error ?? `Upload failed (${r.status})`,
                            });
                            return;
                          }
                          if (j.po) {
                            setPoId(j.po.id);
                            setPoHtml(j.po.bodyHtml ?? "");
                            setPoGenMsg({ kind: "ok", text: "PO PDF saved on this case." });
                          }
                          await refresh();
                        } catch (e) {
                          setPoGenMsg({
                            kind: "err",
                            text: e instanceof Error ? e.message : "Upload failed",
                          });
                        }
                      }}
                    />
                    <Button type="button" onClick={() => poUploadInputRef.current?.click()}>
                      Upload PO (PDF)
                    </Button>
                    {poGenMsg ? <p className="text-xs text-black">{poGenMsg.text}</p> : null}
                  </>
                ) : null}
                {(indent.purchaseOrders[0] || latestPoPdfDoc || poHtml.trim().length > 0) && (
                  <div className="space-y-3">
                    {latestPoPdfDoc ? (
                      <div className="rounded-lg border border-black/10 bg-neutral-50 px-4 py-3 text-sm text-black">
                        <p className="font-medium text-black">PO PDF on file</p>
                        <p className="mt-1 text-xs text-black/75">
                          Download or re-upload to replace. When Gmail is connected,{" "}
                          <span className="font-medium text-black">Send PO to vendor</span> attaches this PDF.
                        </p>
                        <Button className="mt-3" variant="outline" size="sm" asChild>
                          <a
                            href={`/api/documents/${latestPoPdfDoc.id}/file`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Download PO (PDF)
                          </a>
                        </Button>
                      </div>
                    ) : null}
                    {poHtml.trim().length > 0 ? (
                      <details className="text-xs text-black/75">
                        <summary className="cursor-pointer text-black/80">PO record note (HTML)</summary>
                        <textarea
                          readOnly
                          className="mt-2 min-h-[120px] w-full rounded-lg border border-black/15 bg-white p-3 font-mono text-xs text-black"
                          value={poHtml}
                        />
                      </details>
                    ) : null}
                    {procSection2Editable && (indent.purchaseOrders[0] || poId) ? (
                      <Button
                        onClick={async () => {
                          const po = indent.purchaseOrders[0];
                          const id = poId || po?.id;
                          if (!id) return;
                          await fetch(`/api/po/${indent.id}/send`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ poId: id }),
                          });
                          await refresh();
                        }}
                      >
                        Send PO to vendor (email)
                      </Button>
                    ) : null}
                  </div>
                )}

                {(latestPoPdfDoc || indent.purchaseOrders[0] || proformaInvoice) && (
                  <div className="space-y-4 border-t border-[var(--color-border)] pt-5">
                    <div>
                      <CardTitle className="text-sm text-black">Proforma</CardTitle>
                      <CardDescription className="mt-1 text-black/75">
                        Upload the vendor&apos;s proforma PDF, enter details, then save. Use{" "}
                        <span className="font-medium text-black">Send to finance</span> only after the proforma is saved.
                      </CardDescription>
                    </div>
                    {procSection2Editable && indent.purchaseOrders.length === 0 ? (
                      <p className="text-sm text-black/80">
                        Purchase order record is still being created — refresh or re-upload PO.
                      </p>
                    ) : procSection2Editable ? (
                      <>
                        <InvoiceForm
                          variant="proforma"
                          indentId={indent.id}
                          purchaseOrders={indent.purchaseOrders}
                          existingInvoice={
                            proformaInvoice
                              ? {
                                  vendorName: proformaInvoice.vendorName,
                                  amount: proformaInvoice.amount,
                                  purchaseOrderId: proformaInvoice.purchaseOrderId ?? null,
                                  documentId: proformaInvoice.documentId ?? null,
                                }
                              : undefined
                          }
                          onDone={refresh}
                        />
                        {indent.currentStatus === "AWAITING_INVOICE" && proformaInvoice?.documentId ? (
                          <Button
                            onClick={async () => {
                              setSendFinanceFeedback(null);
                              const r = await fetch(`/api/indents/${indent.id}/send-to-finance`, {
                                method: "POST",
                              });
                              const text = await r.text();
                              let j: { error?: string } = {};
                              try {
                                if (text) j = JSON.parse(text) as { error?: string };
                              } catch {
                                setSendFinanceFeedback("Invalid response from server.");
                                return;
                              }
                              if (!r.ok) {
                                setSendFinanceFeedback(j.error ?? `Send failed (${r.status})`);
                                return;
                              }
                              await refresh();
                            }}
                          >
                            Send to finance
                          </Button>
                        ) : null}
                        {sendFinanceFeedback ? (
                          <p className="text-xs text-black">{sendFinanceFeedback}</p>
                        ) : null}
                      </>
                    ) : proformaInvoice ? (
                      <div className="text-sm text-black">
                        <p>
                          <span className="font-medium">Vendor:</span> {proformaInvoice.vendorName}
                          {proformaInvoice.amount ? (
                            <>
                              {" "}
                              · <span className="font-medium">Amount:</span> {proformaInvoice.amount}
                            </>
                          ) : null}
                        </p>
                        {proformaInvoice.documentId ? (
                          <Button className="mt-3" variant="outline" size="sm" asChild>
                            <a
                              href={`/api/documents/${proformaInvoice.documentId}/file`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Download proforma (PDF)
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-black/80">No proforma recorded yet.</p>
                    )}
                  </div>
                )}
              </Card>
            )}
          </DocumentSection>
        ) : null}

        {indent.currentStatus === "PENDING_FINANCE" && isFin ? (
          <DocumentSection
            title="Finance"
            subtitle="Review approval history, procurement PO and proforma, then complete the accounts section."
            defaultOpen
            readOnly={false}
          >
            <FinanceAccountsPanel indent={indent} onDone={refresh} />
          </DocumentSection>
        ) : null}

        {indent.financeCompletedAt &&
        ["PAYMENT_DONE", "PENDING_FINANCE_FINAL", "CLOSED"].includes(indent.currentStatus) ? (
          <DocumentSection
            title="Finance — Accounts"
            subtitle="Accounts section completed by finance. Procurement can proceed with final invoice upload below."
            defaultOpen={procSection3Editable}
            readOnly
          >
            <FinanceAccountsSummary indent={indent} />
          </DocumentSection>
        ) : null}

        {showProcSection3 ? (
          <DocumentSection
            title="Procurement Section 3 — Invoice upload"
            subtitle="Upload the vendor's final invoice and send it back to finance."
            badge="Procurement"
            defaultOpen={procSection3Editable}
            readOnly={!procSection3Editable}
          >
            <div className="space-y-5">
              {!indent.financeCompletedAt ? (
                <p className="text-sm text-black">
                  Waiting for finance to complete the accounts section before you can upload the final invoice.
                </p>
              ) : procSection3Editable ? (
                <>
                  <p className="text-sm text-black/80">
                    Finance has completed payment. Upload the vendor&apos;s final invoice PDF, save it, then send to
                    finance.
                  </p>
                  <InvoiceForm
                    variant="final"
                    indentId={indent.id}
                    purchaseOrders={indent.purchaseOrders}
                    existingInvoice={
                      finalInvoice
                        ? {
                            vendorName: finalInvoice.vendorName,
                            amount: finalInvoice.amount,
                            purchaseOrderId: finalInvoice.purchaseOrderId ?? null,
                            documentId: finalInvoice.documentId ?? null,
                          }
                        : undefined
                    }
                    onDone={refresh}
                  />
                  {finalInvoice?.documentId ? (
                    <Button
                      onClick={async () => {
                        setSendFinalFinanceFeedback(null);
                        const r = await fetch(`/api/indents/${indent.id}/send-final-invoice`, {
                          method: "POST",
                        });
                        const text = await r.text();
                        let j: { error?: string } = {};
                        try {
                          if (text) j = JSON.parse(text) as { error?: string };
                        } catch {
                          setSendFinalFinanceFeedback("Invalid response from server.");
                          return;
                        }
                        if (!r.ok) {
                          setSendFinalFinanceFeedback(j.error ?? `Send failed (${r.status})`);
                          return;
                        }
                        await refresh();
                      }}
                    >
                      Send final invoice to finance
                    </Button>
                  ) : null}
                  {sendFinalFinanceFeedback ? (
                    <p className="text-xs text-black">{sendFinalFinanceFeedback}</p>
                  ) : null}
                </>
              ) : finalInvoice ? (
                <Card className="border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
                  <CardTitle className="text-sm text-black">Final invoice on file</CardTitle>
                  <p className="mt-2 text-sm text-black">
                    {finalInvoice.vendorName}
                    {finalInvoice.amount ? ` · ${finalInvoice.amount}` : ""}
                  </p>
                  {finalInvoice.documentId ? (
                    <Button className="mt-3" variant="outline" size="sm" asChild>
                      <a
                        href={`/api/documents/${finalInvoice.documentId}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download final invoice (PDF)
                      </a>
                    </Button>
                  ) : null}
                </Card>
              ) : (
                <p className="text-sm text-black">Awaiting final invoice upload from procurement.</p>
              )}
            </div>
          </DocumentSection>
        ) : null}

        {indent.currentStatus === "PENDING_FINANCE_FINAL" && isFin ? (
          <DocumentSection
            title="Finance — final invoice review"
            subtitle="Review the vendor's final invoice and close the case."
            defaultOpen
            readOnly={false}
          >
            <FinanceFinalReviewPanel indent={indent} onDone={refresh} />
          </DocumentSection>
        ) : null}

        <DocumentSection
          title="Audit trail"
          subtitle="Immutable activity log (load on demand)."
          defaultOpen={false}
          readOnly
        >
          <AuditPanel indentId={indent.id} />
        </DocumentSection>

        {indent.currentStatus !== "DRAFT" ? (
          <DocumentSection
            title="Case timeline"
            subtitle="Status progression and Team Lead / Director decisions."
            defaultOpen={false}
            readOnly
          >
            <div className="relative space-y-0 border-l border-[var(--color-border)] pl-6">
              {indent.stateHistory.map((h, i) => (
                <div key={i} className="relative pb-6">
                  <div className="absolute -left-[9px] top-1 h-3 w-3 rounded-full bg-black ring-4 ring-white" />
                  <div className="text-xs text-black">{formatStableDateTime(h.createdAt)}</div>
                  <div className="font-medium text-black">{h.toStatus.replace(/_/g, " ")}</div>
                  {h.note && <div className="text-sm text-black">{h.note}</div>}
                </div>
              ))}
            </div>
            <div className="mt-8 space-y-3">
              <h3 className="text-sm font-medium text-black">Decision history</h3>
              {indent.approvalEvents.map((a, i) => (
                <div key={i} className="glass-card rounded-xl p-3 text-sm">
                  <span className="text-black">{formatStableDateTime(a.createdAt)}</span> ·{" "}
                  <span className="font-medium text-black">{a.actor.name}</span> · {a.decision}{" "}
                  <span className="text-black">({a.stage})</span>
                  <p className="mt-1 text-black">{a.remarks}</p>
                </div>
              ))}
              {indent.approvalEvents.length === 0 && (
                <p className="text-sm text-black">No Team Lead or Director decisions recorded yet.</p>
              )}
            </div>
          </DocumentSection>
        ) : null}

        <DocumentSection title="Attachments" subtitle="Supporting files on this case." defaultOpen={false} readOnly>
          <div className="space-y-3">
            {indent.documents.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-black">{d.filename}</div>
                  <div className="text-xs text-black">{d.type}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-black">{formatStableDateTime(d.createdAt)}</span>
                  <a
                    href={`/api/documents/${d.id}/file`}
                    className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Download
                  </a>
                </div>
              </div>
            ))}
            {indent.documents.length === 0 && (
              <p className="text-sm text-black">No documents attached.</p>
            )}
          </div>
        </DocumentSection>
      </ProcurementDocumentFrame>
    </motion.div>
  );
}

function TeamLeadDecisionStamp({
  actor,
  decision,
  remarks,
  when,
}: {
  actor: string;
  decision: string;
  remarks: string;
  when: string;
}) {
  const approved = decision === "APPROVED";
  return (
    <div className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
      <div
        className={
          approved
            ? "pointer-events-none absolute right-4 top-4 select-none whitespace-nowrap text-3xl font-black uppercase tracking-[0.14em] text-black/15"
            : "pointer-events-none absolute right-4 top-4 select-none whitespace-nowrap text-3xl font-black uppercase tracking-[0.14em] text-black/15"
        }
      >
        {approved ? "Approved" : "Rejected"}
      </div>
      <div className="relative space-y-3 text-sm">
        <div className="flex flex-wrap gap-2 text-xs text-black">
          <span>{formatStableDateTime(when)}</span>
          <span>·</span>
          <span className="font-medium text-black">{actor}</span>
        </div>
        <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-semibold text-black">
          Decision: {decision}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-black">Remarks</div>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-black">{remarks}</p>
        </div>
      </div>
    </div>
  );
}

function ApprovalObserverBanner({ actorLabel }: { actorLabel: string }) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-sm text-[var(--color-fg)]"
    >
      <p className="font-medium">View only — {actorLabel} must decide.</p>
      <p className="mt-1 text-[var(--color-muted)]">
        You can observe this approval stage. You do not have permission to approve or reject.
      </p>
    </div>
  );
}

function ApprovalCard({
  title,
  remarks,
  setRemarks,
  onDecision,
  busy = false,
}: {
  title: string;
  remarks: string;
  setRemarks: (s: string) => void;
  onDecision: (d: "APPROVED" | "REJECTED") => Promise<void>;
  busy?: boolean;
}) {
  const [choice, setChoice] = useState<"" | "APPROVED" | "REJECTED">("");
  const [submitting, setSubmitting] = useState(false);
  const remarksId = `remarks-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
      <div className="text-sm font-semibold text-[var(--color-fg)]">{title}</div>
      <div className="space-y-3">
        <Label className="text-[var(--color-fg)]">Decision</Label>
        <div className="flex flex-wrap gap-6 text-sm text-[var(--color-fg)]">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`approval-${title}`}
              className="accent-[var(--color-accent)]"
              checked={choice === "APPROVED"}
              onChange={() => setChoice("APPROVED")}
            />
            Approve
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`approval-${title}`}
              className="accent-[var(--color-accent)]"
              checked={choice === "REJECTED"}
              onChange={() => setChoice("REJECTED")}
            />
            Reject
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={remarksId} className="text-[var(--color-fg)]">
          Remarks (required)
        </Label>
        <textarea
          id={remarksId}
          className="min-h-[100px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-muted)]"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>
      <Button
        disabled={!choice || !remarks.trim() || busy || submitting}
        onClick={async () => {
          if (!choice) return;
          setSubmitting(true);
          try {
            await onDecision(choice);
            setChoice("");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {busy || submitting ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}

function FinanceAccountsSummary({ indent }: { indent: IndentDetail }) {
  const fields: { label: string; value: string | null | undefined }[] = [
    { label: "Budget allocation", value: indent.financeBudgetAllocation },
    { label: "Budget utilized", value: indent.financeBudgetUtilized },
    { label: "Available balance", value: indent.financeAvailableBalance },
    { label: "Funds available?", value: indent.financeFundsAvailable },
    { label: "Account No", value: indent.financeAccountNo },
    { label: "IFSC Code", value: indent.financeIfscCode },
    { label: "Branch Name", value: indent.financeBranchName },
    { label: "Account Holder Name", value: indent.financeAccountHolderName },
    { label: "Remarks", value: indent.financeRemarks },
  ];

  return (
    <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
      <CardTitle className="text-base text-black">Accounts section</CardTitle>
      {indent.financeCompletedAt ? (
        <CardDescription className="text-black/75">
          Completed on {formatStableDateTime(indent.financeCompletedAt)}.
        </CardDescription>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {fields.map(({ label, value }) => (
          <div key={label} className={label === "Remarks" ? "md:col-span-2 lg:col-span-3" : undefined}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-black/70">{label}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-black">{value?.trim() ? value : "—"}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FinanceAccountsPanel({
  indent,
  onDone,
}: {
  indent: IndentDetail;
  onDone: () => Promise<void>;
}) {
  const tlIndent = indent.approvalEvents.find((a) => a.stage === "TEAM_LEADER_INDENT");
  const tlVendor = indent.approvalEvents.find((a) => a.stage === "TEAM_LEADER_VENDOR");
  const director = indent.approvalEvents.find((a) => a.stage === "DIRECTOR_VENDOR");
  const md = indent.approvalEvents.find((a) => a.stage === "MD_VENDOR");
  const poDoc = indent.documents.find((d) => d.type === "PURCHASE_ORDER");
  const proforma = getProformaInvoice(indent.invoices);
  const invDoc = proforma?.documentId
    ? indent.documents.find((d) => d.id === proforma.documentId)
    : indent.documents.find((d) => d.type === "INVOICE");

  const [budgetAllocation, setBudgetAllocation] = useState("");
  const [budgetUtilized, setBudgetUtilized] = useState("");
  const [availableBalance, setAvailableBalance] = useState("");
  const [fundsAvailable, setFundsAvailable] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [branchName, setBranchName] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function row(label: string, ev: (typeof indent.approvalEvents)[0] | undefined) {
    return (
      <div className="grid gap-2 border-b border-black/10 py-2 text-sm sm:grid-cols-[1fr_120px]">
        <div className="font-medium text-black">{label}</div>
        <div className="text-black">
          {ev ? (
            <>
              <span className="font-semibold">{ev.decision}</span>
              <span className="text-black/70"> · {ev.actor.name}</span>
            </>
          ) : (
            <span className="text-black/60">—</span>
          )}
        </div>
      </div>
    );
  }

  const canSubmit =
    budgetAllocation.trim() &&
    budgetUtilized.trim() &&
    availableBalance.trim() &&
    fundsAvailable.trim() &&
    accountNo.trim() &&
    ifscCode.trim() &&
    branchName.trim() &&
    accountHolderName.trim() &&
    remarks.trim();

  return (
    <div className="space-y-6">
      <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
        <CardTitle className="text-base text-black">Approval summary</CardTitle>
        <CardDescription className="text-black/75">Outcome of each approval gate for this case.</CardDescription>
        <div className="mt-4">
          {row("Team Lead — indent request", tlIndent)}
          {row("Team Lead — vendor selection", tlVendor)}
          {row("Director — vendor selection", director)}
          {row("MD — vendor selection", md)}
        </div>
      </Card>

      <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
        <CardTitle className="text-base text-black">Procurement documents</CardTitle>
        <div className="mt-4 flex flex-wrap gap-3">
          {poDoc ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${poDoc.id}/file`} target="_blank" rel="noopener noreferrer">
                Download PO ({poDoc.filename})
              </a>
            </Button>
          ) : (
            <p className="text-sm text-black">No PO document on file.</p>
          )}
          {invDoc ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${invDoc.id}/file`} target="_blank" rel="noopener noreferrer">
                Download proforma ({invDoc.filename})
              </a>
            </Button>
          ) : proforma ? (
            <p className="text-sm text-black">Proforma recorded ({proforma.vendorName}) — document link pending.</p>
          ) : (
            <p className="text-sm text-black">No proforma on file.</p>
          )}
        </div>
      </Card>

      <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
        <CardTitle className="text-base text-black">Accounts section</CardTitle>
        <CardDescription className="text-black/75">
          Case {indent.reference}. Complete all fields, then click Done to close the finance step.
        </CardDescription>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-black">Budget allocation</Label>
            <Input value={budgetAllocation} onChange={(e) => setBudgetAllocation(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-black">Budget utilized</Label>
            <Input value={budgetUtilized} onChange={(e) => setBudgetUtilized(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-black">Available balance</Label>
            <Input value={availableBalance} onChange={(e) => setAvailableBalance(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-black">Funds available?</Label>
            <select
              className="h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-black"
              value={fundsAvailable}
              onChange={(e) => setFundsAvailable(e.target.value)}
            >
              <option value="">Select</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-black">Account No</Label>
            <Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-black">IFSC Code</Label>
            <Input value={ifscCode} onChange={(e) => setIfscCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-black">Branch Name</Label>
            <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-black">Account Holder Name</Label>
            <Input value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-2 lg:col-span-3">
            <Label className="text-black">Remarks</Label>
            <textarea
              className="min-h-[100px] w-full rounded-lg border border-black/15 bg-white p-3 text-sm text-black placeholder:text-black/45"
              placeholder="Enter remarks…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>
        {err ? <p className="mt-3 text-sm text-black">{err}</p> : null}
        <Button
          className="mt-6"
          disabled={!canSubmit || saving}
          onClick={async () => {
            setErr(null);
            setSaving(true);
            try {
              const r = await fetch(`/api/indents/${indent.id}/finance/accounts-complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  budgetAllocation,
                  budgetUtilized,
                  availableBalance,
                  fundsAvailable,
                  accountNo,
                  ifscCode,
                  branchName,
                  accountHolderName,
                  remarks,
                }),
              });
              const text = await r.text();
              let j: { error?: string } = {};
              try {
                if (text) j = JSON.parse(text) as { error?: string };
              } catch {
                setErr("Invalid response from server.");
                return;
              }
              if (!r.ok) {
                setErr(j.error ?? `Request failed (${r.status})`);
                return;
              }
              await onDone();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Done"}
        </Button>
      </Card>
    </div>
  );
}

function FinanceFinalReviewPanel({
  indent,
  onDone,
}: {
  indent: IndentDetail;
  onDone: () => Promise<void>;
}) {
  const proforma = getProformaInvoice(indent.invoices);
  const finalInv = getFinalInvoice(indent.invoices);
  const poDoc = indent.documents.find((d) => d.type === "PURCHASE_ORDER");
  const proformaDoc = proforma?.documentId
    ? indent.documents.find((d) => d.id === proforma.documentId)
    : null;
  const finalDoc = finalInv?.documentId ? indent.documents.find((d) => d.id === finalInv.documentId) : null;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
        <CardTitle className="text-base text-black">Documents</CardTitle>
        <div className="mt-4 flex flex-wrap gap-3">
          {poDoc ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${poDoc.id}/file`} target="_blank" rel="noopener noreferrer">
                Download PO ({poDoc.filename})
              </a>
            </Button>
          ) : null}
          {proformaDoc ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${proformaDoc.id}/file`} target="_blank" rel="noopener noreferrer">
                Download proforma ({proformaDoc.filename})
              </a>
            </Button>
          ) : null}
          {finalDoc ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/documents/${finalDoc.id}/file`} target="_blank" rel="noopener noreferrer">
                Download final invoice ({finalDoc.filename})
              </a>
            </Button>
          ) : (
            <p className="text-sm text-black">Final invoice PDF not found.</p>
          )}
        </div>
        {finalInv ? (
          <p className="mt-4 text-sm text-black">
            {finalInv.vendorName}
            {finalInv.amount ? ` · ${finalInv.amount}` : ""}
          </p>
        ) : null}
      </Card>

      {indent.financeCompletedAt ? (
        <Card className="border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
          <CardTitle className="text-base text-black">Accounts (completed)</CardTitle>
          <p className="mt-2 text-sm text-black">
            Payment recorded on {formatStableDateTime(indent.financeCompletedAt)}.
          </p>
          {indent.financeRemarks ? (
            <p className="mt-2 text-sm text-black">
              <span className="font-medium">Remarks:</span> {indent.financeRemarks}
            </p>
          ) : null}
        </Card>
      ) : null}

      {err ? <p className="text-sm text-black">{err}</p> : null}
      <Button
        disabled={!finalInv?.documentId || saving}
        onClick={async () => {
          setErr(null);
          setSaving(true);
          try {
            const r = await fetch(`/api/indents/${indent.id}/finance/final-complete`, { method: "POST" });
            const text = await r.text();
            let j: { error?: string } = {};
            try {
              if (text) j = JSON.parse(text) as { error?: string };
            } catch {
              setErr("Invalid response from server.");
              return;
            }
            if (!r.ok) {
              setErr(j.error ?? `Request failed (${r.status})`);
              return;
            }
            await onDone();
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Closing…" : "Approve final invoice and close case"}
      </Button>
    </div>
  );
}

function InvoiceForm({
  indentId,
  purchaseOrders,
  existingInvoice,
  onDone,
  variant = "proforma",
}: {
  indentId: string;
  purchaseOrders: { id: string; poNumber: string }[];
  existingInvoice?: {
    vendorName: string;
    amount: unknown;
    purchaseOrderId: string | null;
    documentId: string | null;
  } | null;
  onDone: () => Promise<void>;
  variant?: "proforma" | "final";
}) {
  const isProforma = variant === "proforma";
  const docLabel = isProforma ? "Proforma" : "Final invoice";
  const [vendorName, setVendorName] = useState(existingInvoice?.vendorName ?? "");
  const [amount, setAmount] = useState(
    existingInvoice?.amount != null && existingInvoice.amount !== ""
      ? String(existingInvoice.amount)
      : ""
  );
  const [po, setPo] = useState(
    existingInvoice?.purchaseOrderId ?? purchaseOrders[0]?.id ?? ""
  );
  const [invoiceDocId, setInvoiceDocId] = useState<string | null>(existingInvoice?.documentId ?? null);
  const [invoiceFileLabel, setInvoiceFileLabel] = useState<string | null>(
    existingInvoice?.documentId ? `${docLabel} PDF on file` : null
  );
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [invoiceUploadErr, setInvoiceUploadErr] = useState<string | null>(null);
  const [recordErr, setRecordErr] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!existingInvoice) return;
    setVendorName(existingInvoice.vendorName ?? "");
    setAmount(
      existingInvoice.amount != null && existingInvoice.amount !== ""
        ? String(existingInvoice.amount)
        : ""
    );
    setPo(existingInvoice.purchaseOrderId ?? purchaseOrders[0]?.id ?? "");
    setInvoiceDocId(existingInvoice.documentId ?? null);
    setInvoiceFileLabel(existingInvoice.documentId ? `${docLabel} PDF on file` : null);
  }, [existingInvoice, purchaseOrders, docLabel]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-black">{docLabel} (PDF)</Label>
        <p className="text-xs text-black/75">
          Upload the PDF the vendor sent. It is stored on this indent and linked to the {isProforma ? "proforma" : "final invoice"} record.
        </p>
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={invoiceUploading}
          className="block w-full text-xs text-black/75 file:mr-2 file:rounded file:border file:border-black/15 file:bg-neutral-200 file:px-3 file:py-1.5 file:text-black file:font-medium disabled:opacity-50"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            setInvoiceUploadErr(null);
            if (!f) return;
            const mime = (f.type || "").toLowerCase();
            if (mime !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
              setInvoiceUploadErr("Only PDF files are allowed.");
              return;
            }
            setInvoiceUploading(true);
            try {
              const fd = new FormData();
              fd.set("file", f);
              fd.set("indentId", indentId);
              fd.set("type", DocumentType.INVOICE);
              fd.set("logicalKey", `${isProforma ? "proforma" : "final-invoice"}-${indentId}-${Date.now()}`);
              const r = await fetch("/api/documents/upload", { method: "POST", body: fd });
              const text = await r.text();
              let j: { document?: { id: string }; error?: string } = {};
              try {
                if (text) j = JSON.parse(text) as typeof j;
              } catch {
                setInvoiceUploadErr("Invalid response from server.");
                return;
              }
              if (!r.ok) {
                setInvoiceUploadErr(j.error ?? `Upload failed (${r.status})`);
                return;
              }
              if (j.document?.id) {
                setInvoiceDocId(j.document.id);
                setInvoiceFileLabel(f.name);
              }
            } catch (err) {
              setInvoiceUploadErr(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setInvoiceUploading(false);
            }
          }}
        />
        {invoiceFileLabel ? (
          <p className="text-xs text-black">Attached: {invoiceFileLabel}</p>
        ) : null}
        {invoiceUploadErr ? <p className="text-xs text-black">{invoiceUploadErr}</p> : null}
      </div>
      <Input placeholder={`Vendor name on ${isProforma ? "proforma" : "invoice"}`} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
      <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" />
      <select
        className="h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-black"
        value={po}
        onChange={(e) => setPo(e.target.value)}
      >
        {purchaseOrders.map((p) => (
          <option key={p.id} value={p.id} className="bg-white text-black">
            {p.poNumber}
          </option>
        ))}
      </select>
      {recordErr ? <p className="text-xs text-black">{recordErr}</p> : null}
      <Button
        disabled={!vendorName.trim() || !invoiceDocId || recording}
        onClick={async () => {
          setRecordErr(null);
          setRecording(true);
          try {
            const r = await fetch(`/api/indents/${indentId}/invoice`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                vendorName: vendorName.trim(),
                amount: amount ? Number(amount) : undefined,
                purchaseOrderId: po || undefined,
                documentId: invoiceDocId,
                kind: isProforma ? "PROFORMA" : "FINAL",
              }),
            });
            const text = await r.text();
            let j: { ok?: boolean; error?: string } = {};
            try {
              if (text) j = JSON.parse(text) as typeof j;
            } catch {
              setRecordErr("Invalid response from server.");
              return;
            }
            if (!r.ok) {
              setRecordErr(j.error ?? `Request failed (${r.status})`);
              return;
            }
            await onDone();
          } catch (err) {
            setRecordErr(err instanceof Error ? err.message : "Request failed");
          } finally {
            setRecording(false);
          }
        }}
      >
        {recording ? "Saving…" : isProforma ? "Save proforma" : "Save final invoice"}
      </Button>
    </div>
  );
}

function ManualQuoteUpload({
  indentId,
  vendors,
  onDone,
}: {
  indentId: string;
  vendors: VendorLite[];
  onDone: () => Promise<void>;
}) {
  const [vid, setVid] = useState("");
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (f: File) => {
    if (!vid) {
      setFeedback({ type: "err", text: "Select a vendor before uploading." });
      return;
    }
    const isPdf =
      f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setFeedback({ type: "err", text: "Only PDF quotation files are accepted." });
      return;
    }
    setUploading(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("vendorId", vid);
      const r = await fetch(`/api/indents/${indentId}/quotations/upload`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setFeedback({ type: "err", text: j.error ?? "Upload failed." });
        return;
      }
      setFeedback({ type: "ok", text: "Quotation uploaded." });
      await onDone();
    } catch {
      setFeedback({ type: "err", text: "Upload failed. Please try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void uploadFile(f);
      }}
      className={`space-y-4 rounded-[var(--radius-lg)] border border-dashed p-4 transition-colors ${
        drag
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="manual-quote-vendor" className="normal-case text-[var(--color-fg)]">
            Vendor
          </Label>
          <select
            id="manual-quote-vendor"
            className="h-9 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-doc-inner)] px-2 text-sm text-[var(--color-fg)]"
            value={vid}
            onChange={(e) => setVid(e.target.value)}
          >
            <option value="">Select…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.companyName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="normal-case text-[var(--color-fg)]">Quote file (PDF)</Label>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              await uploadFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Choose file"}
          </Button>
        </div>
      </div>
      {feedback ? (
        <p
          role="alert"
          className={
            feedback.type === "err"
              ? "text-xs text-[var(--color-danger)]"
              : "text-xs text-[var(--color-success)]"
          }
        >
          {feedback.text}
        </p>
      ) : (
        <p className="text-center text-xs text-[var(--color-muted)]">Or drag and drop a PDF quote here</p>
      )}
    </div>
  );
}

function AuditPanel({ indentId }: { indentId: string }) {
  const [logs, setLogs] = useState<{ id: string; action: string; createdAt: string; actor: { name: string } | null }[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/audit?indentId=${indentId}`);
      const d = (await r.json().catch(() => ({}))) as { logs?: typeof logs; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not load audit trail.");
      setLogs(d.logs ?? []);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load audit trail.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Button variant="outline" size="sm" className="mb-3" disabled={loading} onClick={() => void load()}>
        {loading ? "Loading…" : loaded ? "Refresh audit trail" : "Load audit trail"}
      </Button>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {loaded && logs.length === 0 && !error ? (
        <p className="text-sm text-[var(--color-muted)]">No audit events for this case yet.</p>
      ) : null}
      <div className="space-y-2">
        {logs.map((l) => (
          <div
            key={l.id}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]"
          >
            <span className="text-[var(--color-muted)]">{formatStableDateTime(l.createdAt)}</span> ·{" "}
            <span className="font-medium">{l.action}</span> · {l.actor?.name ?? "—"}
          </div>
        ))}
      </div>
    </div>
  );
}
