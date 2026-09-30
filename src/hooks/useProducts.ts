import { useEffect, useRef, useState } from 'react'
import { chapterYear, currentChapterYear, DECA_START_DATE } from '../data/archive'
import { normalizeDetectedColors, type DetectedColor } from '../lib/detectColors'
import { thumbFor } from '../lib/imageOptimize'
import { products as localProducts } from '../data/products'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

/**
 * Last-resort guard for corrupt rows (no explicit period AND no usable
 * created_at). Falls back to the currently active chapter.
 */
const FALLBACK_CHAPTER = currentChapterYear(DECA_START_DATE)

/** Minimal shape the grids need. Works for DB rows and local fallback. */
export interface ArchiveItem {
  id: string
  name: string
  imageUrl: string | null
  /**
   * Thumb del grid: explícito (thumbnails[0]) o derivado, null = sin imagen.
   * Productos viejos (sin columna) caen a thumbFor(images[0]) o imageUrl.
   */
  thumbUrl: string | null
  /**
   * Full gallery. Primary image first (max 5).
   * Local seeds: deduped [imageUrl, ...images].
   * DB rows: images column when non-empty, else [image_url].
   */
  images: string[]
  ghost: string
  /** Decade chapter start year (e.g. 2025 → "2025—26"). */
  periodStartYear: number
  /** Display order inside its chapter. */
  sortOrder: number
  /** Legacy editorial code (DB column kept). Not displayed in UI; optional for old rows. */
  code?: string
  price: number
  currency: string
  color?: string
  /** Paleta detectada de la foto principal ([] = sin detección). */
  colors: DetectedColor[]
  description?: string
  available: boolean
  visible: boolean
  /**
   * Explicit variant group. Same non-null value = same model.
   * Null = independent. Never derived by name matching.
   */
  productGroupId: string | null
  /**
   * Línea del producto: 'deca' o 'jj'.
   * Cualquier otro valor o ausente se normaliza a 'deca'.
   */
  category: 'deca' | 'jj'
}

/**
 * Variants of the same model: every item sharing the same non-null
 * group id. Empty when ungrouped. Sorted by color, then name, then id
 * for a stable chip order.
 */
export function getVariants(items: ArchiveItem[], groupId: string | null | undefined): ArchiveItem[] {
  if (!groupId) return []
  return items
    .filter((item) => item.productGroupId === groupId)
    .sort((a, b) =>
      (a.color ?? '').localeCompare(b.color ?? '') ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
    )
}

function cleanGallery(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  return [...new Set(
    urls.filter((url): url is string => typeof url === 'string' && url.length > 0),
  )].slice(0, 5)
}

function mapLocal(): ArchiveItem[] {
  return localProducts.map((p, index) => {    const gallery = [p.imageUrl, ...p.images].filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    )
    return {
      id: p.id,
      name: p.name,
      imageUrl: p.imageUrl ?? null,
      thumbUrl: gallery.length > 0 ? thumbFor(gallery[0]) : null,
      images: [...new Set(gallery)].slice(0, 5),
      ghost: p.number,
      // Seed data declares its founding chapter; default guards dateless seeds.
      periodStartYear: p.periodStartYear ?? 2025,
      sortOrder: index,
      code: p.code ?? '',
      price: p.price ?? 0,
      currency: p.currency ?? '',
      color: p.color,
      colors: p.colors ?? [],
      description: p.description,
      available: p.available ?? true,
      visible: true,
      productGroupId: p.productGroupId ?? null,
      // Semillas locales: siempre línea DECA.
      category: 'deca',
    }
  })
}

export interface UseProductsResult {
  items: ArchiveItem[]
  loading: boolean
  error: string | null
  /** False when env vars are missing → local fallback is shown. */
  live: boolean
}

