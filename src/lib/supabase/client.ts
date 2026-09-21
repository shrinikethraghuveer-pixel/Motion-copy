import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (singleton per browser tab).
 * Reads NEXT_PUBLIC_* env vars, so it is safe for client components.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
