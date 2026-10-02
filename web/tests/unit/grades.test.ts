import { describe, expect, it } from 'vitest'
import { gradeLabel, gradeOptions, graderOf, isGradeKey, isPriceKey, sortGradeKeys } from '@/lib/domain/grades'

describe('grade keys across companies', () => {
  it('recognises PSA, BGS, CGC and SGC grades only', () => {
    expect(['psa-10', 'psa-9', 'bgs-9.5', 'cgc-10', 'sgc-10', 'psa-1'].every(isGradeKey)).toBe(true)
    expect(['raw', 'all', 'any-9', 'psa-11', 'psa-9.7', 'tag-10', 'PSA-10', '', null].some(isGradeKey)).toBe(false)
    expect(graderOf('bgs-9.5')).toBe('bgs')
  })
  it('puts PSA first and the highest grade first', () => {
    expect(sortGradeKeys(['sgc-10', 'bgs-9.5', 'psa-9', 'bgs-10', 'psa-10', 'cgc-10', 'psa-10'])).toEqual(['psa-10', 'psa-9', 'bgs-10', 'bgs-9.5', 'cgc-10', 'sgc-10'])
  })
  it('offers the PSA grades plus other companies with data', () => {
    expect(gradeOptions(['bgs-10', 'raw', 'any-9', 'cgc-10'])).toEqual(['raw', 'psa-10', 'psa-9', 'psa-8', 'bgs-10', 'cgc-10'])
    expect(sortGradeKeys(['psa-10', 'raw'])).toEqual(['raw', 'psa-10'])
    expect(isPriceKey('raw') && isPriceKey('psa-10') && !isPriceKey('all')).toBe(true)
  })
  it('labels grades for people', () => {
    expect(gradeLabel('psa-10')).toBe('PSA 10')
    expect(gradeLabel('bgs-9.5')).toBe('BGS 9.5')
    expect(gradeLabel('any-9')).toBe('Grade 9 (any grader)')
    expect(gradeLabel('raw')).toBe('Raw')
    expect(gradeLabel('all')).toBe('All grades')
  })
})
