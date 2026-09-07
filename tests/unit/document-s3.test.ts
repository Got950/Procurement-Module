import { afterEach, describe, expect, it } from "vitest";
import {
  saveUploadedFile,
  readStoredFile,
  setS3PortForTests,
  contentHash,
} from "@/server/document-store";

describe("S3 document store", () => {
  afterEach(() => {
    setS3PortForTests(null);
    delete process.env.S3_BUCKET;
  });

  it("writes and reads through an injected S3 port without requiring local cache", async () => {
    const store = new Map<string, Buffer>();
    setS3PortForTests({
      async put(bucket, key, body) {
        store.set(`${bucket}/${key}`, body);
      },
      async get(bucket, key) {
        const v = store.get(`${bucket}/${key}`);
        if (!v) throw new Error("missing");
        return v;
      },
    });
    process.env.S3_BUCKET = "test-bucket";
    const indentId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const pdf = Buffer.from("%PDF-1.4\ntest");
    const saved = await saveUploadedFile(indentId, pdf, "quote.pdf");
    expect(saved.storagePath.startsWith("s3://test-bucket/")).toBe(true);
    expect(saved.hash).toBe(contentHash(pdf));
    const read = await readStoredFile(saved.storagePath);
    expect(contentHash(read)).toBe(saved.hash);
  });
});
