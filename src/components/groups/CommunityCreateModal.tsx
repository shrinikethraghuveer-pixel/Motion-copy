"use client";

import { useState } from "react";
import { ImagePlus, LockKeyhole, Users, X } from "lucide-react";
import { post } from "@/lib/client";

export default function CommunityCreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const result = await post<{ groupId: string }>("/api/groups", {
        action: "create", name, description, tags: tags.split(","), avatarUrl: avatarUrl || null, visibility,
      });
      onCreated(result.groupId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create community.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6 text-zinc-100 shadow-[0_25px_100px_rgba(0,0,0,.6)] sm:p-8">
        <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-violet-300">Start a new circle</p><h2 className="mt-2 text-2xl font-bold">Create a community</h2><p className="mt-1 text-sm text-zinc-400">Give your people a place to build together.</p></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><X size={18} /></button></div>
        <div className="space-y-4">
          <label className="block text-sm font-medium">Community name<input required minLength={3} maxLength={48} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Indie Game Makers" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none placeholder:text-zinc-600 focus:border-violet-400" /></label>
          <label className="block text-sm font-medium">Description<textarea maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What will members make, learn, or share?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none placeholder:text-zinc-600 focus:border-violet-400" /></label>
          <label className="block text-sm font-medium">Tags <span className="font-normal text-zinc-500">(comma separated)</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Design, React, Startups" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none placeholder:text-zinc-600 focus:border-violet-400" /></label>
          <label className="block text-sm font-medium"><span className="flex items-center gap-2"><ImagePlus size={15} /> Avatar image URL <span className="font-normal text-zinc-500">(optional)</span></span><input type="url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none placeholder:text-zinc-600 focus:border-violet-400" /></label>
          <fieldset><legend className="mb-2 text-sm font-medium">Who can join?</legend><div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setVisibility("public")} aria-pressed={visibility === "public"} className={`rounded-xl border p-3 text-left ${visibility === "public" ? "border-violet-400 bg-violet-500/15" : "border-white/10 bg-white/[.03]"}`}><span className="flex items-center gap-2 text-sm font-semibold"><Users size={15} /> Public</span><span className="mt-1 block text-xs text-zinc-400">Anyone can join instantly</span></button>
            <button type="button" onClick={() => setVisibility("private")} aria-pressed={visibility === "private"} className={`rounded-xl border p-3 text-left ${visibility === "private" ? "border-violet-400 bg-violet-500/15" : "border-white/10 bg-white/[.03]"}`}><span className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={15} /> Private</span><span className="mt-1 block text-xs text-zinc-400">Join requests need approval</span></button>
          </div></fieldset>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
        <button disabled={busy || name.trim().length < 3} className="mt-6 w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:brightness-110 disabled:opacity-50">{busy ? "Creating…" : "Create community"}</button>
      </form>
    </div>
  );
}
