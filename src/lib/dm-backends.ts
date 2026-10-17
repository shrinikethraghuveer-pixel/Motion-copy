"use client";

import { api, post, type PublicUser } from "@/lib/client";
import { hasSupabaseEnv } from "@/lib/db/supabase-env";
import type { ChatMessage } from "@/lib/schema";

/* ───────────────────────────── types ───────────────────────────── */

/** Sidebar row for a group conversation (no message bodies). */
export interface DmGroupSummary {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: ChatMessage | null;
  memberCount: number;
  meRole: "admin" | "member";
}

export interface DmGroupMember {
  role: "admin" | "member";
  joinedAt: string;
  user: PublicUser;
}

interface GroupMemberCount { group_id: string; }
interface LastGroupMessage { group_id: string; sender_id: string; content: string; created_at: string; }
interface GroupChatRow { id: string; name: string; description: string | null; avatar_url: string | null; created_by: string; created_at: string; }
interface ProfileRow { id: string; username: string; full_name: string | null; display_name: string | null; avatar_url: string | null; }

/** Full detail payload for the info panel + message stream. */
export interface DmGroupDetail extends DmGroupSummary {
  members: DmGroupMember[];
}

/* ───────────────────────── backend detection ───────────────────── */

/**
 * The Supabase path serves DMs + groups when env vars exist; otherwise the
 * legacy JSON-store APIs do. UI stays identical either way.
 */
export function dmBackendMode(): "supabase" | "legacy" {
  return hasSupabaseEnv() ? "supabase" : "legacy";
}

/* ─────────────────────────── user search ───────────────────────── */

