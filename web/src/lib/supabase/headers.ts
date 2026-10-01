/**
 * Headers for a direct REST/Auth call to Supabase.
 *
 * Legacy `anon` / `service_role` keys are JWTs and go in both `apikey` and
 * `Authorization: Bearer`. The new `sb_publishable_…` / `sb_secret_…` keys are
 * not JWTs: Supabase wants them on `apikey` only (a Bearer copy fails JWT
 * verification), and its gateway derives the role from them.
 */
export function supabaseKeyHeaders(key: string): Record<string, string> {
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }
}