export function useProducts(): UseProductsResult {
  const [items, setItems] = useState<ArchiveItem[]>(() =>
    isSupabaseConfigured ? [] : mapLocal(),
  )
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return

    interface Row {
      id: unknown
      name: unknown
      image_url: unknown
      images?: unknown
      thumbnails?: unknown
      product_group_id?: unknown
      code?: unknown
      price?: unknown
      currency?: unknown
      color?: unknown
      colors?: unknown
      description?: unknown
      visible?: unknown
      period_start_year?: unknown
      created_at?: unknown
      sort_order?: unknown
      category?: unknown
    }

    const toItems = (data: Row[] | null): ArchiveItem[] =>
      (data ?? []).map((row, index) => {
        const imageUrl = (row.image_url as string | null) ?? null
        const multi = cleanGallery(row.images)
        const gallery =
          multi.length > 0 ? multi : imageUrl ? [imageUrl] : []
        // Thumbs explícitos en paralelo a images (por índice, validados);
        // vacíos en productos viejos = fallback a thumbFor o imageUrl.
        const rawThumbs = Array.isArray(row.thumbnails)
          ? row.thumbnails.map((t) =>
              typeof t === 'string' && t.length > 0 ? t : null,
            )
          : []
        const explicitThumb = rawThumbs[0] ?? null
        const thumbUrl =
          gallery.length === 0
            ? null
            : (explicitThumb ?? thumbFor(gallery[0]) ?? imageUrl)
        const rawPrice = row.price
        const price =
          typeof rawPrice === 'number' && Number.isFinite(rawPrice)
            ? rawPrice
            : typeof rawPrice === 'string' && rawPrice.trim() !== '' && Number.isFinite(Number(rawPrice))
              ? Number(rawPrice)
              : 0
        const groupRaw = row.product_group_id
        // Solo 'jj' explícito entra a la línea del amigo;
        // filas viejas (sin columna) u otros valores quedan 'deca'.
        // Se acepta el valor legacy 'tennis' como 'jj' por compatibilidad.
        const categoryRaw = row.category
        const category: 'deca' | 'jj' =
          typeof categoryRaw === 'string' &&
          (categoryRaw.trim().toLowerCase() === 'jj' ||
            categoryRaw.trim().toLowerCase() === 'tennis')
            ? 'jj'
            : 'deca'
        return {
          id: row.id as string,
          name: row.name as string,
          imageUrl,
          thumbUrl,
          images: gallery,
          ghost: String(index + 1).padStart(3, '0'),
        // Chapter order: explicit stored period first (manual, permanent).
        // Only when nothing is stored, derive from the stored creation date.
        // The current year is NEVER used as a source of truth.
        periodStartYear:
          chapterYear(
            row.period_start_year as number | null | undefined,
            row.created_at as string | null | undefined,
          ) ?? FALLBACK_CHAPTER,
          sortOrder:
            typeof row.sort_order === 'number' ? row.sort_order : index,
          code: typeof row.code === 'string' ? row.code : '',
          price,
          currency: typeof row.currency === 'string' ? row.currency : '',
          color: typeof row.color === 'string' && row.color.length > 0
            ? row.color
            : undefined,
          colors: normalizeDetectedColors(row.colors),
          description: typeof row.description === 'string' && row.description.length > 0
            ? row.description
            : undefined,
          available: true,
          visible: typeof row.visible === 'boolean' ? row.visible : true,
          productGroupId:
            typeof groupRaw === 'string' && groupRaw.trim().length > 0
              ? groupRaw.trim()
              : null,
          category,
        }
      })

    const client = supabase
    // select('*'): new columns arrive when the migration has run;
    // old schemas simply omit them — no PGRST204, grid never breaks.
    client
      .from('products')
      .select('*')
      .eq('visible', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!mounted.current) return
        if (queryError) {
          setError(queryError.message)
          setItems([])
        } else {
          setItems(toItems(data as Row[] | null))
        }
        setLoading(false)
      })
  }, [])

  return { items, loading, error, live: isSupabaseConfigured }
}
