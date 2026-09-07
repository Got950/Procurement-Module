/** Gmail treats googlemail.com and dots in local part as aliases — align for comparisons. */
export function canonicalEmailForCompare(raw: string) {
  const s = raw.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at <= 0) return s;
  let local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return s;
}

export function parseFromEmail(fromHeader: string) {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m?.[1] ?? fromHeader).trim().toLowerCase();
}

/** Outgoing RFQ blast from procurement — not a vendor reply. */
export function looksLikeOutboundRfqText(snippet: string, subject: string) {
  const s = `${snippet}\n${subject}`.toLowerCase();
  return (
    s.includes("please provide your best quotation") ||
    (s.includes("dear ") && s.includes("regards") && s.includes("procurement"))
  );
}

export function isGmailSentMessage(labelIds: string[] | null | undefined) {
  return (labelIds ?? []).includes("SENT");
}

/** Inbound vendor quote / reply (not the outbound RFQ template). */
export function looksLikeVendorReplyText(snippet: string, subject: string) {
  if (looksLikeOutboundRfqText(snippet, subject)) return false;
  const s = `${snippet}\n${subject}`.toLowerCase();
  return (
    s.includes("thank you for your enquiry") ||
    s.includes("thank you for your inquiry") ||
    s.includes("dear procurement") ||
    s.includes("quotation details") ||
    s.includes("delivery lead time") ||
    s.includes("lead time:") ||
    s.includes("unit price") ||
    /\bcost\b/.test(s) ||
    s.includes("₹") ||
    s.includes("rs.") ||
    subject.toLowerCase().includes("re:")
  );
}

export function vendorEmailMatches(senderAddr: string, vendorEmails: Set<string>) {
  if (vendorEmails.size === 0) return false;
  const canon = canonicalEmailForCompare(senderAddr);
  for (const v of vendorEmails) {
    if (canonicalEmailForCompare(v) === canon) return true;
  }
  return false;
}

export function gmailThreadOrMessageWebUrl(threadId: string | null | undefined, messageId: string) {
  const id = (threadId && threadId.trim()) || messageId;
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}
