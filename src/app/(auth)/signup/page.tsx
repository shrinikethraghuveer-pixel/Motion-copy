import type { Metadata } from "next";
import CoreAuthCard from "@/components/auth/CoreAuthCard";

export const metadata: Metadata = {
  title: "Join Motion — Create your account",
};

/**
 * /signup — Phase 1 core authentication (name, email, handle, password).
 * New accounts land on /onboarding for the 4-step questionnaire.
 */
export default function SignupPage() {
  return <CoreAuthCard standalone />;
}
