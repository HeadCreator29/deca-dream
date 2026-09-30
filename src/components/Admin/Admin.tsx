import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FC,
  type FormEvent,
} from 'react'
import {
  PRODUCT_IMAGES_BUCKET,
  isAdminEmail,
  isSupabaseConfigured,
  supabase,
  type DbProduct,
} from '../../lib/supabase'
import { currentChapterYear, periodLabel } from '../../data/archive'
import {
  formatAdminError,
  isMissingSchemaColumn,
} from '../../lib/adminErrors'
import {
  COMMON_CAP_COLORS,
  DECAGRAM_PATH,
  colorHex,
} from '../../lib/productColors'
import {
  detectColorsFromImage,
  nearestColorName,
  normalizeDetectedColors,
  type DetectedColor,
} from '../../lib/detectColors'
import {
  createThumbnail,
  optimizeProductImage,
  thumbFor,
} from '../../lib/imageOptimize'
import AnalyticsPanel from '../../analytics/AnalyticsPanel'
import styles from './Admin.module.css'

const MAX_PHOTOS = 5

interface Draft {
  id?: string
  name: string
  price: string
  currency: string
  color: string
  /** Paleta detectada de la foto principal (primary + secundarios). */
  colors: DetectedColor[]
  description: string
  image_url: string | null
  visible: boolean
  sort_order: number
  /** Decade chapter start year. Null = automatic from creation date. */
  period_start_year: number | null
  /** Explicit variant group. Empty = independent product. */
  product_group_id: string
  /** Línea del producto: 'deca' o 'jj' (siempre separadas en el home). */
  category: 'deca' | 'jj'
}

interface PhotoSlot {
  key: string
  preview: string
  /** Remote URL for existing photos. */
  url?: string
  /** Local file pending upload. */
  file?: File
  isNew: boolean
}

const emptyDraft = (nextOrder: number): Draft => ({
  name: '',
  price: '',
  currency: '',
  color: '',
  colors: [],
  description: '',
  image_url: null,
  visible: true,
  sort_order: nextOrder,
  // Por defecto el ciclo actual (ej. 2026 en 2026-27) para no llenarlo
  // a mano; se puede borrar y queda null = automático por fecha creación.
  period_start_year: currentChapterYear(new Date()),
  product_group_id: '',
  category: 'deca',
})

function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null
  const marker = `${PRODUCT_IMAGES_BUCKET}/`
  const index = url.lastIndexOf(marker)
  if (index === -1) {
    // URL format unexpected — cannot derive storage path safely
    console.warn('[Admin] Could not extract storage path from URL:', url)
    return null
  }
  try {
    const path = url.slice(index + marker.length)
    // Remove query params if present (e.g., signed URLs)
    const cleanPath = path.split('?')[0]
    return decodeURIComponent(cleanPath)
  } catch {
    console.warn('[Admin] Failed to decode storage path from URL:', url)
    return null
  }
}

function slotKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** HEIC/HEVC are blocked: browsers and Supabase image pipeline handle them poorly. */
function rejectedReason(file: File): string | null {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  if (
    type.includes('heic') ||
    type.includes('heif') ||
    type.includes('hevc') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  ) {
    return `Formato no soportado (HEIC/HEVC): ${file.name}. Usá JPG, PNG o WebP.`
  }
  if (!type.startsWith('image/')) {
    return `Archivo no válido: ${file.name}. Subí una imagen.`
  }
  return null
}

function galleryFromProduct(product: DbProduct): string[] {
  const multi = Array.isArray(product.images)
    ? product.images.filter(
        (url): url is string => typeof url === 'string' && url.length > 0,
      )
    : []
  if (multi.length > 0) return [...new Set(multi)].slice(0, MAX_PHOTOS)
  return product.image_url ? [product.image_url] : []
}

const schemaWarning =
  'El producto se guardó con campos básicos, pero algunos campos nuevos ' +
  '(precio, color, galería, grupo) no persistieron: corré ' +
  'supabase/migration_product_detail.sql y ' +
  'supabase/migration_product_colors.sql y volvé a guardar.'

const colorsWarning =
  'El producto se guardó sin su paleta de colores: corré ' +
  'supabase/migration_product_colors.sql y volvé a guardar.'

