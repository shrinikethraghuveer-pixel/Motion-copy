import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { readBody, requireUser } from "@/lib/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { readDB, writeDB } from "@/lib/db";

type AdminContext =
  | { mode: "supabase"; userId: string }
  | { mode: "local"; userId: string }
  | { mode: "denied"; status: 401 | 403 };

async function getAdminContext(): Promise<AdminContext> {
  // Audit P0-3: when Supabase is configured, admin authorization requires a
  // VERIFIED Supabase identity. Legacy local-store identity (whose email is
  // display data the account controls) can never mint an admin here — so a
  // user cannot self-assign an admin email and escalate.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return isAdminEmail(user.email) ? { mode: "supabase", userId: user.id } : { mode: "denied", status: 403 };
    return { mode: "denied", status: 401 };
  }

  // Supabase is not configured (local-only deployment): operator-managed
  // legacy admins remain supported. Emails can only be installed by editing
  // the data store directly — no API can set or change an email.
  const auth = await requireUser();
  if ("res" in auth) return { mode: "denied", status: 401 };
  const current = await getCurrentUser();
  const email = current?.email ?? auth.me.email;
  if (!isAdminEmail(email)) return { mode: "denied", status: 403 };
  return { mode: "local", userId: auth.me.id };
}

function denied(context: Extract<AdminContext, { mode: "denied" }>) {
  return NextResponse.json({ error: context.status === 401 ? "Sign in required." : "Admin access required." }, { status: context.status });
}

function storageObjectFromUrl(rawUrl: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(rawUrl);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || url.origin !== new URL(supabaseUrl).origin) return null;
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return ["avatars", "banners", "post-media"].includes(bucket) && path ? { bucket, path } : null;
  } catch {
    return null;
  }
}

/**
 * Audit P2 residual: reported media URLs are stored values that predate URL
 * validation. They are rendered as clickable links in the staff queue, so
 * anything that is not a plain https link is stripped from the response
 * (the raw value stays in the DB for moderation tooling that uses it).
 */
function safeReportMediaUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !/^https:\/\//i.test(rawUrl.trim())) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.username || parsed.password ? null : parsed.toString();
  } catch {
    return null;
  }
}

async function removeStorageUrl(admin: ReturnType<typeof createAdminClient>, url: string | null | undefined) {
  if (!url) return;
  const object = storageObjectFromUrl(url);
  if (!object) return;
  const { error } = await admin.storage.from(object.bucket).remove([object.path]);
  if (error) throw new Error(error.message);
}

async function markReport(admin: ReturnType<typeof createAdminClient>, reportId: string, status: "dismissed" | "actioned", reviewerId: string) {
  const { error } = await admin.from("user_reports").update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewerId,
  }).eq("id", reportId);
  return error;
}

