import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { bad, json, persist, readBody, requireUser, withSettings } from "@/lib/server";
import { clearSession, getSessionToken, newId } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { DEFAULT_SETTINGS, GOAL_OPTIONS_MULTI, type Audience, type DB, type Goal, type ThemePref, type TextSize, type DisplayFont } from "@/lib/schema";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseAuth } from "@/lib/supabase/server-auth";
import { validateOptionalUrl } from "@/lib/url-validation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

type SupabaseRequestAuth = { client: SupabaseClient; user: SupabaseUser };

// Audit 3B: the legacy settings payload used to echo raw Motion session
// tokens (GET `sessions[].token` + `activeSessionToken`). A token read from
// the settings response is enough to forge an attacker's cookie for that
// account. The payload now carries server-computed opaque identifiers only
// (short SHA-256 prefixes of the token); raw tokens never leave the server.
function opaqueSessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/** Verify the browser's Supabase token for sensitive writes independently of
 * the legacy JSON-store session. The client retains this token only in memory
 * long enough to make the authenticated request. */
async function getSupabaseRequestAuth(req: NextRequest): Promise<SupabaseRequestAuth | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : { client, user };
}

async function persistSupabaseSettings(body: Record<string, unknown>, settings: ReturnType<typeof withSettings>, requestAuth?: SupabaseRequestAuth) {
  const completingOnboarding = body.completeOnboarding === true;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return completingOnboarding ? "Supabase is not configured." : null;
  }
  try {
    const supabase = requestAuth?.client ?? await createSupabaseServerClient();
    const { data: { user }, error: authError } = requestAuth
      ? { data: { user: requestAuth.user }, error: null }
      : await supabase.auth.getUser();
    if (authError || !user) {
      return completingOnboarding ? "Your Supabase session is unavailable. Please sign in again." : null;
    }
    const profilePatch: Record<string, unknown> = {};
    if (completingOnboarding) {
      // Onboarding writes only the profile identity and completion fields.
      // Questionnaire answers remain in the app store; several deployments
      // intentionally use a minimal profiles schema.
      if (typeof body.username === "string") profilePatch.username = body.username;
      if (typeof body.age === "number") profilePatch.age = body.age;
      if (Array.isArray(body.skills) && body.skills.every((skill) => typeof skill === "string")) profilePatch.interests = body.skills;
      if (Array.isArray(body.goals) && typeof body.goals[0] === "string") profilePatch.goal = body.goals[0];
      if (typeof body.discoverySource === "string") profilePatch.feed_vibe = body.discoverySource;
      if (typeof body.school === "string") profilePatch.school = body.school;
      if (typeof body.institutionId === "string" || body.institutionId === null) profilePatch.institution_id = body.institutionId;
      if (typeof body.institutionNotListed === "boolean") profilePatch.institution_not_listed = body.institutionNotListed;
      if (typeof body.institutionCustomName === "string" || body.institutionCustomName === null) profilePatch.institution_custom_name = body.institutionCustomName;
      if (typeof body.currentlyInEducationalInstitution === "boolean") profilePatch.currently_in_educational_institution = body.currentlyInEducationalInstitution;
      profilePatch.onboarding_completed = true;
    } else {
      // P2: validate URL-bearing fields before they reach the persist step.
      if (typeof body.avatarUrl === "string") {
        const avatar = validateOptionalUrl(body.avatarUrl);
        if (!avatar.ok) return avatar.reason;
      }
      if ("bannerUrl" in body) {
        const banner = validateOptionalUrl(body.bannerUrl);
        if (!banner.ok) return banner.reason;
      }
      for (const [source, target] of [["username","username"],["name","display_name"],["bio","bio"],["school","school"],["phone","phone"],["avatarUrl","avatar_url"]]) {
        if (source in body) profilePatch[target] = body[source];
      }
      if ("bannerUrl" in body) {
        profilePatch.cover_url = body.bannerUrl;
        profilePatch.banner_url = body.bannerUrl;
      }
    }
    if (Object.keys(profilePatch).length) {
      const query = supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      const { data, error } = await query;
      if (error) return error.message;
      if (completingOnboarding && !data) {
        return "Your profile could not be updated. Please sign in again and retry.";
      }
    }
    // Onboarding completion depends only on the authenticated profile row.
    // Settings are initialized lazily, so a missing optional settings table
    // cannot turn a completed profile update into a failed submission.
    if (completingOnboarding) return null;
    const row: Record<string, unknown> = {user_id:user.id,updated_at:new Date().toISOString()};
    for (const [source,target] of [["privateProfile","is_private"],["lowSpecMode","low_spec_mode"],["aiPostSharpening","ai_post_sharpening"],["aiSmartRanking","ai_smart_ranking"],["aiDefaultModel","ai_default_model"],["accentColor","accent_color"],["theme","theme_mode"]]) {
      if (source in body) row[target]=body[source];
    }
    if ("theme" in body || "theme_mode" in body) {
      row.theme=body.theme_mode ?? body.theme;
      row.theme_mode=body.theme_mode ?? body.theme;
    }
    if ("discoverable" in body) row.campus_discovery=body.discoverable;
    if ("allowDMs" in body) row.dm_audience=body.allowDMs === "no_one" ? "none" : body.allowDMs;
    if ("allowMentions" in body) row.tagging_audience=body.allowMentions === "no_one" ? "off" : body.allowMentions;
    if (body.notify && typeof body.notify === "object") {
      const notify=body.notify as Record<string,unknown>;
      if (typeof notify.connections === "boolean") row.notify_connections=notify.connections;
      if (typeof notify.opportunities === "boolean") row.notify_events=notify.opportunities;
      if (typeof notify.announcements === "boolean") row.notify_polls=notify.announcements;
      if (typeof notify.likes === "boolean" || typeof notify.comments === "boolean") row.notify_social=(notify.likes ?? notify.comments) as boolean;
    }
    if ("emailDigest" in body) row.email_digest=body.emailDigest;
    if (typeof body.twoFactorEnabled === "boolean") row.two_factor_enabled=body.twoFactorEnabled;
    // Always send a complete row: upsert inserts defaults for a first save, or updates the existing row.
    Object.assign(row, {
      is_private: row.is_private ?? settings.privateProfile,
      campus_discovery: row.campus_discovery ?? settings.discoverable,
      dm_audience: row.dm_audience ?? (settings.allowDMs === "no_one" ? "none" : settings.allowDMs),
      tagging_audience: row.tagging_audience ?? (settings.allowMentions === "no_one" ? "off" : settings.allowMentions),
      notify_connections: row.notify_connections ?? settings.notify.connections,
      notify_events: row.notify_events ?? settings.notify.opportunities,
      notify_polls: row.notify_polls ?? settings.notify.announcements,
      notify_social: row.notify_social ?? (settings.notify.likes && settings.notify.comments),
      email_digest: row.email_digest ?? settings.emailDigest,
      theme_mode: row.theme_mode ?? settings.theme,
      theme: row.theme ?? settings.theme,
      accent_color: row.accent_color ?? settings.accentColor,
      low_spec_mode: row.low_spec_mode ?? settings.lowSpecMode,
      ai_post_sharpening: row.ai_post_sharpening ?? settings.aiPostSharpening,
      ai_smart_ranking: row.ai_smart_ranking ?? settings.aiSmartRanking,
      ai_default_model: row.ai_default_model ?? settings.aiDefaultModel,
      two_factor_enabled: row.two_factor_enabled ?? settings.twoFactor.enabled,
    });
    try {
      const { error } = await supabase.from("user_settings").upsert(row,{onConflict:"user_id"});
      if (error) return error.message;
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Could not save user settings.";
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Supabase settings update failed.";
  }
}

