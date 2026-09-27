import type { Metadata } from 'next'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { buildMetadata } from '@/lib/seo/metadata'

export function staticMeta(path: string, title: string, description: string, noindex = false): Metadata {
  return buildMetadata({ path, title, description, noindex })
}

export function StaticPage({ path, h1, children }: { path: string; h1: string; children: React.ReactNode }) {
  return (
    <>
      <Breadcrumbs items={[{ name: h1, path }]} />
      <h1>{h1}</h1>
      {children}
    </>
  )
}
