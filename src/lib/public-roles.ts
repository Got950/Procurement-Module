import { Role, type Role as RoleType } from "@/lib/domain-types";

/**
 * Roles that may be chosen during public self-registration.
 * ADMIN is intentionally excluded — privilege escalation must be impossible via signup.
 */
export const PUBLIC_REGISTRATION_ROLES = [
  Role.REQUESTER,
  Role.TEAM_LEADER,
  Role.PROCUREMENT,
  Role.FINANCE,
  Role.DIRECTOR,
  Role.MD,
] as const satisfies ReadonlyArray<RoleType>;

export type PublicRegistrationRole = (typeof PUBLIC_REGISTRATION_ROLES)[number];

/** Display labels for the public registration role dropdown (canonical codes unchanged). */
export const PUBLIC_REGISTRATION_ROLE_OPTIONS: ReadonlyArray<{
  code: PublicRegistrationRole;
  label: string;
}> = [
  { code: Role.REQUESTER, label: "Requester" },
  { code: Role.TEAM_LEADER, label: "Team Leader" },
  { code: Role.PROCUREMENT, label: "Procurement" },
  { code: Role.FINANCE, label: "Finance" },
  { code: Role.DIRECTOR, label: "Director" },
  { code: Role.MD, label: "Managing Director" },
];

export function isPublicRegistrationRole(value: unknown): value is PublicRegistrationRole {
  return (
    typeof value === "string" &&
    (PUBLIC_REGISTRATION_ROLES as readonly string[]).includes(value)
  );
}