async function persistSupabaseRelation(action:string, handle:string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const supabase=await createSupabaseServerClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return null;
    const {data:target,error:lookupError}=await supabase.from("profiles").select("id").ilike("username",handle).maybeSingle();
    if(lookupError)return lookupError.message;
    if(!target)return "No Supabase profile exists for that username.";
    const isBlock=action==="block"||action==="unblock";
    const table=isBlock?"user_blocks":"user_mutes";
    const owner=isBlock?"blocker_id":"muter_id";
    const subject=isBlock?"blocked_id":"muted_id";
    const adding=action==="block"||action==="mute";
    const result=adding
      ? await supabase.from(table).upsert({[owner]:user.id,[subject]:target.id},{onConflict:`${owner},${subject}`})
      : await supabase.from(table).delete().eq(owner,user.id).eq(subject,target.id);
    if(result.error)return result.error.message;
    if(action==="block"){
      const {error}=await supabase.from("connections").delete().eq("requester_id",target.id).eq("target_id",user.id);
      if(error)return error.message;
      const {error:otherDirectionError}=await supabase.from("connections").delete().eq("requester_id",user.id).eq("target_id",target.id);
      if(otherDirectionError)return otherDirectionError.message;
    }
    return null;
  } catch(error) { return error instanceof Error?error.message:"Could not update safety list."; }
}

async function persistSupabaseAccountAction(action:"deactivate"|"delete") {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const supabase=await createSupabaseServerClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return null;
    if(action==="deactivate"){
      const {error}=await supabase.from("profiles").update({is_deactivated:true}).eq("id",user.id);
      if(error)return error.message;
      const {error:signOutError}=await supabase.auth.signOut({scope:"local"});
      return signOutError?.message??null;
    }
    const {error}=await supabase.rpc("delete_my_account");
    return error?.message??null;
  }catch(error){return error instanceof Error?error.message:"Account action failed.";}
}

