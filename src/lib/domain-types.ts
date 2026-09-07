export const Role = {
  REQUESTER: "REQUESTER",
  TEAM_LEADER: "TEAM_LEADER",
  PROCUREMENT: "PROCUREMENT",
  DIRECTOR: "DIRECTOR",
  MD: "MD",
  FINANCE: "FINANCE",
  ADMIN: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Guard for role values arriving from the database or a token, so an unknown
 *  role fails closed instead of being cast into the policy layer. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(Role, value);
}

export const IndentStatus = {
  DRAFT: "DRAFT",
  PENDING_TL_INDENT: "PENDING_TL_INDENT",
  REJECTED_TL_INDENT: "REJECTED_TL_INDENT",
  PROCUREMENT_ACTIVE: "PROCUREMENT_ACTIVE",
  RFQ_SENT: "RFQ_SENT",
  AWAITING_QUOTES: "AWAITING_QUOTES",
  QUOTES_READY: "QUOTES_READY",
  PENDING_TL_VENDOR: "PENDING_TL_VENDOR",
  REJECTED_TL_VENDOR: "REJECTED_TL_VENDOR",
  PENDING_DIRECTOR: "PENDING_DIRECTOR",
  REJECTED_DIRECTOR: "REJECTED_DIRECTOR",
  PENDING_MD: "PENDING_MD",
  REJECTED_MD: "REJECTED_MD",
  PROCUREMENT_PO: "PROCUREMENT_PO",
  PO_DRAFT: "PO_DRAFT",
  PO_SENT: "PO_SENT",
  AWAITING_INVOICE: "AWAITING_INVOICE",
  PENDING_FINANCE: "PENDING_FINANCE",
  PAYMENT_DONE: "PAYMENT_DONE",
  PENDING_FINANCE_FINAL: "PENDING_FINANCE_FINAL",
  PAYMENT_PROOF_TO_VENDOR: "PAYMENT_PROOF_TO_VENDOR",
  CLOSED: "CLOSED",
} as const;
export type IndentStatus = (typeof IndentStatus)[keyof typeof IndentStatus];

export const ApprovalStage = {
  TEAM_LEADER_INDENT: "TEAM_LEADER_INDENT",
  TEAM_LEADER_VENDOR: "TEAM_LEADER_VENDOR",
  DIRECTOR_VENDOR: "DIRECTOR_VENDOR",
  MD_VENDOR: "MD_VENDOR",
} as const;
export type ApprovalStage = (typeof ApprovalStage)[keyof typeof ApprovalStage];

export const ApprovalDecision = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const NotificationType = {
  STATUS_CHANGE: "STATUS_CHANGE",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  REJECTION: "REJECTION",
  RFQ_SENT: "RFQ_SENT",
  QUOTE_RECEIVED: "QUOTE_RECEIVED",
  /** Inbound vendor mail detected via Gmail sync (opens linked thread in Gmail). */
  VENDOR_GMAIL: "VENDOR_GMAIL",
  PAYMENT: "PAYMENT",
  SYSTEM: "SYSTEM",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const DocumentType = {
  INDENT_ATTACHMENT: "INDENT_ATTACHMENT",
  QUOTATION: "QUOTATION",
  PURCHASE_ORDER: "PURCHASE_ORDER",
  INVOICE: "INVOICE",
  PAYMENT_PROOF: "PAYMENT_PROOF",
  OTHER: "OTHER",
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const VendorStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING: "PENDING",
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const PaymentStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export type Item = {
  id: string;
  sku: string;
  name: string;
  category: string;
  uom: string;
  specNotes: string | null;
  regulatoryTag: string | null;
};

export type Vendor = {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string | null;
  city: string | null;
  paymentTerms: string;
  rating: number;
  gstNumber: string | null;
  averageDeliveryDays: number;
  status: VendorStatus;
};

export type VendorItem = {
  id: string;
  vendorId: string;
  itemId: string;
};

export type Quotation = {
  id: string;
  indentId: string;
  vendorId: string;
  unitPrice: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  deviations: unknown;
  rawExtractionJson: unknown;
};
