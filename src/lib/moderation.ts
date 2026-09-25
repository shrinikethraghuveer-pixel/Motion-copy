export type ModerationResult = { allowed: true } | { allowed: false; reason: string };

const BUILTIN_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bkill\s+yourself\b/i, reason: "Content encouraging self-harm is not allowed." },
  { pattern: /\b(?:i(?:'ll|\s+will)|we(?:'ll|\s+will))\s+kill\s+(?:you|them|him|her)\b/i, reason: "Direct threats are not allowed." },
  { pattern: /\b(?:send|share|enter)\s+(?:me\s+)?your\s+(?:password|one[- ]time\s+code|2fa\s+code)\b/i, reason: "Requests for passwords or sign-in codes are not allowed." },
];

function configuredBlockedTerms(): string[] {
  return (process.env.MOTION_BLOCKED_TERMS ?? "")
    .split(",")
    .map((term) => term.trim().toLocaleLowerCase())
    .filter((term) => term.length >= 3);
}

/** Lightweight server-side screening. This is a rule filter, not a substitute for human review. */
export function screenUserText(value: string): ModerationResult {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  for (const { pattern, reason } of BUILTIN_BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) return { allowed: false, reason };
  }

  const lower = normalized.toLocaleLowerCase();
  const blockedTerm = configuredBlockedTerms().find((term) => lower.includes(term));
  if (blockedTerm) return { allowed: false, reason: "This content appears to violate the community guidelines." };
  return { allowed: true };
}