async function getSupabaseSettingsPayload() {
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return null;
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const [{data:profile},{data:row}]=await Promise.all([
    supabase.from("profiles").select("id,username,full_name,display_name,bio,school,phone,avatar_url,cover_url,banner_url,created_at,is_deactivated").eq("id",user.id).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id",user.id).maybeSingle(),
  ]);
  if(!profile||profile.is_deactivated)return null;
  const settings={...DEFAULT_SETTINGS};
  if(row)Object.assign(settings,{privateProfile:row.is_private,discoverable:row.campus_discovery,allowDMs:row.dm_audience==="none"?"no_one":row.dm_audience,allowMentions:row.tagging_audience==="off"?"no_one":row.tagging_audience,theme:row.theme_mode??row.theme,accentColor:row.accent_color,lowSpecMode:row.low_spec_mode,reducedMotion:row.low_spec_mode,aiPostSharpening:row.ai_post_sharpening,aiSmartRanking:row.ai_smart_ranking,aiDefaultModel:row.ai_default_model,emailDigest:row.email_digest,notify:{...DEFAULT_SETTINGS.notify,connections:row.notify_connections,opportunities:row.notify_events,announcements:row.notify_polls,likes:row.notify_social,comments:row.notify_social,emailDigest:row.email_digest!=="off"}});
  if(row)settings.twoFactor.enabled=row.two_factor_enabled;
  const [{data:br},{data:mr}]=await Promise.all([
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id",user.id),
    supabase.from("user_mutes").select("muted_id").eq("muter_id",user.id),
  ]);
  const ids=[...(br??[]).map(x=>x.blocked_id),...(mr??[]).map(x=>x.muted_id)];
  const related=ids.length?await supabase.from("profiles").select("id,username,display_name").in("id",ids):{data:[]};
  const people=related.data??[];
  const map=(id:string)=>{const person=people.find(p=>p.id===id);return person?{id,handle:person.username,name:person.display_name??person.username}:null;};
  return {profile:{id:user.id,handle:profile.username,name:profile.display_name??profile.full_name??profile.username,headline:"",school:profile.school??"",photo:profile.avatar_url,banner:profile.banner_url??profile.cover_url,bio:profile.bio??"",email:user.email??null,phone:profile.phone??null,createdAt:profile.created_at},settings,blocked:(br??[]).map(x=>map(x.blocked_id)).filter(Boolean),muted:(mr??[]).map(x=>map(x.muted_id)).filter(Boolean),sessions:[],loginEvents:[],activeSessionId:null,plan:{tier:"free",price:0,renewsAt:null,imageLimit:1,textLimit:500},version:"1.0.0"};
}

