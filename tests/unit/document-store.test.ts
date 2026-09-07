import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  absolutePathForStorage,
  assertAllowedUpload,
  contentDispositionAttachment,
  isUuid,
  sanitizeDownloadFilename,
} from "@/server/document-store";

describe("document storage paths", () => {
  it("accepts a UUID indent id and rejects traversal payloads", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
    expect(isUuid("../../../.next/server")).toBe(false);
    expect(isUuid("foo/bar")).toBe(false);
  });

  it("refuses a storage path that leaves the uploads root", () => {
    expect(() => absolutePathForStorage("data/uploads/../../../etc/passwd")).toThrow(
      ValidationError
    );
  });

  it("rejects a non-PDF upload", () => {
    expect(() => assertAllowedUpload(Buffer.from("hello"), "note.txt")).toThrow(/PDF/);
    expect(() => assertAllowedUpload(Buffer.from("%PDF-1.4\n"), "quote.pdf")).not.toThrow();
  });
});

describe("download filename sanitization (SEC-003)", () => {
  it("strips path traversal and quotes from stored names", () => {
    expect(sanitizeDownloadFilename("../../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeDownloadFilename('evil"name.pdf')).toBe("evilname.pdf");
    expect(sanitizeDownloadFilename("ok report.pdf")).toBe("ok report.pdf");
    expect(sanitizeDownloadFilename("..\\..\\windows\\file.pdf")).toBe("file.pdf");
  });

  it("emits a safe Content-Disposition header", () => {
    const header = contentDispositionAttachment("../../../etc/passwd.pdf");
    expect(header).not.toMatch(/\.\.\//);
    expect(header).toContain('filename="passwd.pdf"');
    expect(header).toContain("filename*=UTF-8''");
  });
});
