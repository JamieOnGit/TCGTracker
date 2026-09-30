import type { HistoryPoint } from '@/lib/data'

function ticks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, i) => min + step * i)
}

function short(v: number, currency: boolean) {
  const abs = Math.abs(v)
  const s = abs >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K` : v.toFixed(0)
  return currency ? `A$${s}` : s
}

/**
 * Server-rendered line chart (ink line, no fill, right-hand axis, dashed
 * start baseline). Always paired with an HTML table of the same numbers.
 */
export function LineChart({ points, currency = true, height = 280, label }: { points: HistoryPoint[]; currency?: boolean; height?: number; label: string }) {
  if (points.length < 2) return <p className="muted text-sm">Not enough history yet.</p>
  const W = 800
  const H = height
  const padR = 64
  const padB = 28
  const values = points.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  const pad = (max - min) * 0.08 || max * 0.05 || 1
  min -= pad
  max += pad
  const x = (i: number) => (i / (points.length - 1)) * (W - padR)
  const y = (v: number) => (1 - (v - min) / (max - min)) * (H - padB)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const xLabels = [0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1]
  const fmtX = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
        {ticks(min, max).map((t) => (
          <g key={t}>
            <line className="grid-line" x1={0} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text className="axis" x={W - padR + 8} y={y(t) + 4}>{short(t, currency)}</text>
          </g>
        ))}
        <line className="baseline" x1={0} x2={W - padR} y1={y(points[0]!.value)} y2={y(points[0]!.value)} />
        <path className="series" d={d} />
        {xLabels.map((i) => (
          <text key={i} className="axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {fmtX(points[i]!.date)}
          </text>
        ))}
      </svg>
    </figure>
  )
}

export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * 64).toFixed(1)},${(18 - ((v - min) / span) * 16).toFixed(1)}`).join('')
  const up = points.at(-1)! >= points[0]!
  return (
    <svg className="spark" viewBox="0 0 64 20" aria-hidden="true">
      <path d={d} />
      <circle cx={64} cy={18 - ((points.at(-1)! - min) / span) * 16} r={2} fill={up ? 'var(--up)' : 'var(--down)'} />
    </svg>
  )
}
