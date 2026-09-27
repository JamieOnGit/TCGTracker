import { privateMeta } from '@/lib/accountGate'
export const metadata = privateMeta
export default function Login() {
  return (
    <>
      <h1>Sign in</h1>
      <p className="demo-banner">Supabase Auth (email magic link / OAuth) is wired up once the Supabase project exists. UI follows the approved wireframes.</p>
    </>
  )
}
