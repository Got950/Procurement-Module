import { query } from "@/lib/db";
import { readStoredFile, contentHash } from "@/server/document-store";

/** Load plain text from a stored quotation document (PDF or text). Persists when documentId given (B-58). */
export async function readQuotationDocumentText(
  storagePath: string,
  mimeType: string,
  document?: {
    id?: string;
    extractedText?: string | null;
    extractedHash?: string | null;
    contentHash?: string | null;
  }
): Promise<string> {
  if (
    document?.extractedText &&
    document.extractedHash &&
    document.contentHash &&
    document.extractedHash === document.contentHash
  ) {
    return document.extractedText;
  }
  const buf = await readStoredFile(storagePath);
  let text: string;
  if (mimeType.includes("pdf")) {
    const pdf = (await import("pdf-parse")).default;
    const parsed = await pdf(buf);
    text = (parsed.text ?? "").trim();
  } else {
    text = buf.toString("utf8").trim().slice(0, 50000);
  }
  if (document?.id) {
    const hash = document.contentHash ?? contentHash(buf);
    await query(
      `UPDATE documents SET extracted_text = $2, extracted_hash = $3 WHERE id = $1`,
      [document.id, text.slice(0, 200_000), hash]
    );
  }
  return text;
}
