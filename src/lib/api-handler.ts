import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { getSession, type SessionPayload } from "@/lib/session";
import { toErrorResponse, ValidationError, RateLimitError, UnauthorizedError } from "@/lib/errors";
import {
  newCorrelationId,
  withRequestContext,
  type RequestSource,
} from "@/lib/logger";
import { consumeRateLimit, defaultMutateRateLimit } from "@/lib/rate-limit";
import { beginIdempotency, finishIdempotency, hashRequest } from "@/lib/idempotency";

export type ApiHandlerCtx<P, Q, B> = {
  req: Request;
  session: SessionPayload | null;
  params: P;
  query: Q;
  body: B;
  correlationId: string;
};

type Options<P, Q, B> = {
  auth?: boolean;
  idempotent?: boolean;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B> | false;
  rateLimit?: { limit: number; windowMs: number } | false;
  /** Audit provenance for this route. Defaults to UI; Copilot routes set COPILOT. */
  auditSource?: RequestSource;
  /**
   * Runs after session authentication and before Zod body/query parsing so
   * unauthorized callers never receive schema/validation details.
   */
  authorize?: (session: SessionPayload) => void | Promise<void>;
};

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function withWrapped<T extends (...args: never[]) => unknown>(fn: T): T & { __wrapped: true } {
  const out = fn as T & { __wrapped: true };
  out.__wrapped = true;
  return out;
}

export function withApiHandler<P = Record<string, string>, Q = Record<string, never>, B = unknown>(
  options: Options<P, Q, B> = {}
) {
  const auth = options.auth !== false;
  return (
    handler: (ctx: ApiHandlerCtx<P, Q, B>) => Promise<Response>
  ): ((
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> }
  ) => Promise<Response>) & { __wrapped: true } => {
    return withWrapped(async (req: Request, routeCtx?: { params: Promise<Record<string, string>> }) => {
      const correlationId =
        req.headers.get("x-correlation-id") ||
        req.headers.get("x-request-id") ||
        newCorrelationId();
      return withRequestContext(
        { correlationId, source: options.auditSource ?? "UI" },
        async () => {
        const respond = (res: Response) => {
          const copy = new Response(res.body, res);
          copy.headers.set("x-correlation-id", correlationId);
          return copy;
        };
        const fail = (error: unknown) => {
          const mapped = toErrorResponse(error);
          return NextResponse.json(mapped.body, {
            status: mapped.status,
            headers: { "x-correlation-id": correlationId, ...(mapped.headers ?? {}) },
          });
        };
        try {
          const method = req.method.toUpperCase();
          if (options.rateLimit !== false && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            const rl = options.rateLimit ?? defaultMutateRateLimit();
            // Separate buckets by route prefix so Copilot/auth caps do not
            // starve ordinary indent/vendor mutations under shared-NAT staging.
            const path = new URL(req.url).pathname;
            const bucket =
              path.startsWith("/api/copilot/")
                ? "copilot"
                : path.startsWith("/api/auth/")
                  ? "auth"
                  : path.startsWith("/api/session")
                    ? "session"
                    : "mutate";
            const hit = consumeRateLimit(
              `${bucket}:${clientIp(req)}`,
              rl.limit,
              rl.windowMs
            );
            if (!hit.ok) throw new RateLimitError("Too many requests", hit.retryAfterSec);
          }

          const session = await getSession();
          if (auth && !session) throw new UnauthorizedError();
          if (options.authorize) {
            if (!session) throw new UnauthorizedError();
            await options.authorize(session);
          }

          const rawParams = routeCtx?.params ? await routeCtx.params : {};
          const params = (options.params ? options.params.parse(rawParams) : rawParams) as P;
          const url = new URL(req.url);
          const queryObj = Object.fromEntries(url.searchParams.entries());
          const query = (options.query ? options.query.parse(queryObj) : {}) as Q;

          let body = undefined as B;
          if (options.body !== false && ["POST", "PUT", "PATCH"].includes(method)) {
            const ct = req.headers.get("content-type") ?? "";
            if (ct.includes("application/json")) {
              const raw = await req.json().catch(() => {
                throw new ValidationError("Invalid JSON");
              });
              body = (options.body ? options.body.parse(raw) : raw) as B;
            } else if (options.body) {
              throw new ValidationError("JSON body required");
            }
          }

          const idemKey = options.idempotent ? req.headers.get("idempotency-key")?.trim() : null;
          const route = url.pathname;
          if (idemKey) {
            if (idemKey.length > 128) throw new ValidationError("Idempotency-Key too long");
            const requestHash = hashRequest({ params, query, body });
            const gate = await beginIdempotency({
              key: idemKey,
              route,
              actorId: session?.sub ?? "anon",
              requestHash,
            });
            if (gate !== "acquired" && gate.replay) {
              return respond(
                NextResponse.json(gate.replay.json, {
                  status: gate.replay.status,
                  headers: { "Idempotency-Replayed": "1" },
                })
              );
            }
            try {
              const res = await handler({ req, session, params, query, body, correlationId });
              const json = await res.clone().json().catch(() => ({}));
              await finishIdempotency({ key: idemKey, route, status: res.status, json });
              return respond(res);
            } catch (e) {
              const mapped = toErrorResponse(e);
              await finishIdempotency({
                key: idemKey,
                route,
                status: mapped.status,
                json: mapped.body,
              });
              return fail(e);
            }
          }

          return respond(await handler({ req, session, params, query, body, correlationId }));
        } catch (e) {
          if (e instanceof ZodError) {
            return fail(new ValidationError("Invalid input", e.flatten()));
          }
          return fail(e);
        }
      }
      );
    });
  };
}
