"use client";

import { createClient } from "@/lib/supabase/client";

export interface AuthResult {
  error: string | null;
  needsConfirmation?: boolean;
  magicLinkSent?: boolean;
}

/** Row shape of the public.profiles table (migration 0001 + 0002 + 0003). */
export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  age: number | null;
  interests: string[];
  goal: string | null;
  feed_vibe: string | null;
  onboarding_completed: boolean;
  created_at: string;
  /** Rich profile fields (0003) — optional so older cached payloads still typecheck. */
  cover_url?: string | null;
  headline?: string | null;
  location?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  tech_stack?: string[];
  institution_id?: string | null;
  institution_not_listed?: boolean;
  institution_custom_name?: string | null;
  currently_in_educational_institution?: boolean | null;
}

export interface SessionUser {
  id: string;
  email: string | null;
  profile: Profile | null;
}

/** Onboarding questionnaire payload stored on the profile row. */
export interface OnboardingData {
  age: number;
  interests: string[];
  goal: string;
  feedVibe: string;
}

const PROFILE_COLUMNS =
  "id, username, full_name, display_name, avatar_url, bio, age, interests, goal, feed_vibe, onboarding_completed, created_at";

/** Create a new Motion account with email + password + public profile fields. */
export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
  fullName?: string
): Promise<AuthResult> {
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Confirmation returns through the session-exchange route, which also
      // establishes the cookies used by server rendering and onboarding.
      emailRedirectTo: `${window.location.origin}/auth/callback`,
      data: {
        // Consumed by the on_auth_user_created trigger when it seeds profiles.
        username,
        full_name: fullName ?? null,
      },
    },
  });
  if (error) return { error: error.message };
  // If email confirmation is enabled on the project, signUp returns no session.
  const { data } = await supabase.auth.getUser();
  return { error: null, needsConfirmation: !data.user };
}

/**
 * Passwordless magic link. Works with ANY valid email address — no
 * institutional-domain checks. Supabase emails a signed link; clicking it
 * lands on /auth/callback which exchanges the code for a session.
 */
export async function sendMagicLink(email: string): Promise<AuthResult> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
      // Sign-in links must not register unknown emails. Registration is
      // always an explicit choice in the sign-up flow.
      shouldCreateUser: false,
    },
  });
  return { error: error ? error.message : null, magicLinkSent: !error };
}

/** Sign in with email + password. */
export async function signInWithEmail(
  emailOrUsername: string,
  password: string
): Promise<AuthResult> {
  const supabase = createClient();
  const identifier = emailOrUsername.trim();
  let email = identifier;

  // Supabase password auth accepts an email address. Resolve a Motion username
  // server-side so the login UI can accept either form without exposing auth
  // users or a service-role key to the browser.
  if (!identifier.includes("@")) {
    try {
      const response = await fetch("/api/auth/resolve-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier.replace(/^@+/, "") }),
      });
      const payload = (await response.json().catch(() => ({}))) as { email?: string };
      if (!response.ok || !payload.email) return { error: "Invalid username or password." };
      email = payload.email;
    } catch {
      return { error: "We couldn't sign you in right now. Please try again." };
    }
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? "Invalid email or password." : null };
}

/** End the current session. */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}

/**
 * Current session snapshot: auth user + public profile row.
 * Returns null when signed out.
 */
export async function getCurrentUserSession(): Promise<SessionUser | null> {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    profile: (profile as Profile | null) ?? null,
  };
}

/** True when the username is free (case-insensitive), false when taken. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let query = supabase
    .from("profiles")
    .select("id")
    .ilike("username", username);
  if (user) query = query.neq("id", user.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return !data;
}

/** Persist onboarding selections onto the user's profile row (RLS: own row only). */
export async function saveOnboarding(data: OnboardingData): Promise<AuthResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await supabase
    .from("profiles")
    .update({
      age: data.age,
      interests: data.interests,
      goal: data.goal,
      feed_vibe: data.feedVibe,
      onboarding_completed: true,
    })
    .eq("id", user.id);
  return { error: error ? error.message : null };
}
