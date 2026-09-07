import { sanitizeVendorText } from "@/server/openai/quotation-ai";

const OPEN = "<<<UNTRUSTED_DATA";
const CLOSE = "UNTRUSTED_DATA>>>";

/**
 * Vendor e-mail, quotation and document text is data the Copilot may quote, not
 * instructions it may follow. Everything that originates outside the
 * application goes through here before it can reach the model: known
 * instruction patterns are neutralised by `sanitizeVendorText`, and the
 * delimiters themselves are stripped from the payload so external text cannot
 * close the block and continue as if it were a system instruction.
 */
export function wrapUntrusted(source: string, text: string, maxChars = 3000): string {
  const stripped = String(text ?? "")
    .replace(/<<<+/g, "<")
    .replace(/>>>+/g, ">")
    .replace(/UNTRUSTED_DATA/gi, "untrusted_data");
  const safe = sanitizeVendorText(stripped).slice(0, maxChars);
  return `${OPEN} source=${source.replace(/[^\w.:@-]/g, "_")}\n${safe}\n${CLOSE}`;
}

/** True when a serialised tool result carries external content. */
export function containsUntrusted(serialized: string) {
  return serialized.includes(OPEN);
}
