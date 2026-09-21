export interface MockPost {
  id: string;
  name: string;
  handle: string;
  time: string;
  text: string;
  replies: number;
  reposts: number;
  likes: number;
  accent: string; // gradient avatar classes
}

export const MOCK_POSTS: MockPost[] = [
  {
    id: "p1",
    name: "Maya Chen",
    handle: "@mayacodes",
    time: "12m",
    text: "ship the ugly version. feedback beats perfection every single time — hackathon demo in 6 hours and our build finally compiles 🚀",
    replies: 24,
    reposts: 11,
    likes: 214,
    accent: "from-violet-500 to-indigo-500",
  },
  {
    id: "p2",
    name: "Arjun Mehta",
    handle: "@arjun.builds",
    time: "1h",
    text: "3:47 AM build nights hit different when the whole team is on one call. Coffee count: lost.",
    replies: 8,
    reposts: 3,
    likes: 96,
    accent: "from-indigo-500 to-cyan-500",
  },
  {
    id: "p3",
    name: "Zoe Alvarez",
    handle: "@zoedesigns",
    time: "3h",
    text: "redesigned my portfolio tonight — dark mode everything, obviously. feedback welcome before I ship it 🎨",
    replies: 15,
    reposts: 7,
    likes: 182,
    accent: "from-cyan-500 to-violet-500",
  },
  {
    id: "p4",
    name: "Liam Park",
    handle: "@liamtech",
    time: "5h",
    text: "Robotics Fall Kickoff is live — build a line-follower in a weekend, kits provided. Bringing the whole club.",
    replies: 6,
    reposts: 14,
    likes: 73,
    accent: "from-violet-600 to-cyan-400",
  },
  {
    id: "p5",
    name: "Priya Nair",
    handle: "@priyacodes",
    time: "8h",
    text: "my diffusion-models notebook finally reproduced the paper results. two weeks of GPU queueing. worth it.",
    replies: 12,
    reposts: 5,
    likes: 141,
    accent: "from-indigo-400 to-violet-600",
  },
];

export const TRENDING = [
  { tag: "#BuildInPublic", meta: "Student · Trending", posts: "2,418 posts" },
  { tag: "#HackathonSeason", meta: "Motion · Trending", posts: "1,902 posts" },
  { tag: "#LineFollower", meta: "Robotics · Trending", posts: "842 posts" },
  { tag: "#DarkModeEverything", meta: "Design · Trending", posts: "611 posts" },
];

export const WHO_TO_FOLLOW = [
  { name: "Noah Kim", handle: "@noahlabs", bio: "Intern @ drone startup · CV + embedded", accent: "from-violet-500 to-cyan-500" },
  { name: "Mia Okafor", handle: "@mia.makes", bio: "robotics + art, yes both", accent: "from-cyan-400 to-indigo-500" },
  { name: "Dev Dhillon", handle: "@devdhillon", bio: "cricket · fantasy league commissioner", accent: "from-indigo-500 to-violet-600" },
];
