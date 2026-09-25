export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const configured = (process.env.MOTION_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  return configured.includes(email.trim().toLocaleLowerCase());
}