/** Global search — any discoverable user, not just connections. */
export async function searchUsers(q: string): Promise<PublicUser[]> {
  const query = q.trim();
  if (!query) return [];

  if (hasSupabaseEnv()) {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const like = `%${query.replace(/[%_]/g, "")}%`;
      const { data, error } = await sb
        .from("profiles")
        .select("id,username,full_name,display_name,avatar_url")
        .or(`username.ilike.${like},full_name.ilike.${like}`)
        .limit(10);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        id: string;
        username: string;
        full_name: string | null;
        display_name: string | null;
        avatar_url: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        handle: r.username,
        name: r.display_name || r.full_name || r.username,
        photo: r.avatar_url ?? undefined,
        // Fields the legacy PublicUser carries but the modal doesn't need.
        grade: "college",
        school: "",
        headline: "",
        skills: [],
        goal: "Meet peers",
        following: [],
        createdAt: "",
        ageTag: "18+",
        isSelf: false,
        connectionState: "none",
        settings: {} as PublicUser["settings"],
      }));
    } catch (e) {
      console.warn("[dm] Supabase user search failed — falling back:", e instanceof Error ? e.message : e);
    }
  }

  const r = await api<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(query)}`);
  return r.users;
}

/* ────────────────────────── group listing ──────────────────────── */

export async function listGroups(): Promise<DmGroupSummary[]> {
  if (hasSupabaseEnv()) {
    try {
      return await listGroupsSupabase();
    } catch (e) {
      console.warn("[dm] Supabase groups failed — falling back:", e instanceof Error ? e.message : e);
    }
  }
  const r = await api<{ groups: DmGroupSummary[] }>("/api/group-chats");
  return r.groups;
}

async function listGroupsSupabase(): Promise<DmGroupSummary[]> {
  const sb = await sbClient();
  const myId = await currentUserId(sb);
  if (!myId) return [];

  const { data: memberships, error: mErr } = await sb
    .from("group_members")
    .select("group_id,role,joined_at")
    .eq("user_id", myId);
  if (mErr) throw new Error(mErr.message);
  const rows = (memberships ?? []) as Array<{ group_id: string; role: string; joined_at: string }>;
  if (rows.length === 0) return [];

  const { data: chats, error: cErr } = await sb
    .from("group_chats")
    .select("*")
    .in("id", rows.map((r) => r.group_id));
  if (cErr) throw new Error(cErr.message);

  const { data: memberCounts, error: cntErr } = await sb
    .from("group_members")
    .select("group_id")
    .in("group_id", rows.map((r) => r.group_id));
  if (cntErr) throw new Error(cntErr.message);

  // Last message per group.
  const { data: lastRows, error: lErr } = await sb
    .from("messages")
    .select("group_id,content,created_at,sender_id")
    .not("group_id", "is", null)
    .in("group_id", rows.map((r) => r.group_id))
    .order("created_at", { ascending: false })
    .limit(200);
  if (lErr) throw new Error(lErr.message);

  const counts = (memberCounts as unknown as GroupMemberCount[] | null) ?? [];
  const lastMsgRows = (lastRows as unknown as LastGroupMessage[] | null) ?? [];
  const chatRows = (chats as unknown as GroupChatRow[] | null) ?? [];
  const countOf = (gid: string) => counts.filter((member) => member.group_id === gid).length;
  const lastOf = (gid: string) => {
    const row = lastMsgRows.find((message) => message.group_id === gid);
    return row
      ? ({ id: `last-${gid}`, senderId: row.sender_id, text: row.content, createdAt: row.created_at } as ChatMessage)
      : null;
  };

  return rows
    .map((m) => {
      const g = chatRows.find((chat) => chat.id === m.group_id);
      if (!g) return null;
      return {
        id: g.id,
        name: g.name,
        description: g.description ?? "",
        avatarUrl: g.avatar_url,
        createdBy: g.created_by,
        createdAt: g.created_at,
        updatedAt: lastOf(g.id)?.createdAt ?? g.created_at,
        lastMessage: lastOf(g.id),
        memberCount: countOf(g.id),
        meRole: (m.role === "admin" ? "admin" : "member") as "admin" | "member",
      } satisfies DmGroupSummary;
    })
    .filter((g): g is DmGroupSummary => g !== null)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

/* ────────────────────────── group detail ───────────────────────── */

export async function getGroupDetail(groupId: string): Promise<{ group: DmGroupDetail; messages: ChatMessage[] }> {
  if (hasSupabaseEnv()) {
    try {
      return await getGroupDetailSupabase(groupId);
    } catch (e) {
      console.warn("[dm] Supabase group detail failed — falling back:", e instanceof Error ? e.message : e);
    }
  }
  return api(`/api/group-chats?groupId=${encodeURIComponent(groupId)}`);
}

async function getGroupDetailSupabase(groupId: string): Promise<{ group: DmGroupDetail; messages: ChatMessage[] }> {
  const sb = await sbClient();
  const myId = await currentUserId(sb);
  if (!myId) throw new Error("Sign in to view groups.");

  const { data: g, error: gErr } = await sb.from("group_chats").select("*").eq("id", groupId).maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!g) throw new Error("Group not found.");

  const { data: memberRows, error: mErr } = await sb
    .from("group_members")
    .select("user_id,role,joined_at")
    .eq("group_id", groupId);
  if (mErr) throw new Error(mErr.message);
  const members = (memberRows ?? []) as Array<{ user_id: string; role: string; joined_at: string }>;

  const { data: profileRows, error: pErr } = await sb
    .from("profiles")
    .select("id,username,full_name,display_name,avatar_url")
    .in("id", members.map((m) => m.user_id));
  if (pErr) throw new Error(pErr.message);

  const profiles = (profileRows as unknown as ProfileRow[] | null) ?? [];
  const profileOf = (id: string) => profiles.find((profile) => profile.id === id);

  const mine = members.find((m) => m.user_id === myId);
  const group: DmGroupDetail = {
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    avatarUrl: g.avatar_url,
    createdBy: g.created_by,
    createdAt: g.created_at,
    updatedAt: g.created_at,
    lastMessage: null,
    memberCount: members.length,
    meRole: mine?.role === "admin" ? "admin" : "member",
    members: members
      .map((m) => {
        const p = profileOf(m.user_id);
        if (!p) return null;
        return {
          role: (m.role === "admin" ? "admin" : "member") as "admin" | "member",
          joinedAt: m.joined_at,
          user: {
            id: p.id,
            handle: p.username,
            name: p.display_name || p.full_name || p.username,
            photo: p.avatar_url ?? undefined,
            grade: "college",
            school: "",
            headline: "",
            skills: [],
            goal: "Meet peers",
            following: [],
            createdAt: "",
            ageTag: "18+",
            isSelf: p.id === myId,
            connectionState: p.id === myId ? "self" : "none",
            settings: {} as PublicUser["settings"],
          } as PublicUser,
        } as DmGroupMember;
      })
      .filter((member): member is DmGroupMember => member !== null),
  };

  const { data: msgRows, error: msgErr } = await sb
    .from("messages")
    .select("id,sender_id,content,created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (msgErr) throw new Error(msgErr.message);

  return {
    group,
    messages: ((msgRows ?? []) as Array<{ id: string; sender_id: string; content: string; created_at: string }>).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      text: m.content,
      createdAt: m.created_at,
    })),
  };
}

/* ──────────────────────── group mutations ──────────────────────── */

export interface CreateGroupInput {
  name: string;
  description: string;
  avatarUrl: string | null;
  memberIds: string[];
}

export async function createGroup(input: CreateGroupInput): Promise<string> {
  if (hasSupabaseEnv()) {
    try {
      const sb = await sbClient();
      const { data, error } = await sb.rpc("create_group_chat_with_members", {
        p_name: input.name,
        p_description: input.description || null,
        p_avatar_url: input.avatarUrl,
        p_member_ids: input.memberIds,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "string" || !data) throw new Error("Group creation returned no group ID.");
      return data;
    } catch (e) {
      console.warn("[dm] Supabase create group failed:", e instanceof Error ? e.message : e);
      throw e;
    }
  }

  const r = await post<{ ok: boolean; groupId: string }>("/api/group-chats", {
    name: input.name,
    description: input.description,
    avatar_url: input.avatarUrl,
    member_ids: input.memberIds,
  });
  return r.groupId;
}

export async function sendGroupMessage(groupId: string, text: string): Promise<void> {
  if (hasSupabaseEnv()) {
    // No legacy JSON fallback in Supabase mode: a failed send (RLS, network,
    // DB) must surface to the user instead of silently landing in the JSON
    // store where Supabase group members will never see it.
    const sb = await sbClient();
    const myId = await currentUserId(sb);
    if (!myId) throw new Error("Sign in to send messages.");
    const { error } = await sb.from("messages").insert({ sender_id: myId, group_id: groupId, content: text });
    if (error) throw new Error(error.message);
    return;
  }
  await post("/api/group-chats", { action: "send", groupId, text });
}

export async function addGroupMembers(groupId: string, memberIds: string[]): Promise<number> {
  if (hasSupabaseEnv()) {
    try {
      const sb = await sbClient();
      const { data: existing, error: eErr } = await sb.from("group_members").select("user_id").eq("group_id", groupId);
      if (eErr) throw new Error(eErr.message);
      const have = new Set(((existing ?? []) as Array<{ user_id: string }>).map((m) => m.user_id));
      const fresh = memberIds.filter((id) => !have.has(id));
      if (fresh.length === 0) return 0;
      const { error } = await sb
        .from("group_members")
        .insert(fresh.map((user_id) => ({ group_id: groupId, user_id, role: "member" as const })));
      if (error) throw new Error(error.message);
      return fresh.length;
    } catch (e) {
      console.warn("[dm] Supabase add members failed:", e instanceof Error ? e.message : e);
      throw e;
    }
  }
  const r = await post<{ ok: boolean; added: number }>("/api/group-chats", { action: "addMembers", groupId, memberIds });
  return r.added;
}

export async function leaveGroup(groupId: string): Promise<void> {
  if (hasSupabaseEnv()) {
    // No legacy JSON fallback in Supabase mode: a failed leave (RLS, network,
    // DB, final-admin rule) must surface instead of "leaving" only the JSON
    // store while the user remains on the real Supabase roster. No DELETE
    // policy or leave behavior is decided here.
    const sb = await sbClient();
    const myId = await currentUserId(sb);
    if (!myId) throw new Error("Sign in first.");
    const { error } = await sb.from("group_members").delete().eq("group_id", groupId).eq("user_id", myId);
    if (error) throw new Error(error.message);
    return;
  }
  await post("/api/group-chats", { action: "leave", groupId });
}

/* ───────────────────── realtime: unified channel ───────────────── */

export interface DmRealtimeHandlers {
  /** Incoming 1-on-1 row (either direction for my pairs). */
  onDm: (row: { id: string; senderId: string; receiverId: string; text: string; createdAt: string }) => void;
  /** Incoming group row. */
  onGroup: (row: { id: string; groupId: string; senderId: string; text: string; createdAt: string }) => void;
}

/**
 * Subscribe once to all DM + group message INSERTs and route them to the
 * handlers. Returns an unsubscribe function. Legacy stores have no realtime —
 * the caller keeps its polling loop in that mode.
 */
export async function subscribeDmRealtime(handlers: DmRealtimeHandlers): Promise<() => void> {
  if (!hasSupabaseEnv()) return () => {};

  try {
    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient();
    const channel = sb
      .channel("dm-all-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            receiver_id: string | null;
            group_id: string | null;
            content: string;
            created_at: string;
          };
          if (row.group_id) {
            handlers.onGroup({ id: row.id, groupId: row.group_id, senderId: row.sender_id, text: row.content, createdAt: row.created_at });
          } else if (row.receiver_id) {
            handlers.onDm({ id: row.id, senderId: row.sender_id, receiverId: row.receiver_id, text: row.content, createdAt: row.created_at });
          }
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  } catch (e) {
    console.warn("[dm] realtime subscription failed:", e instanceof Error ? e.message : e);
    return () => {};
  }
}

/* ──────────────────────────── helpers ──────────────────────────── */

type SupabaseClient = ReturnType<typeof import("@/lib/supabase/client").createClient>;

async function sbClient(): Promise<SupabaseClient> {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

async function currentUserId(sb: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user?.id ?? null;
}
