/**
 * Remove credentials from text this Action persists or publishes.
 *
 * The Action holds a GitHub token, and a plugin's own commands may print one;
 * whatever reaches the state branch, a proposal or a check log passes through
 * here first. The patterns catch the token shapes a command is likely to echo,
 * not only the configured values.
 */

export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let redacted = text
  for (const secret of secrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join('<redacted>')
  }
  return redacted
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh<redacted>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_<redacted>')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1<redacted>')
    .replace(/\b(token|password|secret|api[-_]?key)=(?!<redacted>)([^\s&"']+)/gi, '$1=<redacted>')
    .replace(/(?:mongodb|postgres(?:ql)?|mysql|redis):\/\/[^\s:/@]+:[^\s@/]+@/gi, match => match.replace(/:[^:@/]+@/, ':<redacted>@'))
    .replace(/(?:Cookie|Set-Cookie):\s*(?:"[^"\n]*"|[^\n]+)/gi, match => `${match.split(':')[0]}: <redacted>`)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '<redacted>')
}

/** Redact strings inside a structured value without breaking its JSON shape. */
export function redactDeep<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === 'string') return redactSecrets(value, secrets) as T
  if (Array.isArray(value)) return value.map(item => redactDeep(item, secrets)) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, secrets)])) as T
  }
  return value
}
