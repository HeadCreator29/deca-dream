/**
 * DECA DREAM — Archive Data
 *
 * Static period definitions and pure state calculation.
 * All status/progress derived from current date — never hardcoded.
 *
 * Decade: 2025-08-29 → 2035-08-29 (Santo Domingo local time)
 */

// ── Constants ──────────────────────────────────────────

export const DECA_START_DATE = new Date('2025-08-29T00:00:00')
export const DECA_END_DATE = new Date('2035-08-29T00:00:00')

// ── Types ──────────────────────────────────────────────

export type ArchiveStatus = 'completed' | 'active' | 'future'

export interface ArchivePeriod {
  id: number
  startYear: number
  endYear: number
  title?: string
}

export interface ArchivePeriodState {
  status: ArchiveStatus
  progress: number // 0..1
}

// ── Static Data ────────────────────────────────────────

export const archivePeriods: ArchivePeriod[] = [
  { id: 1, startYear: 2025, endYear: 2026, title: 'THE BEGINNING' },
  { id: 2, startYear: 2026, endYear: 2027 },
  { id: 3, startYear: 2027, endYear: 2028 },
  { id: 4, startYear: 2028, endYear: 2029 },
  { id: 5, startYear: 2029, endYear: 2030 },
  { id: 6, startYear: 2030, endYear: 2031 },
  { id: 7, startYear: 2031, endYear: 2032 },
  { id: 8, startYear: 2032, endYear: 2033 },
  { id: 9, startYear: 2033, endYear: 2034 },
  { id: 10, startYear: 2034, endYear: 2035 },
]

// ── State Calculation ──────────────────────────────────

/**
 * Pure function: computes status and progress for a period at a given time.
 *
 * @param period  - Static period definition
 * @param now     - Current date/time (local)
 * @returns       - Status ('completed' | 'active' | 'future') + progress 0..1
 */
export function getArchivePeriodState(
  period: ArchivePeriod,
  now: Date
): ArchivePeriodState {
  // Period boundaries: each runs from Aug 29 of startYear to Aug 29 of endYear
  const start = new Date(period.startYear, 7, 29) // month is 0-indexed: 7 = August
  const end = new Date(period.endYear, 7, 29)

  if (now >= end) {
    return { status: 'completed', progress: 1 }
  }

  if (now >= start) {
    const elapsed = now.getTime() - start.getTime()
    const total = end.getTime() - start.getTime()
    const progress = Math.max(0, Math.min(1, elapsed / total))
    return { status: 'active', progress }
  }

  return { status: 'future', progress: 0 }
}

/**
 * Pure function: computes status and progress for the whole decade
 * (DECA_START_DATE → DECA_END_DATE) at a given time.
 * Same 0..1 clamped math as the per-year periods.
 */
export function getDecadeState(now: Date): ArchivePeriodState {
  if (now >= DECA_END_DATE) {
    return { status: 'completed', progress: 1 }
  }

  if (now >= DECA_START_DATE) {
    const elapsed = now.getTime() - DECA_START_DATE.getTime()
    const total = DECA_END_DATE.getTime() - DECA_START_DATE.getTime()
    const progress = Math.max(0, Math.min(1, elapsed / total))
    return { status: 'active', progress }
  }

  return { status: 'future', progress: 0 }
}

/**
 * Returns a formatted display string for a period.
 * e.g. { startYear: 2025, endYear: 2026 } → "2025 — 2026"
 */
export function formatPeriod(period: ArchivePeriod): string {
  return `${period.startYear} — ${period.endYear}`
}

/**
 * Compact format for single-line timeline.
 * e.g. { startYear: 2025, endYear: 2026 } → "2025—26"
 */
export function formatPeriodCompact(period: ArchivePeriod): string {
  const shortEnd = String(period.endYear).slice(-2)
  return `${period.startYear}\u2014${shortEnd}`
}

/**
 * Current DECA chapter (start year) for a given date.
 * The chapter flips every August 29:
 *   29/08/2026 → 2026, 28/08/2027 → still 2026, 29/08/2027 → 2027.
 * Used ONLY to order chapter groups visually — never to assign or
 * overwrite any product's stored period.
 */
export function currentChapterYear(now: Date = new Date()): number {
  const cutoff = new Date(now.getFullYear(), 7, 29) // 7 = August
  return now >= cutoff ? now.getFullYear() : now.getFullYear() - 1
}

/**
 * Visual order for chapter groups: the current chapter first,
 * then previous chapters from newest to oldest.
 * Product data is untouched — this only sorts the groups.
 */
export function orderChapters<T extends { year: number }>(
  chapters: T[],
  currentYear: number,
): T[] {
  return [...chapters].sort((a, b) => {
    if (a.year === currentYear) return -1
    if (b.year === currentYear) return 1
    return b.year - a.year
  })
}
/**
 * Compact label from a bare start year.
 * e.g. 2025 → "2025—26". Used for product chapters.
 */
export function periodLabel(startYear: number): string {
  return `${startYear}\u2014${String(startYear + 1).slice(-2)}`
}

/**
 * Effective chapter year for a product.
 * Explicit year wins; otherwise derived from a creation date.
 * Returns null when neither is available.
 */
export function chapterYear(
  explicit: number | null | undefined,
  createdAt?: string | null,
): number | null {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.trunc(explicit)
  }
  if (createdAt) {
    const time = new Date(createdAt).getTime()
    if (Number.isFinite(time)) {
      return new Date(time).getFullYear()
    }
  }
  return null
}
