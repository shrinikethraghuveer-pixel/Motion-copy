"use client";

/**
 * SearchBar — real-time autocomplete for the navbar.
 * Debounced (180ms), relevance-ranked across People / Events / Topics,
 * grouped results, skeleton loading, empty state, and full keyboard nav
 * (↑/↓ to move, Enter to select, Escape to close, outside-click to dismiss).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Hash, MapPin, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================== mock index ============================== */

interface PersonResult {
  id: string;
  name: string;
  handle: string;
  school: string;
  mutuals: number;
  initials: string;
  sameSchool: boolean;
  recent: boolean;
}

interface EventResult {
  id: string;
  title: string;
  date: string;
  venue: string;
  gradient: string;
}

interface TopicResult {
  id: string;
  tag: string;
  posts: string;
}

const PEOPLE: PersonResult[] = [
  { id: "u1", name: "Maya Chen", handle: "mayacodes", school: "Westfield University", mutuals: 3, initials: "MC", sameSchool: true, recent: true },
  { id: "u2", name: "Arjun Mehta", handle: "arjun.builds", school: "Northgate High", mutuals: 5, initials: "AM", sameSchool: false, recent: true },
  { id: "u3", name: "Zoe Alvarez", handle: "zoedesigns", school: "Lakeside College", mutuals: 1, initials: "ZA", sameSchool: false, recent: false },
  { id: "u4", name: "Noah Kim", handle: "noahlabs", school: "Westfield University", mutuals: 2, initials: "NK", sameSchool: true, recent: false },
  { id: "u5", name: "Mia Okafor", handle: "mia.makes", school: "Lakeside College", mutuals: 3, initials: "MO", sameSchool: false, recent: false },
  { id: "u6", name: "Dev Dhillon", handle: "devdhillon", school: "Northgate High", mutuals: 6, initials: "DD", sameSchool: false, recent: false },
  { id: "u7", name: "Sana Qureshi", handle: "sana.writes", school: "Westfield University", mutuals: 0, initials: "SQ", sameSchool: true, recent: false },
  { id: "u8", name: "Aarav Sharma", handle: "aarav.ai", school: "Westfield University", mutuals: 2, initials: "AS", sameSchool: true, recent: true },
  { id: "u9", name: "Lena Park", handle: "lena.audio", school: "Lakeside College", mutuals: 1, initials: "LP", sameSchool: false, recent: false },
  { id: "u10", name: "Ishita Rao", handle: "ishita.builds", school: "Northgate High", mutuals: 4, initials: "IR", sameSchool: false, recent: false },
];

const EVENTS: EventResult[] = [
  { id: "e1", title: "Northgate Robotics Fall Kickoff", date: "Sat, Oct 3", venue: "Northgate Campus Auditorium", gradient: "from-violet-500/70 to-cyan-500/60" },
  { id: "e2", title: "Intro to UI/UX: Portfolio Crit Night", date: "Wed, Oct 7", venue: "Virtual / Room 402", gradient: "from-cyan-500/70 to-indigo-500/60" },
  { id: "e3", title: "Hackathon Warm-up: Team Forming", date: "Fri, Oct 9", venue: "Virtual", gradient: "from-indigo-500/70 to-fuchsia-500/60" },
  { id: "e4", title: "AI Study Jam: Prompting Basics", date: "Tue, Oct 13", venue: "Westfield Innovation Lab", gradient: "from-sky-500/70 to-violet-500/60" },
];

const TOPICS: TopicResult[] = [
  { id: "t1", tag: "#BuildInPublic", posts: "2,418 posts" },
  { id: "t2", tag: "#HackathonSeason", posts: "1,902 posts" },
  { id: "t3", tag: "#LineFollower", posts: "842 posts" },
  { id: "t4", tag: "#AI", posts: "3,105 posts" },
  { id: "t5", tag: "#Robotics", posts: "1,276 posts" },
  { id: "t6", tag: "#UIUX", posts: "958 posts" },
];

/* ============================== ranking ============================== */

/**
 * Smart relevance score for people:
 *   1. Prefix match strength (name/handle startsWith > includes)
 *   2. Mutual connection count (weighted highest among ties)
 *   3. Same campus/school boost
 *   4. Recently visited/interacted boost
 */
function scorePerson(p: PersonResult, q: string): number {
  const query = q.toLowerCase();
  const name = p.name.toLowerCase();
  const handle = p.handle.toLowerCase();
  const school = p.school.toLowerCase();
  // Hard gate: no text match → not a result (mutuals/boosts only ORDER matches).
  const textScore =
    name.startsWith(query) ? 100 :
    handle.startsWith(query) ? 90 :
    name.includes(query) ? 60 :
    handle.includes(query) ? 50 :
    school.includes(query) ? 30 :
    0;
  if (textScore === 0) return 0;
  return textScore + p.mutuals * 10 + (p.sameSchool ? 15 : 0) + (p.recent ? 8 : 0);
}

function scoreText(text: string, q: string): number {
  const t = text.toLowerCase();
  const query = q.toLowerCase();
  if (t.startsWith(query)) return 100;
  if (t.includes(query)) return 60;
  return 0;
}

