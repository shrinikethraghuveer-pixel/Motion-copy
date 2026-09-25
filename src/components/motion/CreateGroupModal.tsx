"use client";

import { useEffect, useState } from "react";
import { Check, Image as ImageIcon, Loader2, Search, Users, X } from "lucide-react";
import type { PublicUser } from "@/lib/schema";
import { api } from "@/lib/client";
import { Avatar } from "@/components/ui/primitives";

/**
 * Create Group — dark liquid-glass dialog with name, description, picture,
 * and a searchable checkbox list for initial members.
 */
export default function CreateGroupModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  /** Resolves with the new group id after backend creation. */
  onCreate: (input: { name: string; description: string; avatarUrl: string | null; memberIds: string[] }) => Promise<string>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<PublicUser[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced member search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let current = true;
    const t = window.setTimeout(async () => {
      try {
        const response = await api<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);
        if (current) setResults(response.users);
      } catch {
        if (current) setResults([]);
      } finally {
        if (current) setSearching(false);
      }
    }, 250);
    return () => { current = false; window.clearTimeout(t); };
  }, [query]);

  const toggle = (user: PublicUser) => {
    setSelected((cur) => cur.includes(user.id) ? cur.filter((x) => x !== user.id) : [...cur, user.id]);
    setSelectedUsers((cur) => cur.some((x) => x.id === user.id) ? cur.filter((x) => x.id !== user.id) : [...cur, user]);
  };

  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), description: description.trim(), avatarUrl: avatarUrl.trim() || null, memberIds: selected });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the group");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 text-zinc-100 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users size={18} className="text-violet-400" /> Create Group Chat
          </h2>
          <button type="button" onClick={onClose} className="rounded-full border border-zinc-800 bg-zinc-800/60 p-1.5 text-zinc-400 transition hover:text-zinc-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="group-name" className="mb-1.5 block text-xs font-medium text-zinc-400">Group Name</label>
            <input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hackathon Crew"
              maxLength={60}
              className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/60 placeholder:text-zinc-500"
            />
          </div>

          <div>
            <label htmlFor="group-desc" className="mb-1.5 block text-xs font-medium text-zinc-400">Description <span className="text-zinc-600">(optional)</span></label>
            <textarea
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group about?"
              rows={2}
              maxLength={280}
              className="w-full resize-none rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/60 placeholder:text-zinc-500"
            />
          </div>

          <div>
            <label htmlFor="group-pic" className="mb-1.5 block text-xs font-medium text-zinc-400">Group Picture <span className="text-zinc-600">(image URL)</span></label>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-800/50">
                {avatarUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-supplied URL
                  <img src={avatarUrl.trim()} alt="Group preview" className="size-full object-cover" />
                ) : (
                  <ImageIcon size={16} className="text-zinc-500" />
                )}
              </span>
              <input
                id="group-pic"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…/picture.png"
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/60 placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="group-members" className="mb-1.5 block text-xs font-medium text-zinc-400">
              Add Members {selected.length > 0 && <span className="text-violet-400">· {selected.length} selected</span>}
            </label>
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                id="group-members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the whole platform…"
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/50 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/60 placeholder:text-zinc-500"
              />
            </label>
            {selectedUsers.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{selectedUsers.map((user) => <span key={user.id} className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 py-1 pl-1 pr-1.5 text-[11px] text-zinc-200"><Avatar user={{id:user.id,name:user.name,photo:user.photo}} size={20}/><span>@{user.handle}</span><button type="button" onClick={() => toggle(user)} aria-label={`Remove @${user.handle}`} className="ml-0.5 rounded-full p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-white"><X size={12}/></button></span>)}</div>}
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/40 p-1.5">
              {searching && <p className="px-2 py-2 text-xs text-zinc-500">Searching…</p>}
              {!searching && query.trim() && results.length === 0 && <p className="px-2 py-2 text-xs text-zinc-500">No users found.</p>}
              {!query.trim() && <p className="px-2 py-2 text-xs text-zinc-500">Search by name or @handle to pick members.</p>}
              {results.map((u) => {
                const active = selected.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u)}
                    aria-pressed={active}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${active ? "bg-violet-600/15" : "hover:bg-zinc-800/60"}`}
                  >
                    <Avatar user={{ id: u.id, name: u.name, photo: u.photo }} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-zinc-100">{u.name}</span>
                      <span className="block truncate text-[11px] text-zinc-500">@{u.handle}</span>
                    </span>
                    <span className={`grid size-4.5 shrink-0 place-items-center rounded-md border ${active ? "border-violet-500 bg-violet-600 text-white" : "border-zinc-600"}`}>
                      {active && <Check size={11} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={!name.trim() || creating}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating && <Loader2 size={15} className="animate-spin" />}
            Create Group Chat
          </button>
        </div>
      </form>
    </div>
  );
}
