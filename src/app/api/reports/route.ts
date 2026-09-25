import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser } from "@/lib/server";
import { newId } from "@/lib/session";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const rate = await rateLimit(req, "report-create", user.id, 5, 300);
      if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
      const body = await readBody<{ targetType?: "user" | "post"; targetId?: string; reason?: string }>(req);
      const reason = body.reason?.trim();
      if (!body.targetType || !body.targetId || !reason) return bad("Missing report details.");
      if (reason.length > 1000) return bad("Report reason is too long.", 413);
      if (body.targetType === "user") {
        const { data } = await supabase.from("profiles").select("id").eq("id", body.targetId).maybeSingle();
        if (!data) return bad("User not found.", 404);
      } else {
        const { data } = await supabase.from("posts").select("id").eq("id", body.targetId).maybeSingle();
        if (!data) return bad("Post not found.", 404);
      }
      const { error } = await supabase.from("user_reports").insert({
        reporter_id: user.id,
        target_type: body.targetType,
        target_id: body.targetId,
        reason,
      });
      if (error) return bad("Unable to submit report.", 500);
      return json({ ok: true });
    }
  }

  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const rate = await rateLimit(req, "report-create", me.id, 5, 300);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const body = await readBody<{ targetType?: "user" | "post"; targetId?: string; reason?: string }>(req);

  const reason = body.reason?.trim();
  if (!body.targetType || !body.targetId || !reason) return bad("Missing report details.");
  if (reason.length > 1000) return bad("Report reason is too long.", 413);
  if (body.targetType === "user" && !db.users.some((u) => u.id === body.targetId)) return bad("User not found.", 404);
  if (body.targetType === "post" && !db.posts.some((p) => p.id === body.targetId)) return bad("Post not found.", 404);

  db.reports.push({
    id: newId("rep"),
    reporterId: me.id,
    targetType: body.targetType,
    targetId: body.targetId,
    reason,
    createdAt: new Date().toISOString(),
  });
  await persist(db);
  // Silent handling: the reported party is never notified.
  return json({ ok: true });
}
