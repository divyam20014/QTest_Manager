export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong' }

/** Rough, dependency-free strength estimate from length and character variety (UI hint only; the server enforces policy). */
export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length < 8) return { score: 0, label: 'Too short' }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  let points = kinds - 1 // 0..3
  if (pw.length >= 12) points += 1
  if (pw.length >= 16) points += 1
  if (/^(.)\1+$/.test(pw)) points = 0
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4
  return { score, label: (['Weak', 'Fair', 'Good', 'Strong'] as const)[score - 1] }
}
