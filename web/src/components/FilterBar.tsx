'use client'

import Form from 'next/form'
import { useRef } from 'react'

export interface FilterOption {
  value: string // '' is the default ("All ...") and is left out of the URL
  label: string
  group?: string // options with a group are shown under an <optgroup>
}

export interface FilterSelect {
  name: string
  label: string
  value: string
  options: FilterOption[]
}

/**
 * Search box + dropdown filters for a list page. A plain GET form, so it
 * works without JavaScript and every result is a shareable URL; with
 * JavaScript, changing a dropdown applies it straight away and empty or
 * default values are left out of the URL (so the unfiltered view is the
 * clean, canonical page).
 */
export function FilterBar({
  action,
  search,
  selects,
  hidden,
  summary,
}: {
  action: string
  search?: { value?: string; placeholder: string; label?: string }
  selects: FilterSelect[]
  hidden?: Record<string, string | undefined>
  summary?: React.ReactNode
}) {
  const ref = useRef<HTMLFormElement>(null)
  const active = Boolean(search?.value) || selects.some((s) => s.value !== '')

  // Disabled fields aren't submitted: drop the empty ones just before the
  // form is read, then re-enable them so the form stays usable.
  const clean = () => {
    const form = ref.current
    if (!form) return
    const off: (HTMLInputElement | HTMLSelectElement)[] = []
    for (const el of Array.from(form.elements)) {
      if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name && el.value.trim() === '') {
        el.disabled = true
        off.push(el)
      }
    }
    setTimeout(() => off.forEach((el) => (el.disabled = false)), 0)
  }

  return (
    <Form key={`${search?.value ?? ''}|${selects.map((s) => s.value).join('|')}`} ref={ref} action={action} scroll={false} className="filter-bar" role="search" aria-label="Filter and search" onSubmit={clean} data-filter-bar="">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search && (
        <div className="filter-search">
          <label htmlFor="fb-q" className="sr-only">{search.label ?? 'Search products'}</label>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" className="filter-search-icon">
            <path d="M8.5 3a5.5 5.5 0 1 0 3.4 9.8l3.6 3.7 1.1-1.1-3.7-3.6A5.5 5.5 0 0 0 8.5 3Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" fill="currentColor" />
          </svg>
          <input id="fb-q" name="q" type="search" className="input" defaultValue={search.value} placeholder={search.placeholder} maxLength={80} autoComplete="off" enterKeyHint="search" />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
        </div>
      )}
      <div className="filter-selects">
        {selects.map((s) => {
          const id = `fb-${s.name}`
          const ungrouped = s.options.filter((o) => !o.group)
          const groups = [...new Set(s.options.filter((o) => o.group).map((o) => o.group!))]
          return (
            <div key={s.name} className="filter-field">
              <label htmlFor={id}>{s.label}</label>
              <select
                id={id}
                name={s.name}
                className="select"
                defaultValue={s.value}
                onChange={() => ref.current?.requestSubmit()}
              >
                {ungrouped.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {s.options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )
        })}
        <noscript><button type="submit" className="btn btn-secondary btn-sm self-end">Apply</button></noscript>
      </div>
      {(summary || active) && (
        <p className="filter-summary">
          {summary}
          {active && <a href={action + (hidden && Object.values(hidden).some(Boolean) ? `?${new URLSearchParams(Object.entries(hidden).filter((e): e is [string, string] => Boolean(e[1]))).toString()}` : '')} className="prose-link">Clear filters</a>}
        </p>
      )}
    </Form>
  )
}
