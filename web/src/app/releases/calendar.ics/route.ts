import { releaseIcsResponse } from '@/lib/releaseIcs'

export const revalidate = 3600

/** /releases/calendar.ics — every game. No trailing slash: it's a file. */
export function GET() {
  return releaseIcsResponse()
}
