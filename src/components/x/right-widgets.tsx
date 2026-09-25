import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/shadcn/card";
import { Button } from "@/components/ui/shadcn/button";
import SuggestedUsers from "@/components/motion/suggested-users";

const TRENDING_ITEMS = [
  { tag: "#BuildInPublic", meta: "Student · Trending", posts: "2,418 posts" },
  { tag: "#HackathonSeason", meta: "Motion · Trending", posts: "1,902 posts" },
  { tag: "#LineFollower", meta: "Robotics · Trending", posts: "842 posts" },
];

export default function RightWidgets() {
  return (
    <aside className="block space-y-4">
      <Card className="xl:sticky xl:top-24">
        <CardHeader>
          <CardTitle>Trending in Motion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {TRENDING_ITEMS.map((item) => (
            <button key={item.tag} className="block w-full text-left transition hover:opacity-80">
              <p className="text-[11px] text-muted-foreground">{item.meta}</p>
              <p className="text-sm font-bold text-foreground">{item.tag}</p>
              <p className="text-[11px] text-muted-foreground">{item.posts}</p>
            </button>
          ))}
          <Button variant="link" className="h-auto p-0 text-cyan-300">Show more</Button>
        </CardContent>
      </Card>
      <SuggestedUsers />
    </aside>
  );
}
