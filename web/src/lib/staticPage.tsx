import type { Metadata } from 'next'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageIntro } from '@/components/ui'
import { buildMetadata } from '@/lib/seo/metadata'

export function staticMeta(path: string, title: string, description: string, noindex = false): Metadata {
  return buildMetadata({ path, title, description, noindex })
}

export function StaticPage({ path, h1, eyebrow, lead, children }: { path: string; h1: string; eyebrow?: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: h1, path }]} /></div>
      <PageIntro eyebrow={eyebrow} title={h1} lead={lead} />
      <div className="prose">{children}</div>
    </div>
  )
}