function validateSupabaseSettingsBody(body:Record<string,unknown>):string|null {
  if(typeof body.name==="string"&&(body.name.trim().length<2||body.name.trim().length>40))return "Name must be 2–40 characters.";
  if(typeof body.username==="string"&&!/^[a-z0-9_.]{3,24}$/i.test(body.username.trim().replace(/^@/,"")))return "Username must be 3–24 letters, numbers, dots, or underscores.";
  if(body.age!==undefined){const age=Math.floor(Number(body.age));if(!Number.isInteger(age)||age<12||age>105)return "Enter an age between 12 and 105.";}
  if(typeof body.theme==="string"&&!(["dark","light","system"] as string[]).includes(body.theme))return "Unknown theme.";
  if(typeof body.theme_mode==="string"&&!( ["dark","light","system"] as string[]).includes(body.theme_mode))return "Unknown theme mode.";
  if(typeof body.accentColor==="string"&&!/^#[0-9a-f]{6}$/i.test(body.accentColor))return "Invalid accent color.";
  if(typeof body.aiDefaultModel==="string"&&!(["openai/gpt-oss-20b","openai/gpt-oss-120b"] as string[]).includes(body.aiDefaultModel))return "Unknown AI model.";
  if(typeof body.emailDigest==="string"&&!(["off","daily","weekly"] as string[]).includes(body.emailDigest))return "Unknown email digest setting.";
  if(typeof body.allowDMs==="string"&&!(["everyone","connections","no_one"] as string[]).includes(body.allowDMs))return "Invalid DM policy.";
  if(typeof body.allowMentions==="string"&&!(["everyone","connections","no_one"] as string[]).includes(body.allowMentions))return "Invalid mention policy.";
  return null;
}

/* ---------- helpers ---------- */

function mySettings(db: DB, meId: string) {
  const me = db.users.find((u) => u.id === meId)!;
  return { me, s: withSettings(me) };
}

function publicProfileOf(u: DB["users"][number]) {
  return {
    id: u.id,
    handle: u.handle,
    name: u.name,
    headline: u.headline,
    school: u.school,
    photo: u.photo ?? null,
    email: u.email ?? null,
    phone: u.phone ?? null,
    bio: u.bio ?? "",
    banner: u.banner ?? null,
    createdAt: u.createdAt,
  };
}

/* ---------- GET /api/settings — everything the page needs in one call ---------- */

export async function GET(req: NextRequest) {
  // Group A account/settings reads always prefer the verified Supabase user;
  // an old motion_session cookie must not select a different account.
  const supabaseAuth = await getSupabaseAuth(req);
  if (supabaseAuth) {
    const payload = await getSupabaseSettingsPayload();
    return payload ? json(payload) : bad("Your Motion profile is unavailable.", 409);
  }
  const auth = await requireUser();
  if ("res" in auth) {
    try { const payload=await getSupabaseSettingsPayload(); return payload?json(payload):auth.res; }
    catch { return auth.res; }
  }
  const { me, db } = auth;
  const s = withSettings(me);

  const sessions = db.sessions
    .filter((x) => x.userId === me.id)
    .sort((a, b) => +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt))
    .map((x) => ({ id: opaqueSessionId(x.token), device: x.device, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt }));

  const loginEvents = db.loginEvents
    .filter((x) => x.userId === me.id)
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 10)
    .map((x) => ({ at: x.at, device: x.device }));

  const pub = (id: string) => {
    const u = db.users.find((x) => x.id === id);
    return u ? { handle: u.handle, name: u.name, id: u.id } : null;
  };

  let profile=publicProfileOf(me);
  let settings=s;
  let blocked=s.blocked.map(pub).filter(Boolean);
  let muted=s.muted.map(pub).filter(Boolean);
  if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY){
    try {
      const supabase=await createSupabaseServerClient();
      const {data:{user}}=await supabase.auth.getUser();
      if(user){
        const [{data:sp},{data:ss}]=await Promise.all([
          supabase.from("profiles").select("username,display_name,bio,school,phone,avatar_url,cover_url,banner_url").eq("id",user.id).maybeSingle(),
          supabase.from("user_settings").select("*").eq("user_id",user.id).maybeSingle(),
        ]);
        if(sp)profile={...profile,handle:sp.username,name:sp.display_name??profile.name,bio:sp.bio??"",school:sp.school??profile.school,phone:sp.phone??profile.phone,photo:sp.avatar_url??profile.photo,banner:sp.banner_url??sp.cover_url??null};
        if(ss)settings={...s,privateProfile:ss.is_private,discoverable:ss.campus_discovery,allowDMs:ss.dm_audience==="none"?"no_one":ss.dm_audience,allowMentions:ss.tagging_audience==="off"?"no_one":ss.tagging_audience,theme:ss.theme_mode??ss.theme,accentColor:ss.accent_color,lowSpecMode:ss.low_spec_mode,reducedMotion:ss.low_spec_mode,aiPostSharpening:ss.ai_post_sharpening,aiSmartRanking:ss.ai_smart_ranking,aiDefaultModel:ss.ai_default_model,emailDigest:ss.email_digest,notify:{...s.notify,connections:ss.notify_connections,opportunities:ss.notify_events,announcements:ss.notify_polls,likes:ss.notify_social,comments:ss.notify_social}};
        if(ss)settings.twoFactor.enabled=ss.two_factor_enabled;
        const [{data:br},{data:mr}]=await Promise.all([
          supabase.from("user_blocks").select("blocked_id").eq("blocker_id",user.id),
          supabase.from("user_mutes").select("muted_id").eq("muter_id",user.id),
        ]);
        const blockedIds=(br??[]).map(row=>row.blocked_id);
        const mutedIds=(mr??[]).map(row=>row.muted_id);
        if(blockedIds.length){const {data:rows}=await supabase.from("profiles").select("id,username,display_name").in("id",blockedIds);if(rows)blocked=rows.map(row=>({id:row.id,handle:row.username,name:row.display_name??row.username}));}
        if(mutedIds.length){const {data:rows}=await supabase.from("profiles").select("id,username,display_name").in("id",mutedIds);if(rows)muted=rows.map(row=>({id:row.id,handle:row.username,name:row.display_name??row.username}));}
      }
    } catch { /* no Supabase session or migration; local app settings remain available */ }
  }

  return json({
    profile,
    settings,
    blocked,
    muted,
    sessions,
    loginEvents,
    activeSessionId: opaqueSessionId((await getSessionToken()) ?? ""),
    plan: { tier: "free", price: 0, renewsAt: null, imageLimit: 1, textLimit: 500 },
    version: "1.0.0",
  });
}

/* ---------- PATCH /api/settings — one endpoint, sectioned payloads ---------- */

