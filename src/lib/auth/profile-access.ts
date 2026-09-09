export type ProfileAccess = "missing" | "inactive" | "invalid_role" | "allowed";

/** Treat database values as runtime data, including unknown future roles. */
export function getProfileAccess(
  profile: { active: unknown; role: unknown } | null | undefined,
): ProfileAccess {
  if (!profile) return "missing";
  if (profile.active !== true) return "inactive";
  if (profile.role !== "admin" && profile.role !== "client") return "invalid_role";
  return "allowed";
}
