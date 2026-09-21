"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/shadcn/card";
import { Input } from "@/components/ui/shadcn/input";
import { Badge } from "@/components/ui/shadcn/badge";
import { WHO_TO_FOLLOW } from "@/components/x/mock-data";
import { cn } from "@/lib/utils";

export function RightWidgets() {
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  function toggleFollow(handle: string) {
    setFollowed((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  return (
    <aside className="sticky top-0 hidden h-screen space-y-4 py-4 pl-2 xl:block">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search Motion"
          className="rounded-full bg-zinc-950/40 pl-10"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trending in Motion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {TRENDING_ITEMS.map((t) => (
            <button key={t.tag} className="block w-full text-left transition hover:opacity-80">
              <p className="text-[11px] text-muted-foreground">{t.meta}</p>
              <p className="text-sm font-bold text-foreground">{t.tag}</p>
              <p className="text-[11px] text-muted-foreground">{t.posts}</p>
            </button>
          ))}
          <Button variant="link" className="h-auto p-0 text-cyan-300">
            Show more
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who to follow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {WHO_TO_FOLLOW.map((p) => {
            const isFollowed = followed.has(p.handle);
            return (
              <div key={p.handle} className="flex items-center gap-2.5">
                <div className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-bold text-white", p.accent)}>
                  {p.name.split(" ").map((w) => w[0]).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.handle}</p>
                </div>
                <Button
                  size="sm"
                  className="rounded-full px-4 font-semibold"
                  variant={isFollowed ? "glass" : "default"}
                  onClick={() => toggleFollow(p.handle)}
                >
                  {isFollowed ? "Following" : "Follow"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5 px-2">
        {["Terms", "Privacy", "Cookies", "Accessibility", "Ads info"].map((x) => (
          <Badge key={x} variant="glass">{x}</Badge>
        ))}
      </div>
    </aside>
  );
}

const TRENDING_ITEMS = [
  { tag: "#BuildInPublic", meta: "Student · Trending", posts: "2,418 posts" },
  { tag: "#HackathonSeason", meta: "Motion · Trending", posts: "1,902 posts" },
  { tag: "#LineFollower", meta: "Robotics · Trending", posts: "842 posts" },
];

export default RightWidgets;
