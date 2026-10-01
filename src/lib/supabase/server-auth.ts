import { createClient as createApiClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type SupabaseAuth = { user: User; supabase: SupabaseClient };

/**
 * Resolves identity exclusively from a Supabase session cookie or a verified
 * Bearer access token. Callers must never accept a client-supplied user id.
 */
export async function getSupabaseAuth(request?: Request): Promise<SupabaseAuth | null> {
  const token = request?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const supabase = createApiClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return error || !user ? null : { user, supabase };
  }

  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : { user, supabase };
}

export async function requireSupabaseAuth(request?: Request): Promise<SupabaseAuth> {
  const auth = await getSupabaseAuth(request);
  if (!auth) throw new Error("AUTH_REQUIRED");
  return auth;
}
