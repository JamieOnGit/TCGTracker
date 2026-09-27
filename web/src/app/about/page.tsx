import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/about/', 'About Us', 'An independent Australian site for Pokémon and One Piece card collectors: market data, a reviewed marketplace and retail drop alerts.')
export default function About() {
  return <StaticPage path="/about/" h1="About"><p>Placeholder: about copy to be written by Jamie.</p></StaticPage>
}
