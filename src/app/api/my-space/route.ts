import { hydratePost, json, requireUser, toPublicUser, withSettings } from "@/lib/server";

export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const classmates = db.users.filter((u) => u.school === me.school && u.id !== me.id);
  const friends=new Set(db.connections.filter(c=>c.status==="accepted"&&(c.requesterId===me.id||c.targetId===me.id)).map(c=>c.requesterId===me.id?c.targetId:c.requesterId));
  const savedPosts = db.posts
    .filter((p) => {
      if(!p.savedBy.includes(me.id))return false;
      const author=db.users.find(u=>u.id===p.authorId);if(!author||author.deactivatedAt)return false;
      const s=withSettings(author),mine=withSettings(me);
      return (!s.privateProfile||friends.has(author.id)||author.id===me.id)&&!s.blocked.includes(me.id)&&!mine.blocked.includes(author.id)&&!mine.muted.includes(author.id);
    })
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const events = savedPosts
    .filter((p) => p.event)
    .sort((a, b) => +new Date(a.event!.date) - +new Date(b.event!.date));

  const schoolGroups = db.groups.filter((g) => g.school === me.school);
  const myGroups = db.groups.filter((g) => g.members.some((m) => m.userId === me.id));

  const news = [
    { id: "nw1", title: `${me.school}: midterm study week announced`, tag: "Academics" },
    { id: "nw2", title: "Club fair moved to the main quad — 40+ student groups", tag: "Campus" },
    { id: "nw3", title: "Weekend sports fixtures posted — cricket and basketball", tag: "Sports" },
  ];

  return json({
    school: me.school,
    classmates: classmates.map((u) => toPublicUser(db, u, me.id)),
    saved: savedPosts.map(p=>hydratePost(db,p,me.id)),
    events: events.map((p) => ({ postId: p.id, ...p.event! })),
    schoolGroups: schoolGroups.map((g) => ({ id: g.id, name: g.name, tag: g.tag, memberCount: g.members.length, myRole: g.members.find((m) => m.userId === me.id)?.role ?? null })),
    myGroups: myGroups.map((g) => ({ id: g.id, name: g.name, tag: g.tag, memberCount: g.members.length, myRole: g.members.find((m) => m.userId === me.id)?.role ?? null })),
    news,
  });
}
