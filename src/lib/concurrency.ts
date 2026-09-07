import { RateLimitError } from "@/lib/errors";

/**
 * In-process concurrency gates for expensive work (Copilot LLM turns, PDF
 * generation). Caps protect a small staging host from one burst exhausting
 * RAM/CPU; they are not a substitute for horizontal scaling.
 */
type Gate = { active: number; max: number };

const gates = new Map<string, Gate>();

function parseMax(envName: string, fallback: number) {
  const raw = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(64, Math.trunc(raw));
}

function getGate(name: string, envName: string, fallback: number): Gate {
  const existing = gates.get(name);
  const max = parseMax(envName, fallback);
  if (existing) {
    existing.max = max;
    return existing;
  }
  const gate: Gate = { active: 0, max };
  gates.set(name, gate);
  return gate;
}

export async function withConcurrencyGate<T>(
  name: string,
  envName: string,
  fallbackMax: number,
  fn: () => Promise<T>,
  busyMessage = "Server is busy. Please retry shortly."
): Promise<T> {
  const gate = getGate(name, envName, fallbackMax);
  if (gate.active >= gate.max) {
    throw new RateLimitError(busyMessage, 5);
  }
  gate.active += 1;
  try {
    return await fn();
  } finally {
    gate.active = Math.max(0, gate.active - 1);
  }
}

/** Test-only. */
export function resetConcurrencyGates() {
  gates.clear();
}