const Admin: FC = () => {
  const [authChecking, setAuthChecking] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)

  const [products, setProducts] = useState<DbProduct[]>([])
  const [listBusy, setListBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [photos, setPhotos] = useState<PhotoSlot[]>([])
  const [dragOver, setDragOver] = useState(false)
  /** Paleta detectada (editable) de la foto principal. */
  const [detectedColors, setDetectedColors] = useState<DetectedColor[]>([])
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  /** Foto principal ya analizada (evita re-detectar sin cambios). */
  const lastDetectedKey = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Same-tick guard: state lags one render, so double-click would bypass `saving`. */
  const savingRef = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Estado visible de la optimización por producto (nunca silencioso). */
  const [optimizeStatus, setOptimizeStatus] = useState<string | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reordering, setReordering] = useState(false)
  // Pestaña interna: productos (existente) o analítica (agregada).
  const [adminTab, setAdminTab] = useState<'products' | 'analytics'>('products')

  const fileInputRef = useRef<HTMLInputElement>(null)

  /* --- Session --- */

  useEffect(() => {
    if (!supabase) {
      setAuthChecking(false)
      return
    }
    // Si la sesión no responde (red móvil lenta/bloqueada), no colgar la
    // pantalla en "Verificando acceso…": a los 8s se muestra el login.
    // Si la sesión llega después, el listener la toma igual.
    const fallback = window.setTimeout(() => setAuthChecking(false), 8000)
    supabase.auth.getSession().then(({ data }) => {
      window.clearTimeout(fallback)
      setUserEmail(data.session?.user?.email ?? null)
      setAuthChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
    })
    return () => {
      window.clearTimeout(fallback)
      sub.subscription.unsubscribe()
    }
  }, [])

  const authorized = isAdminEmail(userEmail)

  /* --- List --- */

  const fetchProducts = useCallback(async () => {
    if (!supabase) return
    setListBusy(true)
    setListError(null)
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      setListError(error.message)
      setProducts([])
    } else {
      setProducts((data ?? []) as DbProduct[])
    }
    setListBusy(false)
  }, [])

  useEffect(() => {
    if (authorized) void fetchProducts()
  }, [authorized, fetchProducts])

  // Editor siempre visible: al autorizar se inicializa un borrador nuevo
  // para no tener que pulsar "+ NUEVO PRODUCTO".
  useEffect(() => {
    if (!authorized) return
    setDraft((prev) => {
      if (prev) return prev
      return emptyDraft(1)
    })
  }, [authorized])

  const existingGroups = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (typeof p.product_group_id === 'string' && p.product_group_id.trim()) {
        set.add(p.product_group_id.trim())
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [products])

  const relatedVariants = useMemo(() => {
    if (!draft || !draft.product_group_id.trim()) return []
    const group = draft.product_group_id.trim()
    return products.filter((p) => p.product_group_id === group && p.id !== draft.id)
  }, [draft, products])

  /* --- Detección automática de colores (foto principal) --- */

  const runDetection = useCallback(async (slot: PhotoSlot) => {
    lastDetectedKey.current = slot.key
    setDetecting(true)
    setDetectError(null)
    try {
      const found = normalizeDetectedColors(
        await detectColorsFromImage(slot.file ?? slot.preview),
      )
      setDetectedColors(found)
      // Sin campo COLOR manual: el color siempre hereda el primario detectado.
      setDraft((prev) => {
        if (!prev) return prev
        const primary = found.find((c) => c.primary) ?? found[0]
        return primary ? { ...prev, color: primary.name } : prev
      })
    } catch (err) {
      setDetectError(
        err instanceof Error ? err.message : 'No se pudo analizar la imagen.',
      )
    } finally {
      setDetecting(false)
    }
  }, [])

  // Auto por defecto: al cambiar la foto principal se analiza sola.
  // Las correcciones manuales se conservan hasta cambiar/reemplazar fotos.
  useEffect(() => {
    if (!draft || photos.length === 0) return
    const first = photos[0]
    if (lastDetectedKey.current === first.key) return
    void runDetection(first)
  }, [draft, photos, runDetection])

  /* --- Auth actions --- */

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setLoginBusy(true)
    setLoginError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    })
    if (error) setLoginError(error.message)
    setLoginBusy(false)
  }

  const handleLogout = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setProducts([])
    setDraft(null)
    setPhotos([])
  }

  /* --- Editor --- */

  const openNew = () => {
    // Revoca previews locales pendientes igual que closeEditor para no
    // filtrar object URLs al cancelar desde el panel siempre visible.
    for (const slot of photos) {
      if (slot.isNew) URL.revokeObjectURL(slot.preview)
    }
    const nextOrder =
      products.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1
    setDraft(emptyDraft(nextOrder))
    setPhotos([])
    setDetectedColors([])
    setDetecting(false)
    setDetectError(null)
    lastDetectedKey.current = null
    setFormError(null)
    setNotice(null)
    setOptimizeStatus(null)
    setOptimizeError(null)
  }

  const openEdit = (product: DbProduct) => {
    const savedColors = normalizeDetectedColors(product.colors)
    const savedPrimary =
      savedColors.find((c) => c.primary) ?? savedColors[0]
    // Fila vieja (sin columna category) u otro valor → 'deca'.
    // Se acepta el valor legacy 'tennis' como 'jj' por compatibilidad.
    const savedCategory: 'deca' | 'jj' =
      typeof product.category === 'string' &&
      (product.category.trim().toLowerCase() === 'jj' ||
        product.category.trim().toLowerCase() === 'tennis')
        ? 'jj'
        : 'deca'
    setDraft({
      id: product.id,
      name: (product.name ?? '').toUpperCase(),
      price:
        typeof product.price === 'number'
          ? String(product.price)
          : typeof product.price === 'string'
            ? product.price
            : '',
      currency: typeof product.currency === 'string' ? product.currency : '',
      // Sin campo manual: se hereda el primario guardado, fallback al color legacy.
      color: savedPrimary
        ? savedPrimary.name
        : typeof product.color === 'string'
          ? product.color
          : '',
      colors: savedColors,
      description: typeof product.description === 'string' ? product.description : '',
      image_url: product.image_url,
      visible: product.visible,
      sort_order: product.sort_order,
      period_start_year: product.period_start_year ?? null,
      product_group_id:
        typeof product.product_group_id === 'string' ? product.product_group_id : '',
      category: savedCategory,
    })
    const slots = galleryFromProduct(product).map((url) => ({
      key: slotKey(),
      preview: url,
      url,
      isNew: false,
    }))
    setPhotos(slots)
    const saved = normalizeDetectedColors(product.colors)
    setDetectedColors(saved)
    // Con paleta guardada no se re-detecta encima; sin paleta, el efecto
    // la detecta sola desde la foto principal.
    lastDetectedKey.current =
      saved.length > 0 && slots.length > 0 ? slots[0].key : null
    setDetecting(false)
    setDetectError(null)
    setFormError(null)
    setNotice(null)
    setOptimizeStatus(null)
    setOptimizeError(null)
  }

  const closeEditor = () => {
    // El panel queda siempre visible: cancelar limpia y vuelve a nuevo,
    // no oculta el editor.
    for (const slot of photos) {
      if (slot.isNew) URL.revokeObjectURL(slot.preview)
    }
    const nextOrder =
      products.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1
    setDraft(emptyDraft(nextOrder))
    setPhotos([])
    setDetectedColors([])
    setDetecting(false)
    setDetectError(null)
    lastDetectedKey.current = null
    setFormError(null)
    setOptimizeStatus(null)
    setOptimizeError(null)
  }

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    // Validate everything first so one bad file never adds a partial batch.
    for (const file of incoming) {
      const reason = rejectedReason(file)
      if (reason) {
        setFormError(reason)
        return
      }
    }
    if (photos.length >= MAX_PHOTOS) {
      setFormError(`Máximo ${MAX_PHOTOS} fotos por producto.`)
      return
    }
    const room = MAX_PHOTOS - photos.length
    if (incoming.length > room) {
      setFormError(`Máximo ${MAX_PHOTOS} fotos por producto (${photos.length} / ${MAX_PHOTOS}).`)
      return
    }
    setFormError(null)
    setPhotos((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        key: slotKey(),
        preview: URL.createObjectURL(file),
        file,
        isNew: true,
      })),
    ])
  }

  const removePhoto = (key: string) => {
    setPhotos((prev) => {
      const slot = prev.find((s) => s.key === key)
      if (slot?.isNew) URL.revokeObjectURL(slot.preview)
      return prev.filter((s) => s.key !== key)
    })
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    addFiles(event.dataTransfer.files)
  }

  /* --- Corrección manual de la paleta detectada --- */

  const setPrimaryColor = (index: number) => {
    setDetectedColors((prev) => prev.map((c, i) => ({ ...c, primary: i === index })))
  }

  /** Reparte para que los porcentajes sumen ≈100. */
  const renormalize = (rows: DetectedColor[]): DetectedColor[] => {
    const total = rows.reduce((s, c) => s + c.percentage, 0)
    if (total <= 0) return rows.map((c) => ({ ...c, percentage: 0 }))
    let acc = 0
    return rows.map((c, i) => {
      if (i === rows.length - 1) return { ...c, percentage: 100 - acc }
      const p = Math.round((c.percentage / total) * 100)
      acc += p
      return { ...c, percentage: p }
    })
  }

  const removeDetectedColor = (index: number) => {
    setDetectedColors((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length > 0 && !next.some((c) => c.primary)) {
        next[0] = { ...next[0], primary: true }
      }
      // Renormalizar para que sigan sumando ≈100.
      return renormalize(next)
    })
  }

  /** Nombre de preset (MAYÚSCULAS) a formato legible ("BLACK" → "Black"). */
  const presetDisplayName = (upper: string): string =>
    upper
      .toLowerCase()
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('-')

  /** Un toque: reemplaza nombre + HEX del color por un preset. */
  const applyPresetToColor = (index: number, presetName: string, presetHex: string) => {
    const name = presetDisplayName(presetName)
    const hex = presetHex.toUpperCase()
    setDetectedColors((prev) =>
      prev.map((c, i) => (i === index ? { ...c, name, hex } : c)),
    )
  }

  /** Selector visual: cambia HEX + nombre de una vez. */
  const pickColorVisual = (index: number, hex: string) => {
    const clean = hex.toUpperCase()
    setDetectedColors((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, hex: clean, name: nearestColorName(clean) } : c,
      ),
    )
  }

  /** Agrega un color manual (entra con 5% y se renormaliza). */
  const addManualColor = () => {
    setDetectedColors((prev) => {
      if (prev.length >= 6) {
        setFormError('Máximo 6 colores por producto.')
        return prev
      }
      setFormError(null)
      const used = new Set(prev.map((c) => c.name.trim().toUpperCase()))
      const preset =
        COMMON_CAP_COLORS.find((p) => !used.has(p.name)) ?? COMMON_CAP_COLORS[0]
      const next: DetectedColor = {
        name: presetDisplayName(preset.name),
        hex: preset.hex.toUpperCase(),
        percentage: 5,
        primary: prev.length === 0,
      }
      return renormalize([...prev, next])
    })
  }

  const updateDetectedColor = (index: number, patch: { name?: string; hex?: string }) => {
    setDetectedColors((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c
        const next = { ...c }
        if (patch.name !== undefined) {
          const name = patch.name.trim()
          if (name !== '') next.name = name
        }
        if (patch.hex !== undefined) {
          let hex = patch.hex.trim().toUpperCase()
          if (!hex.startsWith('#')) hex = `#${hex}`
          if (/^#[0-9A-F]{3}$/.test(hex)) {
            hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
          }
          // HEX inválido: se conserva el anterior.
          if (/^#[0-9A-F]{6}$/.test(hex)) next.hex = hex
        }
        return next
      }),
    )
  }

  const uploadImage = async (image: File): Promise<string> => {
    if (!supabase) throw new Error('Supabase no configurado')
    const rawExt = image.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const ext = /^[a-z0-9]{2,4}$/.test(rawExt) ? rawExt : 'jpg'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, image, { upsert: false })
    if (error) throw error
    const { data } = supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(path)
    return data.publicUrl
  }

  const uploadBlob = async (
    path: string,
    blob: Blob,
    contentType: string,
  ): Promise<string> => {
    if (!supabase) throw new Error('Supabase no configurado')
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, blob, { contentType, upsert: false })
    if (error) throw error
    const { data } = supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(path)
    return data.publicUrl
  }

  const removeStoredImage = async (url: string | null) => {
    if (!supabase) return
    const paths = [storagePathFromUrl(url)].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    // La variante thumb vive junto al product.webp: se borra el par junto
    // para no dejar huérfanos (productos viejos no tienen thumb: no-op).
    const thumbUrl = url ? thumbFor(url) : url
    if (thumbUrl && thumbUrl !== url) {
      const thumbPath = storagePathFromUrl(thumbUrl)
      if (thumbPath) paths.push(thumbPath)
    }
    if (paths.length === 0) return
    await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths)
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !draft) {
      setFormError('No se pudo guardar: Supabase no está configurado.')
      return
    }
    // Silent-looking no-op by design (button is disabled + shows GUARDANDO…),
    // but never a stuck state: the ref is always cleared in `finally` below.
    if (saving || savingRef.current) return
    // Names are stored uppercase for real, everywhere.
    const name = draft.name.trim().toUpperCase()
    if (!name) {
      setFormError('El producto necesita un nombre.')
      return
    }
    if (photos.length === 0) {
      setFormError('Subí al menos 1 foto para el producto.')
      return
    }
    if (photos.length > MAX_PHOTOS) {
      setFormError(`Máximo ${MAX_PHOTOS} fotos por producto.`)
      return
    }
    const periodStartYear = draft.period_start_year
    // Period is optional: if provided, it must be a valid year.
    // If omitted, the DB will derive it from created_at.
    if (
      periodStartYear !== null &&
      (!Number.isInteger(periodStartYear) ||
        periodStartYear < 2000 ||
        periodStartYear > 2100)
    ) {
      setFormError('Período inválido: debe ser un año entre 2000 y 2100.')
      return
    }
    const priceRaw = draft.price.trim()
    let price: number | null = null
    if (priceRaw !== '') {
      const parsed = Number(priceRaw)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError('Precio inválido: debe ser un número mayor o igual a 0.')
        return
      }
      price = parsed
    }
    const group = draft.product_group_id.trim()
    savingRef.current = true
    setSaving(true)
    setFormError(null)
    setOptimizeError(null)

    // Upload new files first. On any failure (or DB failure below),
    // freshly uploaded URLs are removed so Storage never fills with orphans.
    const uploaded: string[] = []
    const urlByKey = new Map<string, string>()
    try {
      const pending = photos.filter((s) => s.isNew && s.file)
      if (pending.length > 0) setOptimizeStatus(`Optimizando imagen… (0/${pending.length})`)
      let done = 0
      for (const slot of photos) {
        if (!slot.isNew) {
          if (slot.url) urlByKey.set(slot.key, slot.url)
          continue
        }
        if (!slot.file) continue
        // La detección de colores sigue usando slot.file local (sin cambios).
        try {
          // Variante optimizada + thumb bajo la misma carpeta propia.
          const [productBlob, thumbBlob] = await Promise.all([
            optimizeProductImage(slot.file),
            createThumbnail(slot.file),
          ])
          const base = `${Date.now()}-${Math.random().toString(36).slice(2)}`
          const productPath = `${base}/product.webp`
          const thumbPath = `${base}/thumb.webp`
          const productType =
            productBlob.type === 'image/webp' ? 'image/webp' : 'image/png'
          const thumbType =
            thumbBlob.type === 'image/webp' ? 'image/webp' : 'image/png'
          const [productUrl, thumbUrl] = await Promise.all([
            uploadBlob(productPath, productBlob, productType),
            uploadBlob(thumbPath, thumbBlob, thumbType),
          ])
          uploaded.push(productUrl, thumbUrl)
          urlByKey.set(slot.key, productUrl)
        } catch (optErr) {
          // Fallback por foto: si UNA falla, esa sube original y se sigue.
          const detail =
            optErr instanceof Error ? optErr.message : 'error desconocido'
          setOptimizeError(`Error al optimizar imagen: ${detail}`)
          const url = await uploadImage(slot.file)
          uploaded.push(url)
          urlByKey.set(slot.key, url)
        }
        done += 1
        if (pending.length > 0)
          setOptimizeStatus(
            done < pending.length
              ? `Optimizando imagen… (${done}/${pending.length})`
              : null,
          )
      }
      setOptimizeStatus(null)
      const finalUrls = photos
        .map((slot) => urlByKey.get(slot.key))
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
        .slice(0, MAX_PHOTOS)
      if (finalUrls.length === 0) {
        throw new Error('Subí una imagen para el producto.')
      }
      const imageUrl = finalUrls[0]
      // Thumbs explícitos en paralelo a finalUrls: thumbFor deriva
      // thumb.webp por convención y devuelve la misma URL cuando la foto
      // subió como original (fallo de optimización) o es producto viejo.
      const thumbnails = finalUrls.map((url) => thumbFor(url))

      // Sin campo COLOR manual: la DB hereda el nombre del primario detectado.
      const primaryDetected =
        detectedColors.find((c) => c.primary) ?? detectedColors[0]
      const color = primaryDetected
        ? primaryDetected.name.trim()
        : draft.color.trim()
      const description = draft.description.trim()

      // NOTE: `code` was removed from the UI. The DB column stays untouched
      // (old rows keep their value); it is simply never sent anymore.
      // NOTE: `currency` was removed from the UI. The DB column stays untouched
      // (old rows keep their value, display falls back to RD$); never sent.
      const fullPayload: Record<string, unknown> = {
        name,
        price,
        color: color === '' ? null : color,
        colors: detectedColors.length > 0 ? detectedColors : null,
        description: description === '' ? null : description,
        image_url: imageUrl,
        images: finalUrls,
        thumbnails,
        product_group_id: group === '' ? null : group,
        category: draft.category,
        visible: draft.visible,
        sort_order: draft.sort_order,
      }
      if (periodStartYear !== null) {
        fullPayload.period_start_year = periodStartYear
      }

      // Snapshot before save: removed remote URLs are deleted from
      // Storage ONLY after the DB save succeeds (safe cleanup).
      const previous = draft.id ? products.find((p) => p.id === draft.id) : undefined
      const previousUrls = previous ? galleryFromProduct(previous) : []
      const removedUrls = previousUrls.filter((url) => !finalUrls.includes(url))

      const draftId = draft.id
      // Cliente ya validado arriba (narrowing no entra a closures: se captura).
      const db = supabase
      const tryPersist = async (
        payload: Record<string, unknown>,
      ): Promise<'ok' | 'missing-column'> => {
        try {
          if (draftId) {
            const { error } = await db
              .from('products')
              .update(payload)
              .eq('id', draftId)
            if (error) throw error
          } else {
            const { error } = await db.from('products').insert(payload)
            if (error) throw error
          }
          return 'ok'
        } catch (err) {
          if (!isMissingSchemaColumn(err)) throw err
          return 'missing-column'
        }
      }

      let savedWithFallback = false
      let colorsNotSaved = false
      if ((await tryPersist(fullPayload)) === 'missing-column') {
        // La columna colors puede faltar aunque el resto esté al día:
        // reintentar sin paleta antes de caer al legado.
        const withoutColors = { ...fullPayload }
        delete withoutColors.colors
        if ((await tryPersist(withoutColors)) === 'missing-column') {
          // Old schema: keep the product editable with legacy columns.
          const legacyPayload: Record<string, unknown> = {
            name,
            image_url: imageUrl,
            visible: draft.visible,
            sort_order: draft.sort_order,
          }
          if (periodStartYear !== null) {
            legacyPayload.period_start_year = periodStartYear
          }
          const retry = draftId
            ? await supabase
                .from('products')
                .update(legacyPayload)
                .eq('id', draftId)
            : await supabase.from('products').insert(legacyPayload)
          if (retry.error) throw retry.error
          savedWithFallback = true
        } else {
          colorsNotSaved = true
        }
      }

      // Safe cleanup: DB row already points at finalUrls.
      for (const url of removedUrls) {
        await removeStoredImage(url)
      }

      closeEditor()
      setNotice(
        savedWithFallback
          ? schemaWarning
          : colorsNotSaved
            ? colorsWarning
            : null,
      )
      await fetchProducts()
      // Tras crear, el borrador reseteado reusaba el mismo sort_order:
      // se avanza uno para el siguiente alta (el panel queda siempre visible).
      if (!draftId) {
        setDraft((prev) =>
          prev && !prev.id
            ? { ...prev, sort_order: prev.sort_order + 1 }
            : prev,
        )
      }
    } catch (err) {
      // Avoid orphans: anything uploaded in this attempt is rolled back.
      for (const url of uploaded) {
        await removeStoredImage(url)
      }
      setFormError(formatAdminError(err, 'No se pudo guardar el producto.'))
    } finally {
      savingRef.current = false
      setSaving(false)
      setOptimizeStatus(null)
    }
  }

  /* --- Delete (two-step confirm) --- */

  const handleDelete = async (product: DbProduct) => {
    if (!supabase || deleting) return
    if (confirmingId !== product.id) {
      setConfirmingId(product.id)
      return
    }
    setDeleting(true)
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', product.id)
    if (error) {
      setListError(formatAdminError(error, 'No se pudo eliminar el producto.'))
    } else {
      // Product row is gone: every gallery URL is now safe to remove.
      for (const url of galleryFromProduct(product)) {
        await removeStoredImage(url)
      }
      setConfirmingId(null)
      await fetchProducts()
    }
    setDeleting(false)
  }

  /* --- Reordenar (subir/bajar en el inicio) --- */

  const moveProduct = async (id: string, dir: -1 | 1) => {
    if (!supabase || reordering) return
    const idx = products.findIndex((p) => p.id === id)
    const current = products[idx]
    const other = products[idx + dir]
    if (!current || !other) return
    setReordering(true)
    setListError(null)
    try {
      // Intercambia sort_order con el vecino; si están empatados se
      // desplaza uno para desempatar. El inicio ordena por sort_order.
      const target =
        current.sort_order === other.sort_order
          ? other.sort_order + dir
          : other.sort_order
      const a = await supabase
        .from('products')
        .update({ sort_order: target })
        .eq('id', current.id)
      if (a.error) throw a.error
      if (current.sort_order !== other.sort_order) {
        const b = await supabase
          .from('products')
          .update({ sort_order: current.sort_order })
          .eq('id', other.id)
        if (b.error) throw b.error
      }
      await fetchProducts()
    } catch (err) {
      setListError(formatAdminError(err, 'No se pudo reordenar.'))
    } finally {
      setReordering(false)
    }
  }

  /* --- Render --- */

  if (!isSupabaseConfigured || !supabase) {
    return (
      <main className={styles.admin}>
        <p className={styles.kicker}>DECA — ADMIN</p>
        <h1 className={styles.heading}>Falta configuración</h1>
        <p className={styles.body}>
          Definí estas variables de entorno y ejecutá el SQL de
          supabase/schema.sql:
        </p>
        <pre className={styles.code}>
          VITE_SUPABASE_URL{'\n'}VITE_SUPABASE_ANON_KEY{'\n'}
          VITE_ADMIN_EMAIL (opcional)
        </pre>
      </main>
    )
  }

  if (authChecking) {
    return (
      <main className={styles.admin}>
        <p className={styles.kicker}>DECA — ADMIN</p>
        <p className={styles.body}>Verificando acceso…</p>
      </main>
    )
  }

  if (userEmail === null) {
    return (
      <main className={styles.admin}>
        <p className={styles.kicker}>DECA — ADMIN</p>
        <h1 className={styles.heading}>Acceso privado</h1>
        <form className={styles.form} onSubmit={handleLogin}>
          <label className={styles.label}>
            EMAIL
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
          </label>
          <label className={styles.label}>
            CONTRASEÑA
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
          </label>
          {loginError && <p className={styles.error}>{loginError}</p>}
          <button className={styles.primary} type="submit" disabled={loginBusy}>
            {loginBusy ? 'ENTRANDO…' : 'ENTRAR'}
          </button>
        </form>
      </main>
    )
  }

  if (!authorized) {
    return (
      <main className={styles.admin}>
        <p className={styles.kicker}>DECA — ADMIN</p>
        <h1 className={styles.heading}>Sin autorización</h1>
        <p className={styles.body}>
          Esta cuenta ({userEmail}) no tiene acceso al panel.
        </p>
        <button className={styles.ghost} type="button" onClick={handleLogout}>
          SALIR
        </button>
      </main>
    )
  }

  return (
    <>
      <header className={styles.adminHeader}>
        <p className={styles.kicker}>DECA — ADMIN</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={styles.small}
            type="button"
            onClick={() => setAdminTab('products')}
            disabled={adminTab === 'products'}
          >
            PRODUCTOS
          </button>
          <button
            className={styles.small}
            type="button"
            onClick={() => setAdminTab('analytics')}
            disabled={adminTab === 'analytics'}
          >
            DECA ANALYTICS
          </button>
        </div>
        <button className={styles.ghost} type="button" onClick={handleLogout}>
          SALIR
        </button>
      </header>
      {adminTab === 'analytics' ? (
        <main className={styles.admin}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <AnalyticsPanel products={products} />
          </div>
        </main>
      ) : (
      <main className={styles.admin}>
        <div className={styles.content}>
        <div className={styles.listPane}>
          <h1 className={styles.heading}>Productos</h1>
          {listError && <p className={styles.error}>{listError}</p>}
          {listBusy && <p className={styles.body}>Cargando…</p>}
          {notice && <p className={styles.body}>{notice}</p>}

          <div className={styles.list}>
        {products.map((product, index) => {
          const count = galleryFromProduct(product).length
          return (
            <div key={product.id} className={styles.row}>
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt=""
                  className={styles.thumb}
                  loading="lazy"
                />
              ) : (
                <span className={styles.thumbEmpty}>—</span>
              )}
              <div className={styles.rowInfo}>
                <span className={styles.rowName}>{product.name}</span>
                <span
                  className={
                    product.visible ? styles.badgeOn : styles.badgeOff
                  }
                >
                  {product.visible ? 'Visible' : 'Oculto'} ·{' '}
                  {String(product.sort_order).padStart(2, '0')} ·{' '}
                  {product.period_start_year
                    ? periodLabel(product.period_start_year)
                    : 'AUTO'} · {count} FOTO{count === 1 ? '' : 'S'}
                  {product.product_group_id ? ` · ${product.product_group_id}` : ''}
                  {' · '}
                  {typeof product.category === 'string' &&
                  product.category.trim().toLowerCase() === 'jj'
                    ? 'JJ'
                    : 'DECA'}
                </span>
              </div>
              <div className={styles.rowActions}>
                <button
                  className={styles.small}
                  type="button"
                  disabled={reordering || index === 0}
                  onClick={() => void moveProduct(product.id, -1)}
                  aria-label={`Subir ${product.name} en el inicio`}
                  title="Subir"
                >
                  ↑
                </button>
                <button
                  className={styles.small}
                  type="button"
                  disabled={reordering || index === products.length - 1}
                  onClick={() => void moveProduct(product.id, 1)}
                  aria-label={`Bajar ${product.name} en el inicio`}
                  title="Bajar"
                >
                  ↓
                </button>
                <button
                  className={styles.small}
                  type="button"
                  onClick={() => openEdit(product)}
                >
                  Editar
                </button>
                <button
                  className={styles.danger}
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete(product)}
                >
                  {confirmingId === product.id
                    ? '¿Eliminar este producto?'
                    : 'Eliminar'}
                </button>
                {confirmingId === product.id && (
                  <button
                    className={styles.small}
                    type="button"
                    onClick={() => setConfirmingId(null)}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!listBusy && products.length === 0 && (
          <p className={styles.body}>Todavía no hay productos.</p>
        )}
          </div>
        </div>

        {draft && (
          <div
            className={styles.editorPane}
            role="dialog"
            aria-label={draft.id ? 'Editar producto' : 'Nuevo producto'}
          >
            <form className={styles.sheet} onSubmit={handleSave}>
            <h2 className={styles.heading}>
              {draft.id ? 'Editar producto' : 'Nuevo producto'}
            </h2>

            <div className={styles.sheetGrid}>
              <div className={styles.sheetCol}>
            <span className={styles.label}>
              FOTOS — {photos.length} / {MAX_PHOTOS} (JPG, PNG, WebP · sin HEIC)
            </span>
            <div
              className={`${styles.drop} ${dragOver ? styles.dropOver : ''} ${photos.length > 0 ? styles.dropHasPhotos : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fileInputRef.current?.click()
              }}
              aria-label="Add product photos"
            >
              {photos.length === 0 ? (
                <span className={styles.body}>
                  Arrastrá hasta {MAX_PHOTOS} imágenes aquí · Seleccionar imágenes
                </span>
              ) : (
                <>
                  <div className={styles.photoGrid}>
                    {photos.map((slot, index) => (
                      <div key={slot.key} className={styles.photoCell}>
                        <img src={slot.preview} alt="" className={styles.photoImg} />
                        <span className={styles.photoIndex}>
                          {index === 0 ? 'PRINCIPAL' : String(index + 1).padStart(2, '0')}
                        </span>
                        <div
                          className={styles.photoActions}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className={styles.small}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removePhoto(slot.key)
                            }}
                            aria-label={`Remove photo ${index + 1}`}
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />

            <span className={`${styles.label} ${styles.colorsLabel}`}>
              COLORES DETECTADOS — FOTO PRINCIPAL
            </span>
            {detecting && <p className={styles.body}>Analizando colores…</p>}
            {detectError && <p className={styles.error}>{detectError}</p>}
            {!detecting && !detectError && detectedColors.length === 0 && (
              <p className={styles.body}>
                {photos.length === 0
                  ? 'Subí la foto principal para detectar sus colores automáticamente.'
                  : 'Sin colores relevantes en esta foto.'}
              </p>
            )}
            {detectedColors.length > 0 && (
              <div className={styles.detectedList}>
                {detectedColors.map((c, index) => (
                  <div key={index} className={styles.detectedRow}>
                    <span
                      className={styles.detectedSwatch}
                      style={{
                        backgroundColor: c.hex,
                        width: c.primary ? 32 : 24,
                        height: c.primary ? 32 : 24,
                      }}
                      aria-hidden="true"
                    />
                    <div className={styles.detectedInfo}>
                      <div className={styles.detectedTop}>
                        <input
                          className={styles.detectedName}
                          value={c.name}
                          onChange={(e) =>
                            updateDetectedColor(index, { name: e.target.value })
                          }
                          aria-label={`Nombre del color ${index + 1}`}
                        />
                        <span className={styles.body}>{c.percentage}%</span>
                        {c.primary && (
                          <span className={styles.primaryBadge}>PRIMARY</span>
                        )}
                      </div>
                      <div
                        className={styles.detectedBar}
                        role="img"
                        aria-label={`${c.name} ${c.percentage}%`}
                      >
                        <span
                          className={styles.detectedFill}
                          style={{ width: `${c.percentage}%`, backgroundColor: c.hex }}
                        />
                      </div>
                      <div className={styles.detectedActions}>
                        <input
                          type="color"
                          className={styles.colorPicker}
                          value={c.hex}
                          onChange={(e) => pickColorVisual(index, e.target.value)}
                          aria-label={`Elegir cualquier color para ${c.name}`}
                          title="Elegir cualquier color"
                        />
                        <input
                          className={styles.detectedHex}
                          value={c.hex}
                          onChange={(e) =>
                            updateDetectedColor(index, { hex: e.target.value })
                          }
                          aria-label={`HEX del color ${index + 1}`}
                          spellCheck={false}
                        />
                        {!c.primary && (
                          <button
                            className={styles.small}
                            type="button"
                            onClick={() => setPrimaryColor(index)}
                          >
                            Principal
                          </button>
                        )}
                        <button
                          className={styles.small}
                          type="button"
                          onClick={() => removeDetectedColor(index)}
                          aria-label={`Quitar color ${c.name}`}
                        >
                          Quitar
                        </button>
                      </div>
                      <div
                        className={styles.presetRow}
                        role="group"
                        aria-label={`Cambiar color ${index + 1} con un toque`}
                      >
                        {COMMON_CAP_COLORS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            className={styles.presetDot}
                            style={{ backgroundColor: preset.hex }}
                            title={preset.name}
                            aria-label={`Poner ${preset.name} en este lugar`}
                            onClick={() =>
                              applyPresetToColor(index, preset.name, preset.hex)
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {photos.length > 0 && (
              <button
                className={styles.ghost}
                type="button"
                disabled={detecting}
                onClick={() => void runDetection(photos[0])}
              >
                {detecting ? 'ANALIZANDO…' : 'DETECTAR DE NUEVO'}
              </button>
            )}
            <div>
              <button
                className={styles.small}
                type="button"
                onClick={addManualColor}
              >
                + Agregar color manual
              </button>
            </div>
              </div>
              <div className={styles.sheetCol}>
            <label className={styles.label}>
                NOMBRE
                <input
                  className={styles.input}
                  type="text"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft({ ...draft, name: e.target.value.toUpperCase() })
                  }
                />
              </label>

            <div className={styles.inline}>
              <label className={styles.label}>
                PRECIO
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  step="any"
                  placeholder="1800"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </label>
              <label className={styles.label}>
                PERÍODO (AÑO INICIO) — POR DEFECTO ACTUAL
                <input
                  className={styles.input}
                  type="number"
                  min={2000}
                  max={2100}
                  placeholder="Vacío = automático"
                  value={draft.period_start_year ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    setDraft({
                      ...draft,
                      period_start_year: raw === '' ? null : Number(raw),
                    })
                  }}
                />
              </label>
            </div>

            <label className={styles.label}>
              CONCEPTO / DESCRIPCIÓN
              <textarea
                className={styles.input}
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>

            <div className={styles.label}>
              <span>CATEGORÍA</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={styles.toggle}
                  type="button"
                  aria-pressed={draft.category === 'deca'}
                  onClick={() => setDraft({ ...draft, category: 'deca' })}
                >
                  DECA
                </button>
                <button
                  className={styles.toggle}
                  type="button"
                  aria-pressed={draft.category === 'jj'}
                  onClick={() => setDraft({ ...draft, category: 'jj' })}
                >
                  JJ
                </button>
              </div>
            </div>

            <div className={styles.inline}>
              <label className={styles.label}>
                GRUPO DE VARIANTES (MISMO MODELO, DISTINTO COLOR)
                <input
                  className={styles.input}
                  type="text"
                  list="deca-groups"
                  placeholder="Vacío = independiente · o escribí un grupo nuevo"
                  value={draft.product_group_id}
                  onChange={(e) => setDraft({ ...draft, product_group_id: e.target.value })}
                />
                <datalist id="deca-groups">
                  {existingGroups.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
              </label>
              <div className={styles.label}>
                <span>VISIBLE</span>
                <button
                  className={styles.toggle}
                  type="button"
                  role="switch"
                  aria-checked={draft.visible}
                  onClick={() =>
                    setDraft({ ...draft, visible: !draft.visible })
                  }
                >
                  {draft.visible ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            {draft.product_group_id.trim() ? (
              relatedVariants.length > 0 ? (
                <div
                  className={styles.variantRow}
                  role="group"
                  aria-label="Variants of this group"
                >
                  <span className={styles.body}>Variantes del grupo:</span>
                  {relatedVariants.map((v) => (
                    <span
                      key={v.id}
                      className={styles.variantChip}
                      title={v.color ?? v.name}
                    >
                      <svg
                        viewBox="0 0 32 32"
                        width={16}
                        height={16}
                        aria-hidden="true"
                      >
                        <path
                          d={DECAGRAM_PATH}
                          fill={colorHex(v.color)}
                          stroke="rgba(17, 17, 17, 0.3)"
                          strokeWidth={1}
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className={styles.body}>{v.color ?? v.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.body}>
                  Grupo nuevo: este producto será la primera variante.
                </p>
              )
            ) : (
              <p className={styles.body}>Sin grupo: producto independiente.</p>
            )}

            {optimizeStatus && <p className={styles.body}>{optimizeStatus}</p>}
            {optimizeError && <p className={styles.error}>{optimizeError}</p>}
            {formError && <p className={styles.error}>{formError}</p>}

            <div className={styles.inline} style={{ justifyContent: 'space-between' }}>
              <button
                className={styles.primary}
                type="submit"
                disabled={saving}
              >
                {saving ? 'GUARDANDO…' : 'GUARDAR PRODUCTO'}
              </button>
              <button
                className={styles.ghost}
                type="button"
                style={{ marginLeft: 'auto' }}
                onClick={openNew}
              >
                CANCELAR
              </button>
            </div>
              </div>
            </div>
          </form>
          </div>
        )}
      </div>
      </main>
      )}
    </>
  )
}

export default Admin
