/**
 * localStorage key for interests picked on the welcome page.
 * The signup/onboarding flow reads this to prefill the questionnaire.
 */
export const WELCOME_TAGS_KEY = "motion:welcome-interests";

/** Read + validate the stored welcome tags (returns [] when absent/corrupt). */
export function readWelcomeTags(): string[] {
  try {
    const raw = window.localStorage.getItem(WELCOME_TAGS_KEY);
    const tags: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Clear the stored welcome tags (after successful onboarding). */
export function clearWelcomeTags(): void {
  try {
    window.localStorage.removeItem(WELCOME_TAGS_KEY);
  } catch {
    /* ignore */
  }
}
