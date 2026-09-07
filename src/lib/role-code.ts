/** Turn a display role name into a stable DB code (e.g. "Team Leader" ? TEAM_LEADER). */
export function roleCodeFromLabel(label: string): string {
  const code = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || "ROLE";
}
