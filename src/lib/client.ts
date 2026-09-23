"use client";

import type { FeedPost, PublicUser, ThreadSummary, SuggestedUser, Notification, Group, EventMeta } from "@/lib/schema";

export type { FeedPost, PublicUser, ThreadSummary, SuggestedUser, Notification, Group, EventMeta };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface ProfilePayload {
  user: PublicUser;
  posts: FeedPost[];
  highlights: FeedPost[];
  clubs: Array<{ id: string; name: string; tag: string; role: string; memberCount: number }>;
  stats: { connections: number; posts: number; following: number };
  /** True when the account is private/deactivated and content is withheld. */
  locked?: boolean;
}

export interface ConnectionsPayload {
  friends: PublicUser[];
  incoming: PublicUser[];
  outgoing: PublicUser[];
}

export interface GroupsPayload {
  groups: Array<{
    id: string;
    name: string;
    tag: string;
    description: string;
    school: string | null;
    memberCount: number;
    myRole: string | null;
    members: Array<PublicUser & { role: string }>;
  }>;
}

export interface MySpacePayload {
  school: string;
  classmates: PublicUser[];
  events: Array<{ postId: string; title: string; date: string; location: string; kind: string }>;
  schoolGroups: Array<{ id: string; name: string; tag: string; memberCount: number; myRole: string | null }>;
  myGroups: Array<{ id: string; name: string; tag: string; memberCount: number; myRole: string | null }>;
  news: Array<{ id: string; title: string; tag: string }>;
}

export interface ExplorePayload {
  people: PublicUser[];
  mediaPosts: FeedPost[];
  tags: string[];
}
