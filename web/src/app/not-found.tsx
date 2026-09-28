import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="container-x">
      <div className="empty">
        <div className="glyph" aria-hidden="true" />
        <h1 className="text-2xl">This page isn’t in the binder.</h1>
        <p className="muted mt-3">It may have moved or been removed.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="btn btn-primary">Market rankings</Link>
          <Link href="/search/" className="btn btn-secondary">Search cards</Link>
        </div>
      </div>
    </div>
  )
}
