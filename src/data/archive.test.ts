/**
 * DECA DREAM — Archive State Tests
 *
 * Validates getArchivePeriodState() against 8 mandated dates.
 * Run: npx tsx src/data/archive.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  archivePeriods,
  getArchivePeriodState,
  type ArchiveStatus,
} from './archive'

// ── Helpers ────────────────────────────────────────────

function statusOf(index: number, now: Date): ArchiveStatus {
  return getArchivePeriodState(archivePeriods[index], now).status
}

function progressOf(index: number, now: Date): number {
  return getArchivePeriodState(archivePeriods[index], now).progress
}

function allStatuses(now: Date): ArchiveStatus[] {
  return archivePeriods.map((p) => getArchivePeriodState(p, now).status)
}

// ── Test 1: 2025-08-28 → all future ───────────────────

describe('2025-08-28 — before decade starts', () => {
  const now = new Date('2025-08-28T12:00:00')

  it('all periods are future', () => {
    const statuses = allStatuses(now)
    assert.deepStrictEqual(statuses, [
      'future', 'future', 'future', 'future', 'future',
      'future', 'future', 'future', 'future', 'future',
    ])
  })
})

// ── Test 2: 2025-08-29 → first active, progress = 0 ───

describe('2025-08-29 — decade begins', () => {
  const now = new Date('2025-08-29T00:00:00')

  it('first period is active with progress 0', () => {
    assert.equal(statusOf(0, now), 'active')
    assert.equal(progressOf(0, now), 0)
  })

  it('remaining periods are future', () => {
    for (let i = 1; i < 10; i++) {
      assert.equal(statusOf(i, now), 'future', `period ${i} should be future`)
    }
  })
})

// ── Test 3: 2026-02-28 → first active, progress > 0 ───

describe('2026-02-28 — ~6 months into first year', () => {
  const now = new Date('2026-02-28T12:00:00')

  it('first period is active with positive progress', () => {
    assert.equal(statusOf(0, now), 'active')
    assert.ok(progressOf(0, now) > 0, 'progress should be > 0')
  })
})

// ── Test 4: 2026-08-28 → first active, progress < 1 ───

describe('2026-08-28 — one day before first period ends', () => {
  const now = new Date('2026-08-28T12:00:00')

  it('first period is active with progress < 1', () => {
    assert.equal(statusOf(0, now), 'active')
    assert.ok(progressOf(0, now) < 1, 'progress should be < 1')
  })
})

// ── Test 5: 2026-08-29 → first completed, second active ─

describe('2026-08-29 — first period ends, second begins', () => {
  const now = new Date('2026-08-29T00:00:00')

  it('first period is completed', () => {
    assert.equal(statusOf(0, now), 'completed')
    assert.equal(progressOf(0, now), 1)
  })

  it('second period is active with progress 0', () => {
    assert.equal(statusOf(1, now), 'active')
    assert.equal(progressOf(1, now), 0)
  })
})

// ── Test 6: 2026-09-18 → today's date scenario ────────

describe('2026-09-18 — mid-september 2026', () => {
  const now = new Date('2026-09-18T12:00:00')

  it('first period completed', () => {
    assert.equal(statusOf(0, now), 'completed')
  })

  it('second period active', () => {
    assert.equal(statusOf(1, now), 'active')
    assert.ok(progressOf(1, now) > 0, 'progress should be > 0')
    assert.ok(progressOf(1, now) < 1, 'progress should be < 1')
  })

  it('periods 2–9 are future', () => {
    for (let i = 2; i < 10; i++) {
      assert.equal(statusOf(i, now), 'future', `period ${i} should be future`)
    }
  })
})

// ── Test 7: 2035-08-28 → last active ──────────────────

describe('2035-08-28 — one day before decade ends', () => {
  const now = new Date('2035-08-28T12:00:00')

  it('last period is active', () => {
    assert.equal(statusOf(9, now), 'active')
    assert.ok(progressOf(9, now) < 1, 'progress should be < 1')
  })

  it('periods 0–8 are completed', () => {
    for (let i = 0; i < 9; i++) {
      assert.equal(statusOf(i, now), 'completed', `period ${i} should be completed`)
    }
  })
})

// ── Test 8: 2035-08-29 → all completed ────────────────

describe('2035-08-29 — decade ends', () => {
  const now = new Date('2035-08-29T00:00:00')

  it('all periods are completed', () => {
    const statuses = allStatuses(now)
    assert.deepStrictEqual(statuses, [
      'completed', 'completed', 'completed', 'completed', 'completed',
      'completed', 'completed', 'completed', 'completed', 'completed',
    ])
  })

  it('all periods have progress 1', () => {
    for (let i = 0; i < 10; i++) {
      assert.equal(progressOf(i, now), 1, `period ${i} progress should be 1`)
    }
  })
})
