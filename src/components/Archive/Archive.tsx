import { useEffect, useMemo, type FC } from 'react'
import {
  archivePeriods,
  currentChapterYear,
  orderChapters,
  periodLabel,
} from '../../data/archive'
import { useProducts, type ArchiveItem } from '../../hooks/useProducts'
import { useCurrentTime } from '../../hooks/useCurrentTime'
import styles from './Archive.module.css'
import ProductGrid from '../ProductGrid/ProductGrid'

interface ArchiveProps {
  onViewProduct?: (productId: string) => void
}

interface Chapter {
  year: number
  items: ArchiveItem[]
}

/** Groups items by decade chapter. Each item lives in exactly one group. */
function groupByChapter(items: ArchiveItem[]): Chapter[] {
  const validYears = new Set(archivePeriods.map((p) => p.startYear))
  const map = new Map<number, ArchiveItem[]>()
  for (const item of items) {
    // Only group items whose periodStartYear matches a defined archive period
    if (!validYears.has(item.periodStartYear)) continue
    const list = map.get(item.periodStartYear)
    if (list) {
      list.push(item)
    } else {
      map.set(item.periodStartYear, [item])
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, chapterItems]) => ({
      year,
      // Same order as Inicio: the stored sort_order decides.
      items: [...chapterItems].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
}

const Archive: FC<ArchiveProps> = ({ onViewProduct }) => {
  const now = useCurrentTime(60_000)
  const { items } = useProducts()
  // El Archive principal es solo línea DECA; JJ vive al final como
  // un capítulo más (mismo gap, sin título ni contador) y nunca se mezcla.
  const decaItems = useMemo(
    () => items.filter((item) => (item.category ?? 'deca') === 'deca'),
    [items],
  )
  // Línea JJ: mismos datos, al final y con el mismo gap que los
  // capítulos DECA (sin título ni contador).
  const jjItems = useMemo(
    () => items.filter((item) => item.category === 'jj'),
    [items],
  )
  const chapters = useMemo(
    () => orderChapters(groupByChapter(decaItems), currentChapterYear(now)),
    [decaItems, now],
  )

  // Deep link: #archive-2026 lands aligned on its chapter.
  useEffect(() => {
    if (window.location.hash.startsWith('#archive-')) {
      document
        .getElementById(window.location.hash.slice(1))
        ?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
  }, [])

  return (
    <section
      className={styles.archive}
      id="archive"
      aria-label="Deca archive by period"
    >
      <div className={styles.chapters}>
        {chapters.map((chapter) => (
          <article
            key={chapter.year}
            id={`archive-${chapter.year}`}
            className={styles.chapter}
            aria-label={`Deca ${periodLabel(chapter.year)}`}
          >
            <ProductGrid
              items={chapter.items}
              onViewProduct={onViewProduct}
              loading={false}
              error={null}
              showHeader={false}
              hideNames={true}
              aria-label={`Deca ${periodLabel(chapter.year)} products`}
            />
          </article>
        ))}
        {jjItems.length > 0 && (
          <>
            <div className={styles.divider} aria-hidden="true" />
            <article
              key="jj"
              className={styles.chapter}
              aria-label="JJ products"
            >
            <ProductGrid
              items={jjItems}
              onViewProduct={onViewProduct}
              loading={false}
              error={null}
              showHeader={false}
              hideNames={true}
              aria-label="JJ products"
            />
            </article>
          </>
        )}
      </div>
    </section>
  )
}

export default Archive
