"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertTriangle, Bell, Bot, Check, Globe, KeyRound, Laptop, Lock, LogOut,
  Palette, ShieldCheck, Sliders, Smartphone, Trash2, Upload, User,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Cropper from "react-easy-crop";
import { prepareProfileImage, type ImageCropArea } from "@/lib/image";

type Tab = "account" | "privacy" | "notifications" | "appearance" | "ai" | "security";
type ManagedSession = { token: string; device: string; createdAt: string; lastSeenAt: string };

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "account", label: "Account & Profile", icon: User },
  { id: "privacy", label: "Privacy & Safety", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance & Display", icon: Palette },
  { id: "ai", label: "Groq AI Preferences", icon: Bot },
  { id: "security", label: "Security & Logins", icon: KeyRound },
];

const glass = "rounded-2xl border border-slate-300/80 bg-slate-100/80 p-5 shadow-xl shadow-slate-300/50 backdrop-blur-xl transition-all duration-200 hover:border-slate-300 hover:bg-slate-200/60 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60 sm:p-6";
const input = "w-full rounded-xl border border-slate-300/60 bg-slate-200/80 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-500 focus:border-violet-500 focus:bg-slate-100 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-800/50";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? "bg-violet-600" : "bg-zinc-700"}`}><span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${checked ? "translate-x-5" : "translate-x-0"}`} /></button>;
}