export async function GET() {
  const context = await getAdminContext();
  if (context.mode === "denied") return denied(context);

  if (context.mode === "local") {
    const db = await readDB();
    // Bounded queue (audit P8): mirror the Supabase mode's 100-report cap.
    const reports = db.reports
      .slice()
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 100)
      .map((report) => {
        const post = report.targetType === "post" ? db.posts.find((item) => item.id === report.targetId) : null;
        const target = report.targetType === "user" ? db.users.find((item) => item.id === report.targetId) : null;
        const reporter = db.users.find((item) => item.id === report.reporterId);
        const postAuthor = post ? db.users.find((item) => item.id === post.authorId) : null;
        return {
          id: report.id,
          targetType: report.targetType,
          targetId: report.targetId,
          reason: report.reason,
          status: "pending",
          createdAt: report.createdAt,
          reporter: reporter?.handle ?? "unknown",
          target: target ? { handle: target.handle, name: target.name, userId: target.id } : post ? { handle: postAuthor?.handle ?? "unknown", name: postAuthor?.name ?? "Unknown user", userId: post.authorId, text: post.text, mediaUrl: null } : null,
        };
      });
    return NextResponse.json({ reports });
  }

  if (!hasAdminClientConfig()) return NextResponse.json({ error: "Admin service access is not configured." }, { status: 503 });
  const admin = createAdminClient();
  const { data: reports, error } = await admin.from("user_reports").select("id,reporter_id,target_type,target_id,reason,status,created_at")
    .eq("status", "pending").order("created_at", { ascending: true }).limit(100);
  if (error) return NextResponse.json({ error: "Unable to load moderation queue." }, { status: 500 });

  const postIds = reports.filter((item) => item.target_type === "post").map((item) => item.target_id);
  const userIds = reports.filter((item) => item.target_type === "user").map((item) => item.target_id);
  const reporterIds = reports.map((item) => item.reporter_id);
  const [postsRes, targetsRes, reportersRes] = await Promise.all([
    postIds.length ? admin.from("posts").select("id,user_id,content,media_url").in("id", postIds) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from("profiles").select("id,username,display_name,avatar_url,banner_url,cover_url").in("id", userIds) : Promise.resolve({ data: [] }),
    reporterIds.length ? admin.from("profiles").select("id,username").in("id", reporterIds) : Promise.resolve({ data: [] }),
  ]);
  const posts = postsRes.data ?? [];
  const targets = targetsRes.data ?? [];
  const reporters = reportersRes.data ?? [];
  const authorIds = [...new Set(posts.map((post) => post.user_id))];
  const { data: authors } = authorIds.length ? await admin.from("profiles").select("id,username,display_name").in("id", authorIds) : { data: [] };

  return NextResponse.json({ reports: reports.map((report) => {
    const post = posts.find((item) => item.id === report.target_id);
    const target = targets.find((item) => item.id === report.target_id);
    const author = post ? authors?.find((item) => item.id === post.user_id) : null;
    const reporter = reporters.find((item) => item.id === report.reporter_id);
    return {
      id: report.id,
      targetType: report.target_type,
      targetId: report.target_id,
      reason: report.reason,
      status: report.status,
      createdAt: report.created_at,
      reporter: reporter?.username ?? "unknown",
      target: target ? { handle: target.username, name: target.display_name ?? target.username, userId: target.id, mediaUrl: safeReportMediaUrl(target.avatar_url), bannerUrl: safeReportMediaUrl(target.banner_url ?? target.cover_url) }
        : post ? { handle: author?.username ?? "unknown", name: author?.display_name ?? author?.username ?? "Unknown user", userId: post.user_id, text: post.content, mediaUrl: safeReportMediaUrl(post.media_url) }
          : null,
    };
  }) });
}

