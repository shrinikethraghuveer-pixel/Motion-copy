"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { uploadProfileImage, updateOwnProfile, type ProfileUpdatePatch } from "@/lib/db/profiles";
import { prepareProfileImage } from "@/lib/image";
import type { ProfileRow } from "@/lib/db/schema-types";

/** Strict dual-theme input token shared by every field. */
const FIELD =
  "w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors " +
  "light:border-slate-300 light:bg-white light:text-zinc-900 light:placeholder:text-zinc-400 light:focus:border-violet-500 " +
  "dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/70";

const LABEL = "mb-1.5 block text-xs font-semibold light:text-zinc-600 dark:text-zinc-400";

interface EditProfileModalProps {
  profile: ProfileRow;
  onClose: () => void;
  /** Receive the freshly-persisted row (or null on legacy store — patch is applied locally). */
  onSaved: (patch: ProfileUpdatePatch, fresh: ProfileRow | null) => void;
}

export default function EditProfileModal({ profile, onClose, onSaved }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.display_name || profile.full_name || "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [location, setLocation] = useState(profile.location ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.website_url ?? "");
  const [githubUrl, setGithubUrl] = useState(profile.github_url ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(profile.linkedin_url ?? "");
  const [techInput, setTechInput] = useState("");
  const [techStack, setTechStack] = useState<string[]>(profile.tech_stack ?? []);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [coverUrl, setCoverUrl] = useState(profile.banner_url || profile.cover_url);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const addTech = () => {
    const tag = techInput.trim().replace(/^#/, "");
    if (!tag) return;
    if (!techStack.some((t) => t.toLowerCase() === tag.toLowerCase())) setTechStack([...techStack, tag]);
    setTechInput("");
  };

  const upload = async (file: File | undefined, kind: "avatar" | "cover") => {
    if (!file) return;
    setError(null);
    setUploading(kind);
    try {
      const prepared = await prepareProfileImage(file, kind === "avatar" ? "avatar" : "banner");
      const url = await uploadProfileImage(prepared, kind);
      if (kind === "avatar") setAvatarUrl(url);
      else setCoverUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (displayName.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    const patch: ProfileUpdatePatch = {
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      headline: headline.trim() || null,
      location: location.trim() || null,
      website_url: websiteUrl.trim() || null,
      github_url: githubUrl.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      tech_stack: techStack,
      ...(avatarUrl !== profile.avatar_url ? { avatar_url: avatarUrl } : {}),
      ...(coverUrl !== (profile.banner_url || profile.cover_url) ? { cover_url: coverUrl, banner_url: coverUrl } : {}),
    };
    try {
      const fresh = await updateOwnProfile(patch);
      onSaved(patch, fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your profile.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit profile">
      {/* Glass backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="light:bg-white light:border-slate-300 dark:bg-zinc-900 dark:border-zinc-800 light:text-zinc-900 dark:text-zinc-100 relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-2xl">
        <header className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit Profile</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="light:text-zinc-500 light:hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-lg p-1.5 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── Cover + avatar uploads ─────────────────────────────────── */}
        <div className="relative mb-6">
          <div
            className={`light:from-violet-600/30 light:to-cyan-500/30 dark:from-violet-600/25 dark:to-cyan-500/25 relative h-28 w-full overflow-hidden rounded-xl bg-gradient-to-r ${coverUrl ? "" : ""}`}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="Cover preview" className="h-full w-full object-cover" />
            ) : (
              <span className="light:text-zinc-500 dark:text-zinc-400 absolute inset-0 flex items-center justify-center text-xs">
                No cover photo yet
              </span>
            )}
          </div>
          <button
            onClick={() => coverInputRef.current?.click()}
            disabled={uploading !== null}
            className="light:bg-white/90 light:text-zinc-700 light:hover:bg-white dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-800 absolute -bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium shadow-md transition-colors disabled:opacity-60"
          >
            {uploading === "cover" ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            {coverUrl ? "Change cover" : "Add cover"}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0], "cover")}
          />

          <div className="absolute -bottom-7 left-4">
            <div className="light:ring-slate-200 dark:ring-zinc-900 relative aspect-square h-16 w-16 overflow-hidden rounded-full ring-4">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Avatar preview" className="aspect-square h-full w-full rounded-full object-cover" />
              ) : (
                <span className="light:bg-slate-200 dark:bg-zinc-800 flex h-full w-full items-center justify-center">
                  <Camera size={18} className="light:text-zinc-500 dark:text-zinc-400" />
                </span>
              )}
            </div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploading !== null}
              className="light:bg-white/90 light:text-zinc-600 light:hover:text-violet-600 dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:text-violet-400 absolute inset-0 flex items-center justify-center rounded-full text-transparent opacity-0 transition-opacity hover:opacity-100"
              aria-label="Upload avatar"
            >
              {uploading === "avatar" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            </button>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0], "avatar")}
          />
        </div>
        <div className="h-8" aria-hidden="true" />

        {/* ── Fields ─────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="ep-name">
              Display name
            </label>
            <input id="ep-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={FIELD} maxLength={40} />
          </div>

          <div>
            <label className={LABEL} htmlFor="ep-headline">
              Headline
            </label>
            <input
              id="ep-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. CS sophomore building iOS apps"
              className={FIELD}
              maxLength={80}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="ep-bio">
              Bio
            </label>
            <textarea
              id="ep-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people what you're building…"
              rows={3}
              maxLength={280}
              className={`${FIELD} resize-none`}
            />
            <p className="light:text-zinc-400 dark:text-zinc-500 mt-1 text-right text-[10px]">{bio.length}/280</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="ep-location">
                Location
              </label>
              <input
                id="ep-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, School…"
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="ep-website">
                Portfolio URL
              </label>
              <input
                id="ep-website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="yoursite.dev"
                className={FIELD}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="ep-github">
                GitHub
              </label>
              <input
                id="ep-github"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="github.com/you"
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="ep-linkedin">
                LinkedIn
              </label>
              <input
                id="ep-linkedin"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="linkedin.com/in/you"
                className={FIELD}
              />
            </div>
          </div>

          {/* Tech stack tag input */}
          <div>
            <label className={LABEL} htmlFor="ep-tech">
              Tech stack
            </label>
            <div className={`${FIELD} flex flex-wrap items-center gap-1.5 !py-2`}>
              {techStack.map((tag) => (
                <span
                  key={tag}
                  className="light:bg-slate-100 light:text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200 flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                >
                  #{tag.replace(/\s+/g, "")}
                  <button
                    onClick={() => setTechStack(techStack.filter((t) => t !== tag))}
                    aria-label={`Remove ${tag}`}
                    className="light:text-zinc-400 light:hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                id="ep-tech"
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTech();
                  } else if (e.key === "Backspace" && !techInput && techStack.length > 0) {
                    setTechStack(techStack.slice(0, -1));
                  }
                }}
                onBlur={addTech}
                placeholder={techStack.length === 0 ? "NextJS, Tailwind, Supabase…" : ""}
                className="min-w-24 flex-1 bg-transparent text-sm outline-none light:placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>
          </div>
        </div>

        {error && <p className="light:text-rose-600 dark:text-rose-400 mt-3 text-sm">{error}</p>}

        <footer className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="light:text-zinc-600 light:hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || uploading !== null}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Saving…
              </span>
            ) : (
              "Save changes"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