/* ============================== component ============================== */

type FlatRow =
  | { kind: "person"; key: string; data: PersonResult }
  | { kind: "event"; key: string; data: EventResult }
  | { kind: "topic"; key: string; data: TopicResult };

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- debounced "search": brief skeleton shimmer to smooth rapid typing
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setDebounced("");
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      setDebounced(query.trim());
      setLoading(false);
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ---- outside click + Escape close
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // ---- ranked results
  const groups = useMemo(() => {
    const q = debounced;
    if (!q) return null;
    const people = PEOPLE.map((p) => ({ p, s: scorePerson(p, q) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map(({ p }) => ({ kind: "person" as const, key: `p-${p.id}`, data: p }));
    const events = EVENTS.filter((e) => scoreText(e.title, q) > 0 || e.venue.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 3)
      .map((e) => ({ kind: "event" as const, key: `e-${e.id}`, data: e }));
    const topics = TOPICS.filter((t) => t.tag.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 3)
      .map((t) => ({ kind: "topic" as const, key: `t-${t.id}`, data: t }));
    return { people, events, topics };
  }, [debounced]);

  const flat: FlatRow[] = useMemo(() => {
    if (!groups) return [];
    return [...groups.people, ...groups.events, ...groups.topics];
  }, [groups]);

  const total = flat.length;

  // ---- keyboard navigation
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !total) {
      if (e.key === "Enter" && query.trim()) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flat[cursor >= 0 ? cursor : 0];
      if (row) select(row);
    }
  }

  function select(row: FlatRow) {
    setOpen(false);
    setQuery("");
    setCursor(-1);
    // Wire to real routes as they come online.
    if (row.kind === "person") window.location.href = `/connect`;
    else if (row.kind === "event") window.location.href = `/my-space`;
    else window.location.href = `/`;
  }

  // keep the highlighted row visible while arrowing through
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-row="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      {/* input */}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search"
          aria-label="Search Motion"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="search-autocomplete"
          autoComplete="off"
          className="h-9 w-full rounded-full border border-white/10 bg-zinc-900/50 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-violet-500/50 focus:outline-none"
        />
      </div>

      {/* dropdown */}
      {showDropdown && (
        <div
          id="search-autocomplete"
          role="listbox"
          className="absolute left-0 top-11 z-50 w-80 max-w-[85vw] max-h-96 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/90 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          {/* loading skeleton */}
          {loading && (
            <div className="space-y-1.5 p-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="size-8 shrink-0 animate-pulse rounded-full bg-zinc-800" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
                    <span className="block h-2 w-1/2 animate-pulse rounded bg-zinc-800/70" />
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* empty state */}
          {!loading && total === 0 && (
            <div className="p-4 text-center">
              <p className="text-sm text-zinc-300">
                No results found for <span className="font-semibold text-zinc-100">&ldquo;{debounced}&rdquo;</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">Try exploring trending posts instead.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {TOPICS.slice(0, 3).map((t) => (
                  <span key={t.id} className="rounded-full border border-white/10 bg-zinc-950/60 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                    {t.tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* results */}
          {!loading && groups && total > 0 && (
            <>
              {groups.people.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">People</p>
                  {groups.people.map((r, i) => {
                    const idx = flat.findIndex((f) => f.key === r.key);
                    return (
                      <button
                        key={r.key}
                        data-row={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => select(r)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                          cursor === idx ? "bg-violet-500/15" : "hover:bg-white/5"
                        )}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-[10px] font-bold text-white">
                          {r.data.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-100">{r.data.name}</span>
                          <span className="block truncate text-[11px] text-zinc-500">@{r.data.handle}</span>
                        </span>
                        {r.data.mutuals > 0 && (
                          <span className="shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                            {r.data.mutuals} mutual
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(r);
                          }}
                          className="shrink-0 rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-violet-500"
                        >
                          <UserPlus size={10} className="mr-0.5 inline" />
                          Connect
                        </span>
                      </button>
                    );
                  })}
                </>
              )}

              {groups.events.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Upcoming Events</p>
                  {groups.events.map((r) => {
                    const idx = flat.findIndex((f) => f.key === r.key);
                    return (
                      <button
                        key={r.key}
                        data-row={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => select(r)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                          cursor === idx ? "bg-violet-500/15" : "hover:bg-white/5"
                        )}
                      >
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br", r.data.gradient)}>
                          <CalendarDays size={13} className="text-white" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-100">{r.data.title}</span>
                          <span className="flex items-center gap-1 truncate text-[11px] text-zinc-500">
                            {r.data.date}
                            <MapPin size={9} className="shrink-0" /> {r.data.venue}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}

              {groups.topics.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Trending</p>
                  {groups.topics.map((r) => {
                    const idx = flat.findIndex((f) => f.key === r.key);
                    return (
                      <button
                        key={r.key}
                        data-row={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => select(r)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                          cursor === idx ? "bg-violet-500/15" : "hover:bg-white/5"
                        )}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-zinc-950/60">
                          <Hash size={12} className="text-violet-400" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-100">{r.data.tag}</span>
                          <span className="block text-[11px] text-zinc-500">{r.data.posts}</span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