export async function PATCH(request: NextRequest) {
  const context = await getAdminContext();
  if (context.mode === "denied") return denied(context);
  // Defense in depth: admin writes mutate content/accounts; bound the rate
  // even though the caller is staff.
  const adminRate = await rateLimit(request, "admin-action", context.userId, 30, 60);
  if (!adminRate.allowed) return rateLimitResponse(adminRate.retryAfter);
  const body = await readBody<{ reportId?: string; action?: "dismiss" | "remove_media" | "remove_content" | "suspend_user" | "delete_user" }>(request);
  if (!body.reportId || !body.action) return NextResponse.json({ error: "Missing report action." }, { status: 400 });

  if (context.mode === "local") {
    const db = await readDB();
    const report = db.reports.find((item) => item.id === body.reportId);
    if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    if (body.action === "dismiss") {
      db.reports = db.reports.filter((item) => item.id !== report.id);
    } else if (body.action === "remove_content" && report.targetType === "post") {
      db.posts = db.posts.filter((item) => item.id !== report.targetId);
      db.reports = db.reports.filter((item) => item.id !== report.id);
    } else if (body.action === "suspend_user" || body.action === "delete_user") {
      const targetId = report.targetType === "user" ? report.targetId : db.posts.find((item) => item.id === report.targetId)?.authorId;
      const target = db.users.find((item) => item.id === targetId);
      if (!target) return NextResponse.json({ error: "Reported user not found." }, { status: 404 });
      if (body.action === "suspend_user") target.deactivatedAt = new Date().toISOString();
      else {
        db.users = db.users.filter((item) => item.id !== target.id);
        db.posts = db.posts.filter((item) => item.authorId !== target.id);
        db.chats = db.chats.filter((item) => !item.participantIds.includes(target.id));
        db.connections = db.connections.filter((item) => item.requesterId !== target.id && item.targetId !== target.id);
      }
      db.reports = db.reports.filter((item) => item.id !== report.id);
    } else {
      return NextResponse.json({ error: "That action is unavailable for this report." }, { status: 400 });
    }
    await writeDB(db);
    return NextResponse.json({ ok: true });
  }

  if (!hasAdminClientConfig()) return NextResponse.json({ error: "Admin service access is not configured." }, { status: 503 });
  const admin = createAdminClient();
  const { data: report, error: reportError } = await admin.from("user_reports").select("*").eq("id", body.reportId).maybeSingle();
  if (reportError || !report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  if (body.action === "dismiss") {
    const error = await markReport(admin, report.id, "dismissed", context.userId);
    if (error) return NextResponse.json({ error: "Unable to update report." }, { status: 500 });
  } else if (body.action === "remove_media") {
    if (report.target_type === "post") {
      const { data: post } = await admin.from("posts").select("media_url").eq("id", report.target_id).maybeSingle();
      if (!post?.media_url) return NextResponse.json({ error: "No media is attached to this post." }, { status: 400 });
      await removeStorageUrl(admin, post.media_url);
      const { error } = await admin.from("posts").update({ media_url: null }).eq("id", report.target_id);
      if (error) return NextResponse.json({ error: "Media was removed from storage but the post could not be updated." }, { status: 500 });
    } else {
      const { data: profile } = await admin.from("profiles").select("avatar_url,banner_url,cover_url").eq("id", report.target_id).maybeSingle();
      if (!profile) return NextResponse.json({ error: "Reported user not found." }, { status: 404 });
      await Promise.all([removeStorageUrl(admin, profile.avatar_url), removeStorageUrl(admin, profile.banner_url ?? profile.cover_url)]);
      const { error } = await admin.from("profiles").update({ avatar_url: null, banner_url: null, cover_url: null }).eq("id", report.target_id);
      if (error) return NextResponse.json({ error: "Media was removed from storage but the profile could not be updated." }, { status: 500 });
    }
    const statusError = await markReport(admin, report.id, "actioned", context.userId);
    if (statusError) return NextResponse.json({ error: "Media was removed but the report status could not be updated." }, { status: 500 });
  } else if (body.action === "remove_content" && report.target_type === "post") {
    const { data: post } = await admin.from("posts").select("media_url").eq("id", report.target_id).maybeSingle();
    if (post?.media_url) await removeStorageUrl(admin, post.media_url);
    const { error } = await admin.from("posts").delete().eq("id", report.target_id);
    if (error) return NextResponse.json({ error: "Unable to remove reported post." }, { status: 500 });
    const statusError = await markReport(admin, report.id, "actioned", context.userId);
    if (statusError) return NextResponse.json({ error: "Post was removed but the report status could not be updated." }, { status: 500 });
  } else if (body.action === "suspend_user" || body.action === "delete_user") {
    let userId = report.target_id;
    if (report.target_type === "post") {
      const { data: post } = await admin.from("posts").select("user_id").eq("id", report.target_id).maybeSingle();
      if (!post?.user_id) return NextResponse.json({ error: "Reported account could not be found." }, { status: 404 });
      userId = post.user_id;
    }
    if (body.action === "suspend_user") {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "720h" });
      if (error) return NextResponse.json({ error: "Unable to suspend this account." }, { status: 500 });
      await admin.from("profiles").update({ is_deactivated: true }).eq("id", userId);
    } else {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return NextResponse.json({ error: "Unable to delete this account." }, { status: 500 });
    }
    const statusError = await markReport(admin, report.id, "actioned", context.userId);
    if (statusError) return NextResponse.json({ error: "Account action succeeded but the report status could not be updated." }, { status: 500 });
  } else {
    return NextResponse.json({ error: "That action is unavailable for this report." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
