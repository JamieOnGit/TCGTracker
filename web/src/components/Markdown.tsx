import Link from 'next/link'
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown'

/** Renders the safe Markdown subset from lib/markdown as React elements (text is always escaped). */
export function Markdown({ source, blocks }: { source?: string; blocks?: Block[] }) {
  const tree = blocks ?? parseMarkdown(source ?? '')
  return <>{tree.map((b, i) => <BlockEl key={i} block={b} />)}</>
}

function BlockEl({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'heading': {
      const H = `h${b.level}` as 'h2' | 'h3' | 'h4'
      return <H id={b.id}><Inlines nodes={b.children} /></H>
    }
    case 'paragraph':
      return <p><Inlines nodes={b.children} /></p>
    case 'quote':
      return <blockquote className="notice"><Inlines nodes={b.children} /></blockquote>
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul'
      return <L>{b.items.map((item, i) => <li key={i}><Inlines nodes={item} /></li>)}</L>
    }
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return n.value
          case 'code':
            return <code key={i}>{n.value}</code>
          case 'strong':
            return <strong key={i}><Inlines nodes={n.children} /></strong>
          case 'em':
            return <em key={i}><Inlines nodes={n.children} /></em>
          case 'link':
            return n.external ? (
              <a key={i} href={n.href} rel="noopener" target="_blank">
                <Inlines nodes={n.children} />
              </a>
            ) : (
              <Link key={i} href={n.href}>
                <Inlines nodes={n.children} />
              </Link>
            )
        }
      })}
    </>
  )
}
