import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

type LogFields = Record<string, unknown>;

/** Who initiated the unit of work — stored on audit_logs.source. */
export type RequestSource = "UI" | "JOB" | "COPILOT";

type RequestStore = {
  correlationId: string;
  source?: RequestSource;
};

const REDACT = new Set([
  "password",
  "password_hash",
  "passwordHash",
  "refresh_enc",
  "refreshEnc",
  "refreshToken",
  "refresh_token",
  "authorization",
  "cookie",
  "cookies",
  "token",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "session",
  "sessionId",
  "session_id",
  "jti",
  "secret",
  "clientSecret",
  "client_secret",
  "finance_account_no",
  "financeAccountNo",
  "finance_ifsc_code",
  "financeIfscCode",
]);

const als = new AsyncLocalStorage<RequestStore>();

export function getCorrelationId() {
  return als.getStore()?.correlationId;
}

export function getRequestSource(): RequestSource | undefined {
  return als.getStore()?.source;
}

/** Correlation only; preserves any parent request source. */
export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  const parent = als.getStore();
  return als.run({ correlationId, source: parent?.source }, fn);
}

/** Full request context for audit provenance (UI / JOB / COPILOT). */
export function withRequestContext<T>(
  ctx: { correlationId: string; source: RequestSource },
  fn: () => T
): T {
  return als.run(ctx, fn);
}

export function newCorrelationId(incoming?: string | null) {
  const id = incoming?.trim();
  return id && id.length <= 128 ? id : randomUUID();
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as LogFields)) {
    out[k] = REDACT.has(k) ? "[redacted]" : redact(v);
  }
  return out;
}

/** Exported for unit tests of redaction coverage (SEC-010). */
export function redactLogFields(fields: LogFields) {
  return redact(fields) as LogFields;
}

function emit(level: string, msg: string, fields?: LogFields) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    correlationId: getCorrelationId(),
    ...((redact(fields) as LogFields) ?? {}),
  };
  const encoded = JSON.stringify(line);
  if (level === "error") console.error(encoded);
  else console.log(encoded);
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
