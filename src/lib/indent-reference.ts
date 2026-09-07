/**
 * Display-only preview of the reference the next indent will get. The real
 * value is allocated atomically from `indent_reference_counters` when the indent
 * is created, so this is a hint and may be stale under concurrency.
 */
export function computeNextIndentReference(lastIssued: number, year = new Date().getFullYear()) {
  return `IND-${year}-${String(lastIssued + 1).padStart(4, "0")}`;
}
