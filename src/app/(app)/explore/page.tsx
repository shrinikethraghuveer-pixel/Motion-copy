"use client";

import { useCallback, useEffect, useState } from "react";
import { Compass, Heart, Rocket, Search, Sparkles, TrendingUp, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { api, type ExplorePayload, type FeedPost } from "@/lib/client";
import { useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { ConnectMessageButtons } from "@/components/profile/ProfileHeaderCard";
import { timeAgo } from "@/lib/utils";

const CATEGORIES = ["All", "Trending Projects", "Hackathons", "Tech Guilds", "Campus Creators"];

function projectTitle(post: FeedPost) {
  return post.event?.title ?? (post.text.split(/[.!?]/)[0].slice(0, 58) || "Motion project");
}

function projectTags(post: FeedPost) {
  return post.event ? [post.event.kind, "Campus Event"] : [post.type === "opportunity" ? "Opportunity" : "Community", "Motion"];
}

export default function ExplorePage() {
  const params = useSearchParams();
  const { toast, openProfile } = useUI();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [data, setData] = useState<ExplorePayload | null>(null);

  const load = useCallback(async () => {
    try {
      const search = new URLSearchParams({ tag: category === "All" ? "All" : category });
      if (query.trim()) search.set("q", query.trim());
      setData(await api<ExplorePayload>(`/api/explore?${search}`));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load explore");
    }
  }, [category, query, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const projects = (data?.mediaPosts ?? []).filter((p) => p && p.id && p.author);
  const people = (data?.people ?? []).filter((p) => p && p.id);
  const tags = (data?.tags ?? []).filter((t) => t);

  return (
    <div className="relative min-h-[calc(100vh-5rem)] bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col gap-6 px-4 py-6">
        <section className="rounded-2xl border border-white/90 bg-white/80 p-6 shadow-xl shadow-slate-300/50 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-gradient-to-r from-violet-600/20 to-cyan-500/20 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300"><Compass size={13} /> Discover what is moving</span>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Explore Motion</h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Find ambitious projects, thoughtful collaborators, and your next campus spark.</p>
            </div>
            <button className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700"><Rocket size={15} className="mr-2 inline" />Submit Motion Project</button>
          </div>
          <label className="relative mt-6 block">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, people, skills, and schools..." aria-label="Search Explore" className="w-full rounded-xl border border-slate-300/80 bg-white/80 py-3 pl-10 pr-4 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-500 focus:bg-white focus:border-violet-500 dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:text-zinc-100 dark:placeholder:text-zinc-500" />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map((item) => <button key={item} onClick={() => setCategory(item)} className={`rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${category === item ? "bg-violet-600 text-white shadow-md shadow-violet-600/20" : "border border-slate-300/70 bg-white/70 text-zinc-700 hover:bg-slate-100/80 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60"}`}>{item}</button>)}
          </div>
        </section>

        <section className="rounded-2xl border border-white/90 bg-white/80 p-6 shadow-xl shadow-slate-300/50 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Featured discovery</span><h2 className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">Build something that gets people talking</h2><p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">Join the Hackathon Guild and turn a rough idea into a project with people who care.</p></div>
            <button className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700">Join Hackathon Guild</button>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-8">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-zinc-100"><TrendingUp size={18} className="text-violet-600 dark:text-violet-400" /> Trending Motion Projects</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Fresh ideas from builders in your orbit.</p></div><span className="text-xs text-zinc-500">{projects.length} found</span></div>
            {!data ? <div className="h-48 animate-pulse rounded-2xl bg-white/80 shadow-md dark:bg-zinc-900/60" /> : projects.length === 0 ? <EmptyState icon={<Sparkles size={26} />} title="No projects match" hint="Try another search or category." /> : <div className="grid gap-4 sm:grid-cols-2">{projects.map((post) => post && post.id ? <article key={post.id} className="rounded-2xl border border-white/90 bg-white/80 p-5 shadow-md shadow-slate-300/50 transition-all hover:border-violet-300/80 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none dark:hover:border-zinc-700"><div className="flex items-start justify-between gap-3"><h3 className="font-bold text-zinc-900 dark:text-zinc-100">{projectTitle(post)}</h3><span className="rounded-full bg-violet-600/10 p-1.5 text-violet-600 dark:text-violet-400"><Sparkles size={14} /></span></div><p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{post.text}</p><div className="mt-4 flex flex-wrap gap-1.5">{projectTags(post).map((tag) => <span key={tag} className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700/50 dark:bg-zinc-800/60 dark:text-zinc-300">{tag}</span>)}</div><div className="mt-5 flex items-center justify-between border-t border-slate-200/80 pt-3 dark:border-zinc-800"><button onClick={() => post.author?.handle && openProfile(post.author.handle)} className="flex min-w-0 items-center gap-2"><Avatar user={post.author} size={28} /><span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{post.author?.name ?? 'Unknown'}</span></button><span className="flex items-center gap-2 text-xs text-zinc-500"><Heart size={13} /> {post.likes?.length ?? 0} · {timeAgo(post.createdAt)}</span></div></article> : null)}</div>}
          </section>

          <aside className="space-y-4 lg:col-span-4">
            <div className="rounded-2xl border border-white/90 bg-white/80 p-5 shadow-md shadow-slate-300/50 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none"><h2 className="flex items-center gap-2 font-bold text-zinc-900 dark:text-zinc-100"><Users size={17} className="text-violet-600 dark:text-violet-400" /> Recommended collaborators</h2><div className="mt-4 space-y-3">{people.slice(0, 4).map((person) => person && person.id ? <div key={person.id} className="flex items-center gap-2.5"><button onClick={() => person.handle && openProfile(person.handle)}><Avatar user={person} size={34} /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{person.name ?? 'Collaborator'}</p><p className="truncate text-xs text-zinc-500">{person.skills && person.skills.length > 0 ? person.skills.slice(0, 2).join(" · ") : 'No skills listed'}</p></div><ConnectMessageButtons user={person} size="sm" onChange={load} /></div> : null)}</div></div>
            <div className="rounded-2xl border border-white/90 bg-white/80 p-5 shadow-md shadow-slate-300/50 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none"><h2 className="font-bold text-zinc-900 dark:text-zinc-100">Popular tags</h2><div className="mt-4 flex flex-wrap gap-2">{tags.slice(0, 10).map((item) => item ? <button key={item} onClick={() => setQuery(item)} className="rounded-full border border-slate-300/70 bg-slate-100/90 px-3 py-1.5 text-xs text-zinc-700 transition hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700/50 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:text-violet-300">#{item}</button> : null)}</div></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
