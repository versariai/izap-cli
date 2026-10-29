export const REDACTED = "[REDACTED]";

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bizap_(?:pat|sk|whsec)_[A-Za-z0-9_-]+/g,
  // JWTs: dashboard sessions and OAuth access tokens.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];
const BEARER = /\b(Bearer)\s+[^\s"',;]+/gi;

/** Removes known secrets and anything shaped like an iZap token or a JWT. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join(REDACTED);
  }
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, REDACTED);
  return result.replace(BEARER, `$1 ${REDACTED}`);
}
