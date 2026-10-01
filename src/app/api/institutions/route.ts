import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type InstitutionRow = { id: string; name: string; city?: string | null; state?: string | null; institution_name?: string; institution_city?: string | null; institution_state?: string | null };

/** Read-only, bounded institution lookup backed by the Supabase search RPC. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ institutions: [] });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to search institutions." }, { status: 401 });
  const { data, error } = await supabase.rpc("search_institutions", { search_text: query, result_limit: 8 });
  if (error) return NextResponse.json({ error: "Institution search is unavailable." }, { status: 500 });
  const institutions = ((data ?? []) as InstitutionRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? row.institution_name ?? "",
    city: row.city ?? row.institution_city ?? null,
    state: row.state ?? row.institution_state ?? null,
  })).filter((row) => row.id && row.name);
  return NextResponse.json({ institutions });
}