function PageHeading({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="mb-6 flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/15 text-violet-400"><Icon size={19} /></span><div><h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p></div></div>;
}

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</h3><p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{description}</p></div><div className="shrink-0">{children}</div></div>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [toast, setToast] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState<Array<{id:string;handle:string;name:string}>>([]);
  const [blocked, setBlocked] = useState<Array<{id:string;handle:string;name:string}>>([]);
  const [listModal, setListModal] = useState<"muted"|"blocked"|null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const [passwords, setPasswords] = useState({current:"", next:"", confirm:""});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [cropSelection, setCropSelection] = useState<{ file: File; preview: string; kind: "avatars" | "banners" } | null>(null);
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropAreaPixels, setCropAreaPixels] = useState<ImageCropArea | null>(null);
  const [profile, setProfile] = useState({ name: "", username: "", bio: "", school: "", phone: "" });
  const [settings, setSettings] = useState<Record<string, boolean>>({ private: false, discovery: true, connections: true, events: true, polls: true, social: true, reducedMotion: false, sharpening: true, ranking: true, twoFactor: false });
  const [dmAudience, setDmAudience] = useState("Everyone");
  const [mentions, setMentions] = useState("Everyone");
  const [digest, setDigest] = useState("Weekly Summary");
  const [theme, setTheme] = useState("dark");
  const [accent, setAccent] = useState("#7c3aed");
  const [model, setModel] = useState("Llama-3.3-70b");
  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [activeSessionToken, setActiveSessionToken] = useState<string | null>(null);
  const [confirmCurrentLogout, setConfirmCurrentLogout] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load settings.");
        const p = data.profile;
        setSessions(data.sessions ?? []); setActiveSessionToken(data.activeSessionToken ?? null);
        setProfile({name:p.name ?? "", username:p.handle ?? "", bio:p.bio ?? "", school:p.school ?? "", phone:p.phone ?? ""});
        setAvatar(p.photo); setBanner(p.banner);
        setMuted(data.muted ?? []); setBlocked(data.blocked ?? []);
        const s = data.settings;
        setSettings(old => ({...old, private:s.privateProfile, discovery:s.discoverable, connections:s.notify.connections, events:s.notify.opportunities, polls:s.notify.announcements, social:s.notify.likes, reducedMotion:s.lowSpecMode ?? s.reducedMotion, sharpening:s.aiPostSharpening, ranking:s.aiSmartRanking}));
        setDmAudience(({everyone:"Everyone",connections:"Connections Only",no_one:"No One"} as Record<string,string>)[s.allowDMs] ?? "Everyone");
        setMentions(({everyone:"Everyone",connections:"Connections",no_one:"Off"} as Record<string,string>)[s.allowMentions] ?? "Everyone");
        setDigest(s.emailDigest === "daily" ? "Daily Digest" : s.emailDigest === "off" ? "Off" : "Weekly Summary");
        setTheme(s.theme); setAccent(s.accentColor ?? "#7c3aed"); setModel(s.aiDefaultModel ?? "openai/gpt-oss-20b");
        applyAppearance(s.theme, s.accentColor ?? "#7c3aed", !!s.lowSpecMode);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load settings."); }
    })();
  }, []);

  async function request(method: "PATCH"|"POST", payload: Record<string,unknown>) {
    setBusy(true); setError("");
    try { const response=await fetch("/api/settings",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const data=await response.json(); if(!response.ok) throw new Error(data.error || "Unable to save settings."); saveToast(); return data; }
    catch(e){setError(e instanceof Error?e.message:"Unable to save settings.");throw e;} finally{setBusy(false);}
  }
  const saveToast = () => { setToast(true); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(false), 2600); };
  const save = async () => { await request("PATCH",{name:profile.name,username:profile.username,bio:profile.bio,school:profile.school,phone:profile.phone}); };
  const toggle = async (key: string, value: boolean) => {
    setSettings((old) => ({ ...old, [key]: value }));
    const payload:Record<string,unknown> = key === "private" ? {privateProfile:value} : key === "discovery" ? {discoverable:value} : key === "reducedMotion" ? {lowSpecMode:value} : key === "sharpening" ? {aiPostSharpening:value} : key === "ranking" ? {aiSmartRanking:value} : key === "twoFactor" ? {twoFactorEnabled:value} : key === "social" ? {notify:{likes:value,comments:value}} : {notify:{[({connections:"connections",events:"opportunities",polls:"announcements"} as Record<string,string>)[key] ?? key]:value}};
    try { await request("PATCH",payload); } catch { setSettings(old=>({...old,[key]:!value})); }
  };
  const setImage = async (event: ChangeEvent<HTMLInputElement>, kind:"avatars"|"banners") => {
    const file=event.target.files?.[0]; if(!file)return;
    event.currentTarget.value="";
    if(!file.type.startsWith("image/")||file.size>5*1024*1024){setError("Choose an image under 5 MB.");return;}
    setError("");
    if(cropSelection)URL.revokeObjectURL(cropSelection.preview);
    setCropPosition({x:0,y:0}); setCropZoom(1); setCropAreaPixels(null);
    setCropSelection({file,preview:URL.createObjectURL(file),kind});
  };
  const uploadCrop = async () => {
    if(!cropSelection)return;
    try {
      setBusy(true); setError("");
      const supabase=createClient();
      if(!cropAreaPixels)throw new Error("Adjust the image crop before uploading.");
      const prepared=await prepareProfileImage(cropSelection.file,cropSelection.kind==="avatars"?"avatar":"banner",cropAreaPixels);
      const path=`${(await supabase.auth.getUser()).data.user?.id ?? "local"}/${crypto.randomUUID()}.${prepared.name.split(".").pop()}`;
      const {error:uploadError}=await supabase.storage.from(cropSelection.kind).upload(path,prepared,{contentType:prepared.type,upsert:false});
      if(uploadError)throw uploadError;
      const {data}=supabase.storage.from(cropSelection.kind).getPublicUrl(path);
      const url=data.publicUrl;
      if(cropSelection.kind==="avatars")setAvatar(url);else setBanner(url);
      await request("PATCH",cropSelection.kind==="avatars"?{avatarUrl:url}:{bannerUrl:url});
      URL.revokeObjectURL(cropSelection.preview);setCropSelection(null);
    } catch(e){setError(e instanceof Error?e.message:"Image crop or upload failed.");}
    finally{setBusy(false);}
  };
  const select = async (setter: (value: string) => void, value: string, field?:string) => {
    setter(value);
    if(field==="theme"){applyAppearance(value,accent,settings.reducedMotion);void request("PATCH",{theme:value});}
    else if(field==="accentColor"){applyAppearance(theme,value,settings.reducedMotion);void request("PATCH",{accentColor:value});}
    else if(field==="emailDigest")void request("PATCH",{emailDigest:value==="Off"?"off":value==="Daily Digest"?"daily":"weekly"});
    else if(field==="aiDefaultModel")void request("PATCH",{aiDefaultModel:value});
    else if(field==="allowDMs")void request("PATCH",{allowDMs:value==="Everyone"?"everyone":value==="Connections Only"?"connections":"no_one"});
    else if(field==="allowMentions")void request("PATCH",{allowMentions:value==="Everyone"?"everyone":value==="Connections"?"connections":"no_one"});
  };
  async function manage(action:string,handle:string){const data=await request("POST",{action,handle:handle.replace(/^@/,"")}); const updated=await fetch("/api/settings",{cache:"no-store"}).then(r=>r.json());setBlocked(updated.blocked??[]);setMuted(updated.muted??[]);setHandleInput("");return data;}
  async function accountAction(action:"deactivate"|"delete"){await request("POST",{action,text:deleteWord,confirmed:true});window.location.assign("/welcome");}
  async function updatePassword(){if(!passwords.current){setError("Enter your current password.");return;}if(passwords.next.length<8){setError("Password must be at least 8 characters.");return;}if(passwords.next!==passwords.confirm){setError("The new passwords do not match.");return;}const supabase=createClient();const {data:{user},error:lookupError}=await supabase.auth.getUser();if(lookupError||!user?.email){setError(lookupError?.message??"Sign in to your Supabase account before changing its password.");return;}const {error:verifyError}=await supabase.auth.signInWithPassword({email:user.email,password:passwords.current});if(verifyError){setError("Current password is incorrect.");return;}const {error:e}=await supabase.auth.updateUser({password:passwords.next});if(e)setError(e.message);else{setPasswords({current:"",next:"",confirm:""});saveToast();}}
  async function signOutOthers(){
    setBusy(true); setError("");
    const errors: string[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      try { const { error: authError } = await createClient().auth.signOut({ scope: "others" }); if (authError) errors.push(authError.message); }
      catch (e) { errors.push(e instanceof Error ? e.message : "Could not revoke Supabase sessions."); }
    }
    try {
      const response = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke-others" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not revoke Motion sessions.");
      setSessions((current) => current.filter((session) => session.token === activeSessionToken));
    } catch (e) { errors.push(e instanceof Error ? e.message : "Could not revoke Motion sessions."); }
    setBusy(false);
    if (errors.length) setError(errors.join(" ")); else saveToast();
  }
  async function revokeSession(token: string) {
    try {
      await request("POST", { action: "revoke-session", token });
      setSessions((current) => current.filter((session) => session.token !== token));
    } catch { /* request displays its own error */ }
  }
  async function logOutCurrent() {
    setBusy(true); setError("");
    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        const supabase = createClient();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (session) { const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) throw signOutError; }
      }
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not end the current Motion session.");
      window.location.assign("/welcome");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log out."); setBusy(false); }
  }
  const picker = (value: string, setter: (value: string) => void, options: string[],field?:string) => <div className="flex flex-wrap gap-2">{options.map((option) => <button type="button" key={option} onClick={() => select(setter, option,field)} className={`rounded-xl border px-3 py-2 text-sm transition ${value === option ? "border-violet-500 bg-violet-600/15 text-violet-400" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>{option}</button>)}</div>;

  return <main className="max-w-6xl mx-auto px-4 py-8">
    <header className="mb-7"><p className="text-sm font-medium text-violet-400">Personal workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h1><p className="mt-2 text-zinc-500 dark:text-zinc-400">Shape Motion around the way you connect, create, and focus.</p></header>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <aside className="lg:col-span-4"><nav className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition lg:w-full ${tab === id ? "border-violet-500 border-l-2 bg-violet-600/15 font-medium text-violet-400 dark:bg-violet-600/15" : "border-slate-300/80 bg-slate-100/80 text-zinc-600 hover:bg-slate-200/60 hover:text-zinc-900 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"}`}><Icon size={17} />{label}</button>)}</nav></aside>
      <section className="lg:col-span-8">
        {tab === "account" && <div className={glass}><PageHeading icon={User} title="Account & Profile" description="Manage the identity people see across Motion." />
          <div className="grid gap-4 sm:grid-cols-2"><Uploader title="Profile photo" preview={avatar} circular onChange={(event) => setImage(event,"avatars")} /><Uploader title="Profile banner" preview={banner} onChange={(event) => setImage(event,"banners")} /></div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Display name"><input className={input} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field><Field label="Username"><div className="relative"><span className="absolute left-3.5 top-2.5 text-zinc-400">@</span><input className={`${input} pl-7`} value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></div></Field><div className="sm:col-span-2"><Field label="Bio"><textarea className={`${input} min-h-24 resize-y`} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} /></Field></div><Field label="Campus / School"><input className={input} value={profile.school} onChange={(e) => setProfile({ ...profile, school: e.target.value })} /></Field><Field label="Phone"><input className={input} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field><Field label="Email"><input className={`${input} cursor-not-allowed opacity-60`} value="aarav@iitd.ac.in" disabled /></Field><div><p className="mb-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">Account type</p><span className="rounded-full border border-violet-500/40 bg-violet-600/15 px-3 py-1 text-sm font-medium text-violet-400">Student</span></div></div><Save onClick={save} /></div>}

        {tab === "privacy" && <div className={glass}><PageHeading icon={ShieldCheck} title="Privacy & Safety" description="Control who can find you and how they interact with you." /><div className="divide-y divide-zinc-200 dark:divide-zinc-800"><Row title="Private account" description="Only approved connections can see your profile and posts."><Toggle checked={settings.private} onChange={(v) => void toggle("private", v)} label="Private account" /></Row><Row title="Campus discovery" description="Allow users from your campus to find you by email or school."><Toggle checked={settings.discovery} onChange={(v) => void toggle("discovery", v)} label="Campus discovery" /></Row><Row title="Direct messages audience" description="Choose who can start a conversation with you.">{picker(dmAudience, setDmAudience, ["Everyone", "Connections Only", "No One"],"allowDMs")}</Row><Row title="Tagging & mentions" description="Choose who can tag or mention you in posts.">{picker(mentions, setMentions, ["Everyone", "Connections", "Off"],"allowMentions")}</Row><Row title="Muted accounts" description="Posts from muted accounts stay out of your feed."><button onClick={() => setListModal("muted")} className="text-sm font-medium text-violet-400">Manage muted ({muted.length})</button></Row><Row title="Blocked accounts" description="Blocked people cannot see your profile or contact you."><button onClick={() => setListModal("blocked")} className="text-sm font-medium text-violet-400">Manage blocked ({blocked.length})</button></Row></div></div>}

        {tab === "notifications" && <div className={glass}><PageHeading icon={Bell} title="Notifications" description="Choose the signals that deserve your attention." /><div className="divide-y divide-zinc-200 dark:divide-zinc-800"><Row title="Connection requests & accepts" description="Know when your network grows."><Toggle checked={settings.connections} onChange={(v) => void toggle("connections", v)} label="Connection notifications" /></Row><Row title="Event invitations & RSVPs" description="Updates from events you are invited to or attending."><Toggle checked={settings.events} onChange={(v) => void toggle("events", v)} label="Event notifications" /></Row><Row title="Poll results & expiration alerts" description="Never miss the outcome of a conversation."><Toggle checked={settings.polls} onChange={(v) => void toggle("polls", v)} label="Poll notifications" /></Row><Row title="Likes, comments & mentions" description="Replies and reactions to your work."><Toggle checked={settings.social} onChange={(v) => void toggle("social", v)} label="Interaction notifications" /></Row><Row title="Email digest" description="A thoughtful summary delivered to your inbox."><select className={`${input} w-44`} value={digest} onChange={(e) => select(setDigest, e.target.value,"emailDigest")}><option>Off</option><option>Daily Digest</option><option>Weekly Summary</option></select></Row></div></div>}

        {tab === "appearance" && <div className={glass}><PageHeading icon={Palette} title="Appearance & Display" description="Fine-tune Motion's visual atmosphere." /><p className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">Theme mode</p><div className="grid gap-3 sm:grid-cols-3">{[{ id: "dark", name: "Dark Mode", note: "Obsidian Glass", preview: "bg-zinc-900 border-zinc-700" }, { id: "light", name: "Light Mode", note: "Off-White Glass", preview: "bg-white border-zinc-200" }, { id: "system", name: "System Default", note: "Match your device", preview: "bg-gradient-to-br from-zinc-950 to-white border-zinc-400" }].map((item) => <button key={item.id} onClick={() => select(setTheme, item.id,"theme")} className={`rounded-2xl border p-3 text-left ${theme === item.id ? "border-violet-500 ring-2 ring-violet-500/25" : "border-zinc-200 dark:border-zinc-700"}`}><span className={`mb-5 block h-12 rounded-lg border ${item.preview}`} /><span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.name}</span><span className="mt-1 block text-xs text-zinc-500">{item.note}</span></button>)}</div><div className="mt-7 border-t border-zinc-200 pt-6 dark:border-zinc-800"><p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Accent color</p><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">A personal spark across active controls.</p><div className="mt-3 flex gap-3">{["#7c3aed", "#06b6d4", "#10b981"].map((color) => <button aria-label={`Use ${color} accent`} key={color} onClick={() => select(setAccent, color,"accentColor")} style={{ backgroundColor: color }} className={`h-9 w-9 rounded-full border-2 ${accent === color ? "border-white ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-zinc-900" : "border-transparent"}`} />)}</div></div><div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800"><Row title="Low Spec / Performance Mode" description="Reduced motion and blur reduction for smoother performance."><Toggle checked={settings.reducedMotion} onChange={(v) => void toggle("reducedMotion", v)} label="Performance mode" /></Row></div></div>}

        {tab === "ai" && <div className={glass}><PageHeading icon={Bot} title="Groq AI Preferences" description="Choose how AI helps make your Motion experience sharper." /><div className="divide-y divide-zinc-200 dark:divide-zinc-800"><Row title="Automatic post sharpening suggestions" description="Get helpful edits before you share a post."><Toggle checked={settings.sharpening} onChange={(v) => void toggle("sharpening", v)} label="Post sharpening suggestions" /></Row><Row title="Smart Feed Ranking via Groq AI" description="Prioritize posts likely to be most relevant to you."><Toggle checked={settings.ranking} onChange={(v) => void toggle("ranking", v)} label="Smart feed ranking" /></Row><Row title="Default model" description="Used for AI-assisted writing and discovery."><select className={`${input} w-52`} value={model} onChange={(e) => select(setModel, e.target.value,"aiDefaultModel")}><option value="openai/gpt-oss-20b">GPT OSS 20B</option><option value="openai/gpt-oss-120b">GPT OSS 120B</option></select></Row></div></div>}

        {tab === "security" && <div className={glass}><PageHeading icon={KeyRound} title="Security & Logins" description="Protect your account and manage trusted devices." /><div className="grid gap-3 sm:grid-cols-2"><Field label="Current password"><input className={input} type="password" autoComplete="current-password" value={passwords.current} onChange={e=>setPasswords({...passwords,current:e.target.value})} /></Field><Field label="New password"><input className={input} type="password" autoComplete="new-password" value={passwords.next} onChange={e=>setPasswords({...passwords,next:e.target.value})} /></Field><Field label="Confirm new password"><input className={input} type="password" autoComplete="new-password" value={passwords.confirm} onChange={e=>setPasswords({...passwords,confirm:e.target.value})} /></Field></div><button onClick={()=>void updatePassword()} disabled={busy} className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500">Update Password</button><div className="mt-7"><h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Active sessions</h3><div className="mt-3 space-y-2"><Session icon={Laptop} name="Current session" detail="This device" /><Session icon={Smartphone} name="Other sessions" detail="Managed by your account provider" /></div><button onClick={()=>void signOutOthers()} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-violet-400"><LogOut size={15} />Log out of all other sessions</button></div><div className="mt-7 border-t border-zinc-200 pt-5 dark:border-zinc-800"><Row title="Two-factor authentication" description="Secure new sign-ins with Supabase Auth verification."><Toggle checked={settings.twoFactor} onChange={(v) => void toggle("twoFactor", v)} label="Two factor authentication" /></Row></div><div className="mt-7 rounded-2xl border border-red-500/30 bg-red-500/5 p-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 text-red-400" size={19} /><div><h3 className="font-semibold text-red-500 dark:text-red-400">Danger Zone</h3><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">These actions affect access to your Motion account.</p></div></div><div className="mt-5 flex flex-wrap gap-3"><button onClick={()=>{setDeleteWord("");setShowDeactivate(true);}} className="rounded-xl border border-red-500/40 px-3.5 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10">Deactivate Account</button><button onClick={()=>{setDeleteWord("");setShowDelete(true);}} className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-400"><Trash2 size={15} />Delete Account</button></div></div></div>}
      </section>
      {tab === "security" && <section className={`${glass} lg:col-span-12`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Session controls</h2><p className="mt-1 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">End this session or revoke individual Motion sessions. Supabase sessions on other devices can be ended with the all sessions action above.</p></div>{!confirmCurrentLogout ? <button disabled={busy} onClick={() => setConfirmCurrentLogout(true)} className="rounded-xl border border-rose-500/30 px-3.5 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50">Log out of this session</button> : <div className="flex items-center gap-2"><span className="text-sm text-zinc-300">Log out of this device?</span><button disabled={busy} onClick={() => void logOutCurrent()} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Logging out…" : "Confirm"}</button><button disabled={busy} onClick={() => setConfirmCurrentLogout(false)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Cancel</button></div>}</div><div className="mt-4 space-y-2">{sessions.filter((session) => session.token !== activeSessionToken).map((session) => <div key={session.token} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300/60 bg-slate-200/50 p-3 dark:border-zinc-800 dark:bg-zinc-950/30"><Laptop size={17} className="text-violet-400" /><div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{session.device}</p><p className="text-xs text-zinc-500">Last active {new Date(session.lastSeenAt).toLocaleString()}</p></div><button disabled={busy} onClick={() => void revokeSession(session.token)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-rose-400/30 hover:text-rose-300">End session</button></div>)}{sessions.filter((session) => session.token !== activeSessionToken).length === 0 && <p className="text-sm text-zinc-500">No other Motion sessions are available to revoke here.</p>}</div></section>}
    </div>
    {error&&<div role="alert" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-red-500/40 bg-zinc-900 px-4 py-3 text-sm text-red-300 shadow-xl">{error}<button className="ml-3 underline" onClick={()=>setError("")}>Dismiss</button></div>}
    {listModal&&<Modal title={listModal==="muted"?"Manage muted accounts":"Manage blocked accounts"} onClose={()=>setListModal(null)}><div className="flex gap-2"><input className={input} placeholder="Enter username" value={handleInput} onChange={e=>setHandleInput(e.target.value)} /><button className="rounded-xl bg-violet-600 px-3 text-white" disabled={!handleInput.trim()||busy} onClick={()=>void manage(listModal==="muted"?"mute":"block",handleInput)}>Add</button></div><div className="mt-4 max-h-64 space-y-2 overflow-auto">{(listModal==="muted"?muted:blocked).map(u=><div key={u.id} className="flex items-center justify-between rounded-xl border border-zinc-700 p-3"><span>{u.name} <span className="text-zinc-500">@{u.handle}</span></span><button className="text-sm text-violet-400" onClick={()=>void manage(listModal==="muted"?"unmute":"unblock",u.handle)}>{listModal==="muted"?"Unmute":"Unblock"}</button></div>)}{(listModal==="muted"?muted:blocked).length===0&&<p className="text-sm text-zinc-500">No accounts in this list.</p>}</div></Modal>}
    {showDeactivate&&<Modal title="Deactivate account?" onClose={()=>setShowDeactivate(false)}><p className="text-sm text-zinc-400">Your profile will be hidden and you will be signed out. You can contact support to reactivate.</p><p className="mt-3 text-sm">Type <b>DEACTIVATE</b> to confirm.</p><input className={`${input} mt-2`} value={deleteWord} onChange={e=>setDeleteWord(e.target.value)} /><div className="mt-4 flex justify-end gap-2"><button onClick={()=>setShowDeactivate(false)} className="rounded-lg px-3 py-2">Cancel</button><button disabled={deleteWord!=="DEACTIVATE"||busy} onClick={()=>void accountAction("deactivate")} className="rounded-lg bg-red-600 px-3 py-2 text-white">Deactivate</button></div></Modal>}
    {showDelete&&<Modal title="Permanently delete account?" onClose={()=>setShowDelete(false)}><p className="text-sm text-red-300">This removes your account and content. This cannot be undone.</p><p className="mt-3 text-sm">Type <b>DELETE</b> to confirm.</p><input className={`${input} mt-2`} value={deleteWord} onChange={e=>setDeleteWord(e.target.value)} /><div className="mt-4 flex justify-end gap-2"><button onClick={()=>setShowDelete(false)} className="rounded-lg px-3 py-2">Cancel</button><button disabled={deleteWord!=="DELETE"||busy} onClick={()=>void accountAction("delete")} className="rounded-lg bg-red-600 px-3 py-2 text-white">Delete permanently</button></div></Modal>}
    {cropSelection&&<Modal title={cropSelection.kind==="avatars"?"Adjust profile photo":"Adjust profile banner"} onClose={()=>{URL.revokeObjectURL(cropSelection.preview);setCropSelection(null);}} className="max-w-2xl"><p className="mb-3 text-sm text-zinc-400">Drag to reposition, then zoom to choose what appears in your {cropSelection.kind==="avatars"?"400 × 400 avatar":"1200 × 400 banner"}.</p><div className={`relative mx-auto w-full overflow-hidden bg-black/50 ${cropSelection.kind==="avatars"?"aspect-square max-w-[420px] rounded-full":"aspect-[3/1] max-w-[720px]"}`}><Cropper image={cropSelection.preview} crop={cropPosition} zoom={cropZoom} aspect={cropSelection.kind==="avatars"?1:3} cropShape={cropSelection.kind==="avatars"?"round":"rect"} showGrid={false} onCropChange={setCropPosition} onZoomChange={setCropZoom} onCropComplete={(_,pixels)=>setCropAreaPixels(pixels)} /></div><label className="mt-5 flex items-center gap-3 text-sm text-zinc-300">Zoom<input aria-label="Image zoom" className="w-full accent-violet-500" type="range" min={1} max={3} step={0.01} value={cropZoom} onChange={e=>setCropZoom(Number(e.target.value))} /></label><div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={()=>{URL.revokeObjectURL(cropSelection.preview);setCropSelection(null);}} className="rounded-lg px-3 py-2 text-sm">Cancel</button><button disabled={busy||!cropAreaPixels} onClick={()=>void uploadCrop()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">{busy?"Uploading…":"Upload"}</button></div></Modal>}
    <div className={`fixed right-6 top-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100 shadow-xl transition-all duration-300 ${toast ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"><Check size={15} /></span>Settings saved successfully</div>
  </main>;
}

let systemThemeListener: ((event:MediaQueryListEvent)=>void)|undefined;
function applyAppearance(theme:string,accent:string,lowSpec:boolean){
  const root=document.documentElement;
  const media=window.matchMedia("(prefers-color-scheme: light)");
  if(systemThemeListener)media.removeEventListener("change",systemThemeListener);
  const setMode=(mode:string)=>{root.dataset.theme=mode==="system"?(media.matches?"light":"dark"):mode;};
  setMode(theme);
  systemThemeListener=theme==="system"?()=>setMode("system"):undefined;
  if(systemThemeListener)media.addEventListener("change",systemThemeListener);
  root.style.setProperty("--accent",accent);
  root.classList.toggle("low-spec",lowSpec);
  localStorage.setItem("motion-theme",theme);
  localStorage.setItem("motion-accent",accent);
  localStorage.setItem("motion-low-spec",String(lowSpec));
}
function Modal({title,children,onClose,className="max-w-md"}:{title:string;children:ReactNode;onClose:()=>void;className?:string}){return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section role="dialog" aria-modal="true" aria-label={title} className={`w-full ${className} rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-2xl`}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label="Close dialog"><span aria-hidden="true">×</span></button></div>{children}</section></div>;}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5"><span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>{children}</label>; }
function Uploader({ title, preview, onChange, circular = false }: { title: string; preview: string | null; onChange: (event: ChangeEvent<HTMLInputElement>) => void; circular?: boolean }) { return <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4 text-center transition hover:border-violet-500/70 dark:border-zinc-700 dark:bg-zinc-950/20">{preview ? <div className={circular?"aspect-square size-20 overflow-hidden rounded-full":"aspect-[3/1] w-full overflow-hidden rounded-xl"}><img src={preview} alt={`${title} preview`} className={`h-full w-full object-cover ${circular?"aspect-square rounded-full":"aspect-[3/1]"}`} /></div> : <><Upload className="mb-2 text-violet-400" size={21} /><span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span><span className="mt-1 text-xs text-zinc-500">Click to upload</span></>}<input className="hidden" type="file" accept="image/*" onChange={onChange} /></label>; }
function Save({ onClick }: { onClick: () => void }) { return <div className="mt-6 flex justify-end border-t border-zinc-200 pt-5 dark:border-zinc-800"><button onClick={onClick} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500">Save changes</button></div>; }
function Session({ icon: Icon, name, detail }: { icon: LucideIcon; name: string; detail: string }) { return <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/20"><span className="rounded-lg bg-violet-600/15 p-2 text-violet-400"><Icon size={17} /></span><div><p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</p><p className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</p></div></div>; }
