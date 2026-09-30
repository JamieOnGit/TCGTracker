import { releaseIcsResponse } from '@/lib/releaseIcs'
import { GAMES, isGame } from '@/lib/seo/urls'

export const revalidate = 3600

export function generateStaticParams() {
  return GAMES.map((game) => ({ game }))
}

/** /releases/{game}/calendar.ics */
export async function GET(_req: Request, { params }: { params: Promise<{ game: string }> }) {
  const { game } = await params
  if (!isGame(game)) return new Response('Not found', { status: 404 })
  return releaseIcsResponse(game)
}
