export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
export const isStrongEnough = (v: string) => v.length >= 8;

export function authErrorKey(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'err.invalidCreds';
  if (m.includes('email not confirmed')) return 'err.emailNotVerified';
  if (m.includes('already registered')) return 'err.emailExists';
  if (m.includes('rate limit')) return 'err.rateLimit';
  if (m.includes('fetch') || m.includes('network')) return 'err.network';
  return 'err.generic';
}
