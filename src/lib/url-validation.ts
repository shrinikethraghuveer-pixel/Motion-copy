/**
 * Server-side validation for user-supplied media/profile URLs (audit P2).
 *
 * Policy (established product behavior, preserved):
 *  - The app legitimately stores raster images the composer and crop tools
 *    upload: Supabase Storage `https` links and inline `data:` media produced
 *    by the legacy local-store path (data URLs up to the 2 MB attachment
 *    rule enforced in `db/profiles.ts`), plus post videos (data:video / mp4).
 *  - Community/DM-group avatar and event-link fields are USER-TYPED arbitrary
 *    `https` URLs (CommunityCreateModal / CreateGroupModal "Avatar image URL",
 *    communities event "Event link"), and the GIF picker sends
 *    `media.giphy.com` links. Arbitrary HTTPS media/image hosts are therefore
 *    intentional. Documented risks: profiles can reference any public host
 *    (tracking pixels, third-party content) — no server-side fetching of
 *    these URLs exists anywhere in the app (only Upstash, Groq, and the
 *    Supabase API are ever fetched), so there is no SSRF surface.
 *  - Rejected outright: non-http(s) schemes (`javascript:`, `vbscript:`,
 *    `file:`, `blob:`, `ws:`), `data:` payloads that are not allowed image /
 *    video media types (in particular `data:text/html` and
 *    `data:image/svg+xml` — SVG hosts scripted content), URLs with embedded
 *    credentials, plain `http:` on non-local hosts, and oversized values.
 */

export type UrlAccept = { ok: true; url: string };
export type UrlReject = { ok: false; reason: string };
export type UrlResult = UrlAccept | UrlReject;
/** Result for fields that may legitimately end up empty. */
export type OptionalUrlResult = { ok: true; url: string | null } | { ok: false; reason: string };

export const MAX_MEDIA_URLS = 4;
export const MAX_NETWORK_URL_CHARS = 2048;
/** Legacy data URLs: 2,000,000-byte files encode to ~2.67M base64 chars plus prefix. */
export const MAX_DATA_URL_CHARS = 3_000_000;

/** Raster images + videos only; `svg+xml` and everything else is excluded. */
const SAFE_DATA_MEDIA_RE = /^data:(?:image|video)\/(?:png|jpeg|jpg|gif|webp|avif|mp4|webm|mov|quicktime);/i;

function isLocalHttpHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}

export function validateMediaUrl(raw: unknown): UrlResult {
  if (typeof raw !== "string") return { ok: false, reason: "Media links must be URL text." };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Media links cannot be empty." };
  //WHATWG parsing strips newlines/tabs, so "java\nscript:" collapses to
  // javascript: and fails the scheme check below — parse before any
  // string sniffing.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "That media link isn't a valid URL." };
  }
  if (value.length > MAX_DATA_URL_CHARS) return { ok: false, reason: "That media link is too long." };
  if (parsed.protocol === "data:") {
    if (!SAFE_DATA_MEDIA_RE.test(value)) return { ok: false, reason: "Media links support standard image and video formats." };
    return { ok: true, url: value };
  }
  if (value.length > MAX_NETWORK_URL_CHARS) return { ok: false, reason: "That media link is too long (2,048 characters max)." };
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocalHttpHost(parsed.hostname))) {
    if (parsed.username || parsed.password) return { ok: false, reason: "Media links can't contain sign-in credentials." };
    return { ok: true, url: parsed.toString() };
  }
  return { ok: false, reason: "Only secure https media links are supported." };
}

/** Nullable single-URL field ("", null, undefined → null). */
export function validateOptionalUrl(raw: unknown): OptionalUrlResult {
  if (raw === null || raw === undefined) return { ok: true, url: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, url: null };
  const result = validateMediaUrl(raw);
  return result.ok ? { ok: true, url: result.url } : result;
}

/**
 * Profile link fields (website/github/linkedin) historically accept bare
 * domains ("github.com/foo") — try as-is, then with an https:// prefix so the
 * legacy bare-domain input keeps working while hostile schemes still fail.
 */
export function validateExternalLink(raw: unknown): OptionalUrlResult {
  if (raw === null || raw === undefined) return { ok: true, url: null };
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return { ok: true, url: null };
    const direct = validateOptionalUrl(value);
    if (direct.ok) return direct;
    const prefixed = validateOptionalUrl(`https://${value}`);
    if (prefixed.ok) return prefixed;
    return direct;
  }
  return validateOptionalUrl(raw);
}

/**
 * mediaUrls arrays: trim, drop empty strings, then validate every entry.
 * All-or-nothing so a single hostile URL can never be partially persisted.
 */
export function validateMediaUrlList(raw: unknown, maxCount = MAX_MEDIA_URLS): { ok: true; urls: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "Media attachments must be a list." };
  if (raw.length > maxCount) return { ok: false, reason: `Media is limited to ${maxCount} attachments.` };
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim() === "") continue;
    const result = validateMediaUrl(item);
    if (!result.ok) return { ok: false, reason: result.reason };
    urls.push(result.url);
  }
  return { ok: true, urls };
}
