import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { ValidationError } from "@/lib/errors";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function uploadsRoot(): string {
  return path.resolve(process.cwd(), "data", "uploads");
}

export function absolutePathForStorage(storagePath: string): string {
  if (storagePath.startsWith("s3://")) {
    throw new ValidationError("S3 objects must be read through the document store");
  }
  const root = uploadsRoot();
  const abs = path.resolve(process.cwd(), storagePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ValidationError("Invalid storage path");
  }
  return abs;
}

function assertIndentId(indentId: string) {
  if (!isUuid(indentId)) {
    throw new ValidationError("Invalid indent id");
  }
}

/** PDF magic bytes. Other types are rejected at this trust boundary (B-43). */
export function assertAllowedUpload(buffer: Buffer, originalName: string) {
  if (!buffer.length) throw new ValidationError("Empty file");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError("File exceeds 10 MB");
  const isPdf = buffer.subarray(0, 5).toString("utf8") === "%PDF-";
  if (!isPdf) {
    throw new ValidationError("Only PDF files are accepted");
  }
  if (!originalName.toLowerCase().endsWith(".pdf")) {
    throw new ValidationError("Only PDF files are accepted");
  }
}

/**
 * Basename-only, path/quote/CRLF-safe filename for Content-Disposition headers.
 */
export function sanitizeContentDispositionFilename(name: string): string {
  const base = String(name || "")
    .split(/[/\\]/)
    .pop()
    ?.replace(/^\.+/, "") || "download";
  const cleaned = base
    .replace(/[\r\n\0"]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .slice(0, 180)
    .trim();
  return cleaned || "download";
}

/**
 * PDF upload/download display names — always end in .pdf after sanitization.
 */
export function sanitizeDownloadFilename(name: string): string {
  const cleaned = sanitizeContentDispositionFilename(name);
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "file"}.pdf`;
}

/** RFC 6266 / 5987 Content-Disposition. */
export function contentDispositionAttachment(
  filename: string,
  opts?: { requirePdf?: boolean }
): string {
  const safe =
    opts?.requirePdf === false
      ? sanitizeContentDispositionFilename(filename)
      : sanitizeDownloadFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function contentHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export type S3Port = {
  put: (bucket: string, key: string, body: Buffer) => Promise<void>;
  get: (bucket: string, key: string) => Promise<Buffer>;
};

let testS3: S3Port | null = null;

/** Tests inject an in-memory bucket. Production uses the AWS SDK when S3_BUCKET is set. */
export function setS3PortForTests(port: S3Port | null) {
  testS3 = port;
}

export function parseS3Url(storagePath: string): { bucket: string; key: string } {
  const without = storagePath.slice("s3://".length);
  const slash = without.indexOf("/");
  if (slash <= 0) throw new ValidationError("Invalid S3 URI");
  const bucket = without.slice(0, slash);
  const key = without.slice(slash + 1);
  if (!bucket || !key || key.includes("..")) throw new ValidationError("Invalid S3 key");
  return { bucket, key };
}

async function liveS3(): Promise<S3Port> {
  if (testS3) return testS3;
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  return {
    async put(bucket, key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/pdf",
          ServerSideEncryption: "AES256",
        })
      );
    },
    async get(bucket, key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await out.Body?.transformToByteArray();
      if (!bytes) throw new ValidationError("Empty S3 object");
      return Buffer.from(bytes);
    },
  };
}

function localPathForS3Key(key: string) {
  return path.join("data", "uploads", key);
}

export async function saveUploadedFile(
  indentId: string,
  buffer: Buffer,
  originalName: string
): Promise<{ storagePath: string; filename: string; hash: string; size: number }> {
  assertIndentId(indentId);
  assertAllowedUpload(buffer, originalName);
  const hash = contentHash(buffer);
  const displayName = sanitizeDownloadFilename(originalName);
  const safe = displayName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  const filename = `${randomUUID()}-${safe || "file.pdf"}`;
  const key = `indents/${indentId}/${filename}`;
  const bucket = process.env.S3_BUCKET?.trim();
  if (bucket) {
    const s3 = await liveS3();
    await s3.put(bucket, key, buffer);
    // Optional local mirror for single-host lab only. ECS/Fargate tasks have
    // ephemeral disks — dual-write wastes space and causes false hash mismatches.
    if (process.env.DOCUMENT_LOCAL_CACHE === "1") {
      const local = localPathForS3Key(key);
      const abs = absolutePathForStorage(local);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, buffer);
    }
    return {
      storagePath: `s3://${bucket}/${key}`,
      filename: displayName,
      hash,
      size: buffer.length,
    };
  }
  const storagePath = path.join("data", "uploads", indentId, filename);
  const abs = absolutePathForStorage(storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return { storagePath, filename: displayName, hash, size: buffer.length };
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  if (storagePath.startsWith("s3://")) {
    const { bucket, key } = parseS3Url(storagePath);
    try {
      const s3 = await liveS3();
      return await s3.get(bucket, key);
    } catch (e) {
      // Migration / lab fallback when an object was dual-written locally.
      try {
        return await readFile(absolutePathForStorage(localPathForS3Key(key)));
      } catch {
        throw e;
      }
    }
  }
  return readFile(absolutePathForStorage(storagePath));
}
