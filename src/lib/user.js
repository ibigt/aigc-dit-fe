export function normalizeUser(profile) {
  if (!profile) return null;
  const name = profile.name || profile.account || "用户";
  const credits = Number(profile.creditBalance ?? profile.credits ?? 0);
  return {
    ...profile,
    name,
    credits,
    creditBalance: credits,
    isAdmin: profile.isAdmin === true || profile.admin === true,
    role: profile.roleLabel || profile.role || "创作者",
  };
}
