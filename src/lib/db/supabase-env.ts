/**
 * True when Supabase env vars are present — shared feature-detection for
 * client components that fall back to the legacy JSON-store APIs.
 */
export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