export async function PATCH(req: NextRequest) {
  // Audit P4: settings writes rewrite profile state; bound the write rate.
  // Actor granularity comes from the platform IP signal (rate-limit.ts); the
  // per-actor key keeps treating fields separately (auth paths checked below).
  const settingsRate = await rateLimit(req, "settings-write", "anon", 30, 60);
  if (!settingsRate.allowed) return rateLimitResponse(settingsRate.retryAfter);
  const body = await readBody<Record<string, unknown>>(req);
  // Completion is exclusively a Supabase-authenticated operation. This must
  // happen before consulting the legacy session, otherwise a real browser
  // session can be rejected by an unrelated JSON-store guard.
  if (body.completeOnboarding === true) {
    const requestAuth = await getSupabaseRequestAuth(req);
    if (!requestAuth) return bad("Sign in to complete onboarding.", 401);
    const validation = validateSupabaseSettingsBody(body);
    if (validation) return bad(validation);
    const error = await persistSupabaseSettings(body, DEFAULT_SETTINGS, requestAuth);
    if (error) return bad(`Supabase settings update failed: ${error}`, 502);
    return json({ ok: true });
  }
  // Settings and profile preferences are Group A data. Keep the existing
  // legacy branch only for unconverted demo endpoints, never for a verified
  // Supabase account.
  const supabaseAuth = await getSupabaseAuth(req);
  if (supabaseAuth) {
    const validation = validateSupabaseSettingsBody(body);
    if (validation) return bad(validation);
    const payload = await getSupabaseSettingsPayload();
    if (!payload) return bad("Your Motion profile is unavailable.", 409);
    const error = await persistSupabaseSettings(body, payload.settings);
    if (error) return bad(`Supabase settings update failed: ${error}`, 502);
    return json({ ok: true, settings: payload.settings, profile: payload.profile });
  }
  const auth = await requireUser();
  if ("res" in auth) {
    const validation=validateSupabaseSettingsBody(body);
    if(validation)return bad(validation);
    const payload=await getSupabaseSettingsPayload();
    if(!payload)return auth.res;
    const settings=payload.settings;
    const settingError=await persistSupabaseSettings(body,settings);
    if(settingError)return bad(`Supabase settings update failed: ${settingError}`,502);
    return json({ok:true,settings,profile:payload.profile});
  }
  const { me, db } = auth;
  const { s } = mySettings(db, me.id);

  // --- Account & profile ---
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 40) return bad("Name must be 2–40 characters.");
    me.name = name;
  }
  if (typeof body.username === "string") {
    const username = body.username.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) return bad("Username must be 3–24 letters, numbers, dots, or underscores.");
    if (db.users.some((u) => u.id !== me.id && u.handle.toLowerCase() === username)) return bad("That username is already taken.", 409);
    me.handle = username;
  }
  if (typeof body.bio === "string") me.bio = body.bio.trim().slice(0, 300);
  if (typeof body.school === "string") me.school = body.school.trim().slice(0, 120);
  if (typeof body.headline === "string") me.headline = body.headline.trim().slice(0, 80);
  // Audit P0-3: body.email is ignored on the legacy branch. An account's own
  // email must never become a self-minted admin credential; legacy emails are
  // display-only data installed by the operator. Senders of legacy email
  // fields (none in the shipped UI) just get a no-op on that key.
  if (typeof body.phone === "string") {
    const phone=body.phone.trim();
    if(phone.length>32)return bad("Phone number must be 32 characters or fewer.");
    me.phone=phone||undefined;
  }
  if (typeof body.avatarUrl === "string") {
    const avatar = validateOptionalUrl(body.avatarUrl);
    if (!avatar.ok) return bad(avatar.reason, 422);
    me.photo = avatar.url ?? undefined;
  }
  if (typeof body.bannerUrl === "string") {
    const banner = validateOptionalUrl(body.bannerUrl);
    if (!banner.ok) return bad(banner.reason, 422);
    me.banner = banner.url ?? undefined;
  }
  if (typeof body.photo === "string") {
    if (body.photo.length > 300_000) return bad("Photo is too large — pick something under ~200KB.", 413);
    const photo = validateOptionalUrl(body.photo);
    if (!photo.ok) return bad(photo.reason, 422);
    me.photo = photo.url ?? undefined;
  }
  if (Array.isArray(body.skills)) {
    const skills = (body.skills as unknown[])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 12);
    if (skills.some((s) => s.length > 30)) return bad("Each skill must be 30 characters or fewer.");
    me.skills = skills;
  }

  // --- Onboarding questionnaire ---
  if (typeof body.grade === "string") {
    const valid = ["middle", "high", "college", "grad", "self_taught"];
    if (!valid.includes(body.grade)) return bad("Unknown academic stage.");
    me.grade = body.grade as typeof me.grade;
    // Keep the profile headline coherent with the chosen stage.
    const headlines: Record<typeof me.grade, string> = {
      middle: "New here — exploring what I love",
      high: "Student building in public",
      college: "Student building in public",
      grad: "Grad student in motion",
      self_taught: "Self-taught and building",
    };
    me.headline = headlines[me.grade];
  }
  if (body.age !== undefined) {
    const age = Math.floor(Number(body.age));
    if (!Number.isInteger(age) || age < 12 || age > 105) return bad("Enter an age between 12 and 105.");
    me.age = age;
  }
  if (Array.isArray(body.goals)) {
    const valid = new Set<string>(GOAL_OPTIONS_MULTI);
    const goals = (body.goals as unknown[]).filter((g): g is Goal =>
      typeof g === "string" && valid.has(g)
    );
    if (body.goals.length && !goals.length) return bad("Unknown goal option.");
    me.goals = goals;
    if (goals.length && !goals.includes(me.goal)) me.goal = goals[0];
  }
  if ("discoverySource" in body) {
    me.discoverySource = typeof body.discoverySource === "string" && body.discoverySource.trim()
      ? body.discoverySource.trim().slice(0, 60)
      : null;
  }
  if (body.completeOnboarding === true) me.onboardedAt = new Date().toISOString();

  // --- Privacy ---
  if (typeof body.privateProfile === "boolean") s.privateProfile = body.privateProfile;
  if (typeof body.showSchool === "boolean") s.showSchool = body.showSchool;
  if (typeof body.showAgeTag === "boolean") s.showAgeTag = body.showAgeTag;
  if (typeof body.allowMentions === "string") {
    if (!["everyone", "connections", "no_one"].includes(body.allowMentions)) return bad("Invalid mention policy.");
    s.allowMentions = body.allowMentions as Audience;
  }
  if (typeof body.allowDMs === "string") {
    if (!["everyone", "connections", "no_one"].includes(body.allowDMs)) return bad("Invalid DM policy.");
    s.allowDMs = body.allowDMs as Audience;
  }
  if (typeof body.allowConnectRequests === "string") {
    if (!["everyone", "no_one"].includes(body.allowConnectRequests)) return bad("Invalid connect policy.");
    s.allowConnectRequests = body.allowConnectRequests as "everyone" | "no_one";
  }
  if (typeof body.allowReposts === "boolean") s.allowReposts = body.allowReposts;
  if (typeof body.discoverable === "boolean") s.discoverable = body.discoverable;
  if (typeof body.personalizeSuggestions === "boolean") s.personalizeSuggestions = body.personalizeSuggestions;
  if (typeof body.blurMedia === "boolean") s.blurMedia = body.blurMedia;

  // --- Notifications ---
  if (body.notify && typeof body.notify === "object") {
    const n = body.notify as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_SETTINGS.notify) as Array<keyof typeof DEFAULT_SETTINGS.notify>) {
      if (typeof n[k] === "boolean") s.notify[k] = n[k] as boolean;
    }
  }
  if ("quietUntil" in body) s.quietUntil = typeof body.quietUntil === "string" ? body.quietUntil : null;
  if (typeof body.schoolHoursDND === "boolean") s.schoolHoursDND = body.schoolHoursDND;

  // --- Security: password ---
  if (typeof body.newPassword === "string") {
    if (me.passwordHash && !verifyPassword(String(body.currentPassword ?? ""), me.passwordHash)) {
      return bad("Current password is incorrect.", 403);
    }
    const pw = body.newPassword;
    if (pw.length < 8) return bad("Password must be at least 8 characters.");
    me.passwordHash = hashPassword(pw);
    // Audit 3B: a credential change invalidates every OTHER Motion session of
    // this user (standard session hygiene; the current session stays signed in).
    const currentToken = (await getSessionToken()) ?? "";
    db.sessions = db.sessions.filter((x) => x.userId !== me.id || x.token === currentToken);
  }

  // --- Security: 2FA & passkeys ---
  if (typeof body.twoFactorEnabled === "boolean") {
    s.twoFactor.enabled = body.twoFactorEnabled;
    if (!body.twoFactorEnabled) s.twoFactor.method = "app";
  }
  if (typeof body.twoFactorMethod === "string") {
    if (!["app", "sms", "passkey"].includes(body.twoFactorMethod)) return bad("Unknown 2FA method.");
    s.twoFactor.method = body.twoFactorMethod as "app" | "sms" | "passkey";
    s.twoFactor.enabled = true;
  }
  if (body.addPasskey === true) {
    const name = `Passkey ${s.passkeys.length + 1}`;
    s.passkeys.push(name);
    s.twoFactor.method = "passkey";
    s.twoFactor.enabled = true;
  }
  if (typeof body.removePasskey === "string") s.passkeys = s.passkeys.filter((p) => p !== body.removePasskey);

  // --- Display & accessibility ---
  if (typeof body.theme === "string") {
    if (!["dark", "light", "system"].includes(body.theme)) return bad("Unknown theme.");
    s.theme = body.theme as ThemePref;
  }
  if (typeof body.theme_mode === "string") {
    if (!["dark", "light", "system"].includes(body.theme_mode)) return bad("Unknown theme mode.");
    s.theme = body.theme_mode as ThemePref;
  }
  if (typeof body.textSize === "string") {
    if (!["default", "large", "xlarge"].includes(body.textSize)) return bad("Unknown text size.");
    s.textSize = body.textSize as TextSize;
  }
  if (typeof body.displayFont === "string") {
    if (!["space", "inter", "system"].includes(body.displayFont)) return bad("Unknown font.");
    s.displayFont = body.displayFont as DisplayFont;
  }
  if (typeof body.reducedMotion === "boolean") s.reducedMotion = body.reducedMotion;
  if (typeof body.lowSpecMode === "boolean") { s.lowSpecMode = body.lowSpecMode; s.reducedMotion = body.lowSpecMode; }
  if (typeof body.accentColor === "string") {
    if (!/^#[0-9a-f]{6}$/i.test(body.accentColor)) return bad("Invalid accent color.");
    s.accentColor = body.accentColor;
  }
  if (typeof body.aiPostSharpening === "boolean") s.aiPostSharpening = body.aiPostSharpening;
  if (typeof body.aiSmartRanking === "boolean") s.aiSmartRanking = body.aiSmartRanking;
  if (typeof body.aiDefaultModel === "string") {
    if (!["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(body.aiDefaultModel)) return bad("Unknown AI model.");
    s.aiDefaultModel = body.aiDefaultModel;
  }
  if (typeof body.emailDigest === "string") {
    if (!["off", "daily", "weekly"].includes(body.emailDigest)) return bad("Unknown email digest setting.");
    s.emailDigest = body.emailDigest as typeof s.emailDigest;
    s.notify.emailDigest = s.emailDigest !== "off";
  }
  if (typeof body.highContrast === "boolean") s.highContrast = body.highContrast;
  if (typeof body.language === "string") s.language = body.language;
  if (typeof body.timezone === "string") s.timezone = body.timezone;

  const supabaseError=await persistSupabaseSettings(body,s);
  if(supabaseError)return bad(`Supabase settings update failed: ${supabaseError}`,502);
  me.settings = s;
  await persist(db);
  return json({ ok: true, settings: s, profile: publicProfileOf(me) });
}

/* ---------- POST /api/settings — actions ---------- */

export async function POST(req: NextRequest) {
  // Audit P4: block/unblock/mute/deactivate rewrite the safety lists and
  // account state; bound the write rate like PATCH.
  const settingsRate = await rateLimit(req, "settings-write", "anon", 30, 60);
  if (!settingsRate.allowed) return rateLimitResponse(settingsRate.retryAfter);
  const auth = await requireUser();
  const body = await readBody<{
    action?: string;
    handle?: string;
    id?: string;
    hours?: number;
    text?: string;
    confirmed?: boolean;
    reason?: string;
  }>(req);

  if("res" in auth){
    if(body.action==="block"||body.action==="unblock"||body.action==="mute"||body.action==="unmute"){
      if(!body.handle?.trim())return bad("Enter a username.");
      const error=await persistSupabaseRelation(body.action,body.handle.trim().replace(/^@/,""));
      return error?bad(`Could not update safety list: ${error}`,502):json({ok:true});
    }
    if(body.action==="deactivate"||body.action==="delete"){
      const expected=body.action==="delete"?"DELETE":"DEACTIVATE";
      if(!body.confirmed||body.text?.trim().toUpperCase()!==expected)return bad(`Type ${expected} to confirm.`);
      const error=await persistSupabaseAccountAction(body.action);
      return error?bad(`Account action failed: ${error}`,502):json({ok:true});
    }
    return auth.res;
  }
  const { me, db } = auth;

  switch (body.action) {
    case "block": {
      const t = db.users.find((u) => u.handle === body.handle);
      if (!t) return bad("User not found.", 404);
      if (t.id === me.id) return bad("You can't block yourself.");
      const s = withSettings(me);
      if (!s.blocked.includes(t.id)) {
        s.blocked.push(t.id);
        s.muted = s.muted.filter((id) => id !== t.id);
        // Block dissolves the relationship in both directions.
        db.connections = db.connections.filter(
          (c) => !((c.requesterId === me.id && c.targetId === t.id) || (c.requesterId === t.id && c.targetId === me.id))
        );
        db.chats = db.chats.filter(
          (c) => !(c.participantIds.length === 2 && c.participantIds.includes(me.id) && c.participantIds.includes(t.id))
        );
        me.settings = s;
        await persist(db);
      }
      const supabaseError=await persistSupabaseRelation("block",t.handle);
      if(supabaseError)return bad(`Could not save block: ${supabaseError}`,502);
      return json({ ok: true, blocked: s.blocked });
    }
    case "unblock": {
      const s = withSettings(me);
      s.blocked = s.blocked.filter((id) => id !== body.handle && db.users.find((u) => u.handle === body.handle)?.id !== id);
      s.blocked = s.blocked.filter((id) => id !== db.users.find((u) => u.handle === body.handle)?.id);
      me.settings = s;
      await persist(db);
      const supabaseError=await persistSupabaseRelation("unblock",body.handle??"");
      if(supabaseError)return bad(`Could not save unblock: ${supabaseError}`,502);
      return json({ ok: true, blocked: s.blocked });
    }
    case "mute": {
      const t = db.users.find((u) => u.handle === body.handle);
      if (!t) return bad("User not found.", 404);
      const s = withSettings(me);
      if (!s.muted.includes(t.id)) s.muted.push(t.id);
      me.settings = s;
      await persist(db);
      const supabaseError=await persistSupabaseRelation("mute",t.handle);
      if(supabaseError)return bad(`Could not save mute: ${supabaseError}`,502);
      return json({ ok: true, muted: s.muted });
    }
    case "unmute": {
      const s = withSettings(me);
      const id = db.users.find((u) => u.handle === body.handle)?.id;
      s.muted = s.muted.filter((x) => x !== id);
      me.settings = s;
      await persist(db);
      const supabaseError=await persistSupabaseRelation("unmute",body.handle??"");
      if(supabaseError)return bad(`Could not save unmute: ${supabaseError}`,502);
      return json({ ok: true, muted: s.muted });
    }
    case "revoke-session": {
      if (typeof body.id !== "string") return bad("Session id is required.");
      const curToken = (await getSessionToken()) ?? "";
      if (opaqueSessionId(curToken) === body.id) return bad("You can't revoke the session you're using right now.");
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((x) => !(x.userId === me.id && opaqueSessionId(x.token) === body.id));
      if (db.sessions.length === before) return bad("Session not found.", 404);
      await persist(db);
      return json({ ok: true });
    }
    case "revoke-others": {
      const cur = await getSessionToken();
      db.sessions = db.sessions.filter((x) => x.userId !== me.id || x.token === cur);
      await persist(db);
      return json({ ok: true });
    }
    case "quiet": {
      const hours = Math.min(24 * 7, Math.max(1, Number(body.hours) || 8));
      const s = withSettings(me);
      s.quietUntil = new Date(Date.now() + hours * 3600_000).toISOString();
      me.settings = s;
      await persist(db);
      return json({ ok: true, quietUntil: s.quietUntil });
    }
    case "quiet-off": {
      const s = withSettings(me);
      s.quietUntil = null;
      me.settings = s;
      await persist(db);
      return json({ ok: true });
    }
    case "export": {
      const s = withSettings(me);
      const archive = {
        exportedAt: new Date().toISOString(),
        profile: publicProfileOf(me),
        settings: s,
        posts: db.posts.filter((p) => p.authorId === me.id),
        likes: db.posts.filter((p) => p.likes.includes(me.id)).map((p) => p.id),
        connections: db.connections.filter((c) => c.requesterId === me.id || c.targetId === me.id),
        chats: db.chats
          .filter((c) => c.participantIds.includes(me.id))
          .map((c) => ({ id: c.id, status: c.status, messages: c.messages })),
        groups: db.groups.filter((g) => g.members.some((m) => m.userId === me.id)),
        notifications: db.notifications.filter((n) => n.userId === me.id),
      };
      return new NextResponse(JSON.stringify(archive, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="motion-archive-${me.handle}.json"`,
        },
      });
    }
    case "deactivate": {
      if (!body.confirmed || body.text !== "DEACTIVATE") return bad('Type DEACTIVATE to confirm.');
      const supabaseError=await persistSupabaseAccountAction("deactivate");
      if(supabaseError)return bad(`Could not deactivate account: ${supabaseError}`,502);
      me.deactivatedAt = new Date().toISOString();
      await persist(db);
      await clearSession();
      return json({ ok: true });
    }
    case "delete": {
      if (!body.confirmed || body.text?.trim().toUpperCase() !== "DELETE") return bad('Type DELETE to confirm.');
      const supabaseError=await persistSupabaseAccountAction("delete");
      if(supabaseError)return bad(`Could not delete account: ${supabaseError}`,502);
      const id = me.id;
      db.users = db.users.filter((u) => u.id !== id);
      db.connections = db.connections.filter((c) => c.requesterId !== id && c.targetId !== id);
      db.posts = db.posts.filter((p) => p.authorId !== id);
      db.chats = db.chats.filter((c) => !c.participantIds.includes(id));
      db.notifications = db.notifications.filter((n) => n.userId !== id);
      db.sessions = db.sessions.filter((x) => x.userId !== id);
      db.groups.forEach((g) => (g.members = g.members.filter((m) => m.userId !== id)));
      await persist(db);
      await clearSession();
      return json({ ok: true });
    }
    case "feedback": {
      const text = (body.text ?? "").trim();
      if (!text) return bad("Tell us what's on your mind.");
      db.reports.unshift({ id: newId("r"), reporterId: me.id, targetType: "feedback", targetId: "-", reason: text.slice(0, 500), createdAt: new Date().toISOString() });
      await persist(db);
      return json({ ok: true });
    }
  }
  return bad("Unknown action.");
}
