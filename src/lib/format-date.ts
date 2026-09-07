/** Stable across SSR/CSR to avoid hydration mismatch. */
export function formatStableDateTime(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Display datetime without timezone suffix (e.g. for document headers). */
export function formatDisplayDateTime(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toISOString().replace("T", " ").slice(0, 19);
}
