import type { Role } from "@/lib/domain-types";
import {
  submitIndent,
  tlDecisionOnIndent,
  tlDecisionOnVendor,
  directorDecision,
  mdDecision,
  createRfqAndMarkSent,
  markQuotesReady,
  submitVendorSelectionToTl,
  sendIndentToFinance,
  sendFinalInvoiceToFinance,
  financeCompleteAccounts,
  financeComplete,
  financeCompleteFinalReview,
  procurementSendVendorProof,
  sendPo,
  recordInvoice,
} from "@/server/workflow/indent-workflow";
import type { ApprovalDecision } from "@/lib/domain-types";

/** Caller of every mutating use case. Routes pass this; they do not own transactions. */
export type ActorSource = "UI" | "JOB" | "COPILOT";
export type ActorContext = { id: string; role: Role; source?: ActorSource };

export const indentUseCases = {
  submit: (actor: ActorContext, indentId: string) => submitIndent(indentId, actor.id),
  tlIndent: (actor: ActorContext, indentId: string, decision: ApprovalDecision, remarks: string) =>
    tlDecisionOnIndent(indentId, actor.id, actor.role, decision, remarks),
  tlVendor: (actor: ActorContext, indentId: string, decision: ApprovalDecision, remarks: string) =>
    tlDecisionOnVendor(indentId, actor.id, actor.role, decision, remarks),
  director: (actor: ActorContext, indentId: string, decision: ApprovalDecision, remarks: string) =>
    directorDecision(indentId, actor.id, actor.role, decision, remarks),
  md: (actor: ActorContext, indentId: string, decision: ApprovalDecision, remarks: string) =>
    mdDecision(indentId, actor.id, actor.role, decision, remarks),
  createRfq: (
    actor: ActorContext,
    indentId: string,
    input: { subject: string; bodyTemplate: string; vendorIds: string[] }
  ) => createRfqAndMarkSent(indentId, actor.id, actor.role, input),
  quotesReady: (actor: ActorContext, indentId: string) => markQuotesReady(indentId, actor.id, actor.role),
  vendorSelection: (
    actor: ActorContext,
    indentId: string,
    input: Parameters<typeof submitVendorSelectionToTl>[3]
  ) => submitVendorSelectionToTl(indentId, actor.id, actor.role, input),
  sendToFinance: (actor: ActorContext, indentId: string) =>
    sendIndentToFinance(indentId, actor.id, actor.role),
  sendFinalInvoice: (actor: ActorContext, indentId: string) =>
    sendFinalInvoiceToFinance(indentId, actor.id, actor.role),
  financeAccounts: (
    actor: ActorContext,
    indentId: string,
    input: Parameters<typeof financeCompleteAccounts>[3]
  ) => financeCompleteAccounts(indentId, actor.id, actor.role, input),
  financeComplete: (actor: ActorContext, indentId: string, proofDocumentId: string) =>
    financeComplete(indentId, actor.id, actor.role, proofDocumentId),
  financeFinal: (actor: ActorContext, indentId: string) =>
    financeCompleteFinalReview(indentId, actor.id, actor.role),
  vendorProof: (actor: ActorContext, indentId: string) =>
    procurementSendVendorProof(indentId, actor.id, actor.role),
  sendPo: (actor: ActorContext, indentId: string, poId: string, gmailMessageId?: string) =>
    sendPo(indentId, actor.id, actor.role, poId, gmailMessageId),
  recordInvoice: (
    actor: ActorContext,
    indentId: string,
    input: Parameters<typeof recordInvoice>[3]
  ) => recordInvoice(indentId, actor.id, actor.role, input),
};
