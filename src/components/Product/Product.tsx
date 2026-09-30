import { useEffect, useRef, useState, type CSSProperties, type FC } from 'react'
import type { DetectedColor } from '../../lib/detectColors'
import { periodLabel } from '../../data/archive'
import { colorHex } from '../../lib/productColors'
import styles from './Product.module.css'

// Configuración de WhatsApp (valores editables, todo junto para cambiarlo fácil).
// - phone: número DECA que recibe los pedidos, solo dígitos con código de país.
// - jjPhone: número JJ (tenis del amigo). Vacío = comparte sin destinatario fijo.
// - messagePrefix: primera línea del mensaje que se genera al hacer clic.
const WHATSAPP_CONFIG = {
  phone: '18294662735',
  jjPhone: '18493548397',
  messagePrefix: 'Hola, quiero este producto:',
}

export interface ProductData {
  id: string
  number: string
  /** Legacy editorial code (e.g. SDO / 11005). No longer displayed; kept optional so old rows/seeds still typecheck. */
  code?: string
  name: string
  price: number
  currency: string
  color?: string
  description?: string
  /** Paleta detectada de la foto principal ([] = sin detección). */
  colors?: import('../../lib/detectColors').DetectedColor[] | null
  available: boolean
  imageUrl?: string | null
  /** Full gallery, primary image first. Falls back to [imageUrl]. */
  images?: string[]
  ghost?: string
  periodStartYear: number
  /** Explicit variant group. Same non-null value = same model. */
  productGroupId?: string | null
  /** Línea del producto: 'jj' usa el WhatsApp del amigo, resto usa DECA. */
  category?: 'deca' | 'jj'
}

export interface ProductVariant {
  id: string
  color: string
  name: string
  /** Paleta propia de la variante ([] = color pleno). */
  colors: DetectedColor[]
}

/** Segmentos cónicos: primario mitad, resto mitad (limpieza visual incluida). */
const MIN_SLICE = 7
function circleStops(colors: DetectedColor[]): string {
  const primary = colors.find((c) => c.primary) ?? colors[0]
  const rest = colors.filter((c) => c !== primary)
  const restTotal = rest.reduce((sum, c) => sum + c.percentage, 0) || 1
  const raw: { hex: string; start: number; end: number }[] = [
    { hex: primary.hex, start: 0, end: 50 },
  ]
  let acc = 50
  for (const c of rest) {
    const start = acc
    acc += (c.percentage / restTotal) * 50
    raw.push({ hex: c.hex, start, end: acc })
  }
  raw[raw.length - 1].end = 100
  // Limpieza visual: segmentos mínimos los absorbe el anterior.
  const segs: { hex: string; start: number; end: number }[] = []
  for (const s of raw) {
    const prev = segs[segs.length - 1]
    if (prev && s.end - s.start < MIN_SLICE) {
      prev.end = s.end
      continue
    }
    segs.push({ ...s })
  }
  return segs
    .map((s) => `${s.hex} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
    .join(', ')
}

/** Fondo del círculo: mini pie si hay paleta, color pleno si no. */
function circleStyle(colors: DetectedColor[], fallbackHex: string): CSSProperties {
  if (colors.length === 0) return { backgroundColor: fallbackHex }
  const primary = colors.find((c) => c.primary) ?? colors[0]
  return {
    backgroundColor: primary.hex,
    backgroundImage: `conic-gradient(${circleStops(colors)})`,
  }
}

interface ProductProps {
  product: ProductData
  /** Real variants (same group). Empty/undefined = independent product. */
  variants?: ProductVariant[]
  /** Switch variant by product id (existing handler, full reload). */
  onVariantSelect?: (productId: string) => void
}

/* Escena fija con impulsos temporizados y loop INFINITO (índice virtual,
 * sin duplicar DOM). UNA sola fuente de verdad: currentOffset (posición
 * física del carrusel); todo el render deriva de él.
 *
 * La rueda avanza por impulsos encadenados: los toques 1 y 2 aportan un
 * paso parcial stepProgress (~1/3 de foto) que continúa exactamente desde
 * donde quedó el anterior (se muestrea currentOffset a mitad de vuelo:
 * 0.27→0.60, jamás se reinicia desde cero) sin publicar índice; el tercer
 * toque completa con la misma transición final de la flecha
 * (navigateByKeyboard, camino único) y recién ahí se confirma la selección
 * (touchCount=0, secuencia a null) y se publica el índice (thumbs/alt).
 *
 * Tercer toque: cancela la espera de inmediato (ya no hay regreso posible),
 * viaja currentOffset→objetivo, luego inercia (glide rápido al borde),
 * micro-rebote del muelle, asentamiento y snap exacto al entero, y recién
 * ahí se confirma la selección (touchCount=0, secuencia a null).
 *
 * Ventana de tiempo con UN solo timeout (timeoutRef): cada toque cancela el
 * anterior y crea exactamente uno nuevo; si expira con toques < 3, el propio
 * timeout dispara rollbackToSequenceStart (determinista, sin evento futuro)
 * hasta sequenceStartOffset — guardado explícitamente al pasar 0→1 y
 * congelado en 1→3 (nunca se asume 0). Tras expirar se verifica
 * |offset-inicio|<0.001 (si no, se fuerza) y el próximo toque arranca una
 * secuencia fresca, sin conteo heredado.
 *
 * Token de animación (animationId): cada animación lo incrementa y captura
 * su id; los frames/acciones con id obsoleto se ignoran (nunca pisan un
 * regreso ni un movimiento nuevo). Blur por velocidad (máx maxBlur, 0 al
 * detenerse) y escala/opacidad continuas por distancia al centro. Solo se
 * escriben transform/filter/opacity por rAF desde currentOffset; React solo
 * se entera al confirmar. */

const SCROLL_CONFIG = {
  // Toques encadenados necesarios para completar una foto (3 x 1/3 = 1):
  // 1.º y 2.º solo mueven visualmente (~1/3 cada uno) sin publicar índice;
  // el 3.º completa con la misma transición final de la flecha y publica.
  touchesToChange: 3,
  // Ventana de encadenado (ms): UN solo timeout (timeoutRef); cada toque lo
  // cancela y crea exactamente uno nuevo. Si expira con toques <
  // touchesToChange, el propio timeout dispara rollbackToSequenceStart
  // (sin evento futuro).
  // FIX rueda: era 9 ms, menor que el intervalo humano entre toques
  // (~50-200 ms) y que el glide parcial (stepDuration 333 ms); el segundo
  // toque nunca encadenaba (cada impulso era 0→1 + regreso al mismo índice:
  // la animación se veía pero se aterrizaba en la misma foto). 900 ms cubre
  // el doble toque humano y conserva el rollback ante una pausa real.
  touchTimeout: 900,
  // Progreso (en fotos) que aporta cada impulso parcial.
  stepProgress: 1 / 3,
  // Duración del glide de cada impulso parcial, incluida la inercia final.
  stepDuration: 333,
  // Duración del regreso suave al inicio de la secuencia tras expirar.
  returnDuration: 240,
  // Duración del asentamiento final con micro-rebote (único tramo con lock).
  settleDuration: 180,
  // Sobreimpulso del micro-rebote (~4% del recorrido antes del snap).
  bounceAmount: 0.04,
  // Blur máximo durante el movimiento (px); decae a 0 al detenerse.
  maxBlur: 2,
  // Escala mínima en el borde de salida (1 en el centro, mapeo continuo).
  minScale: 0.3,
  // Opacidad mínima en el borde de salida (1 en el centro).
  minOpacity: 0.33,
  // Distancia donde la atenuación es total: 500 fotos desactiva el
  // ocultamiento por distancia; los marcos lejanos estacionan fuera de
  // escena (translate ±TRAVEL_PCT, recortados por .product) con
  // escala/opacidad fijadas en sus mínimos para no invertir el mapeo.
  edgeFadeDistance: 500,
  // --- Internos conservados del motor (necesarios, documentados) ---
  // Frecuencia natural del muelle del asentamiento (rad/s).
  muelleOmega0: 26,
  // Recorrido vertical como % del marco 1:1 (estaciona fuera de escena).
  TRAVEL_PCT: 200,
  // Recorrido HORIZONTAL en móvil (<1024px): más espacio entre marcos
  // para que el swipe lateral respire (misma mecánica, otro eje).
  TRAVEL_PCT_MOBILE: 280,
  // px de arrastre táctil vertical por foto (scrub continuo 1:1).
  TOUCH_FULL: 280,
  // En móvil el swipe es horizontal y más corto: menos px por foto para
  // cambiar con un gesto corto (ver umbral de confirmación al soltar).
  TOUCH_FULL_MOBILE: 150,
  // Margen al entero para asentar un gesto táctil que quedó al borde.
  MARGEN_ASENTADO_TACTIL: 0.12,
  // Tolerancia para considerar una posición "exacta" (snap/confirmación).
  SNAP_EPS: 0.0005,
  // Escala en el centro y a media foto (mapeo continuo existente).
  centerScale: 1,
  midScale: 0.75,
  // Ganancia del blur por velocidad (px por foto/segundo).
  blurPerVelocity: 1.0,
  // Easing del paso (salida rápida, llegada suave) y del regreso (ida/vuelta).
  stepEasing: 'easeOutCubic',
  returnEasing: 'easeInOutCubic',
} as const

const {
  touchesToChange,
  touchTimeout,
  stepProgress,
  stepDuration,
  returnDuration,
  settleDuration,
  bounceAmount,
  muelleOmega0,
  maxBlur,
  blurPerVelocity,
  centerScale,
  midScale,
  minScale,
  minOpacity,
  edgeFadeDistance,
  stepEasing,
  returnEasing,
  TRAVEL_PCT,
  TRAVEL_PCT_MOBILE,
  TOUCH_FULL,
  TOUCH_FULL_MOBILE,
  MARGEN_ASENTADO_TACTIL,
  SNAP_EPS,
} = SCROLL_CONFIG

/** Resuelve el easing nombrado en SCROLL_CONFIG a su función. */
const easingPorNombre = (nombre: string): ((t: number) => number) => {
  if (nombre === 'easeInOutCubic')
    return (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  // easeOutCubic por defecto: salida rápida, llegada suave.
  return (t: number): number => 1 - Math.pow(1 - t, 3)
}

/** Positive modulo: maps any integer (incl. negative virtual commits)
 *  onto a gallery slot in [0, N). */
const mod = (n: number, N: number): number => ((n % N) + N) % N

/** Círculo de paleta: el primario abarca la mitad, el resto la otra mitad.
 *  Cortes limpios (conic-gradient clásico, compatible con todo navegador). */
const PaletteCircle: FC<{
  colors: NonNullable<ProductData['colors']>
}> = ({ colors }) => {
  const primary = colors.find((c) => c.primary) ?? colors[0]
  const label = colors.map((c) => `${c.name} ${c.percentage}%`).join(', ')
  return (
    <span
      className={styles.paletteCircle}
      role="img"
      aria-label={`Colores de este producto: ${label}`}
      title={label}
      style={circleStyle(colors, primary.hex)}
    />
  )
}

const Product: FC<ProductProps> = ({ product, variants = [], onVariantSelect }) => {
  // Single source of truth for the gallery: explicit images[] wins,
  // otherwise the legacy single imageUrl is the whole gallery.
  const gallery =
    product.images && product.images.length > 0
      ? product.images.slice(0, 5)
      : product.imageUrl
        ? [product.imageUrl]
        : []
  const galleryLength = gallery.length
  // N >= 2 loops forever via the virtual index mapping; a single photo
  // stays a static no-op.
  const loop = galleryLength >= 2

  // NOTE: the parent renders <Product key={product.id} .../>, so selection
  // state resets automatically whenever a different product is shown.
  // Coarse index only: updated at midpoint crossings, drives thumbs + alt.
  const [selected, setSelected] = useState(0)
  const [reduced, setReduced] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<Array<HTMLImageElement | null>>([])
  const selectedRef = useRef(0)
  // ÚNICA fuente de verdad: posición física del carrusel (en fotos,
  // índice virtual). Todo el render deriva de aquí; ninguna función calcula
  // ni modifica translate por su cuenta.
  const currentOffsetRef = useRef(0)
  const gestureStartRef = useRef(0)
  const lockRef = useRef(false)
  const rafRef = useRef(0)
  // Origen confirmado: último entero con índice publicado (thumbs/alt).
  const baseRef = useRef(0)
  // Inicio de la secuencia actual: se guarda explícitamente al pasar el
  // contador 0→1 y se congela en 1→3; null = sin secuencia activa. Es el
  // destino exacto del regreso (nunca se asume 0: el carrusel puede estar
  // en cualquier producto).
  const sequenceStartOffsetRef = useRef<number | null>(null)
  // Contador de toques encadenados en la dirección actual (0..touches).
  const touchCountRef = useRef(0)
  // Dirección de la cadena actual (la reversa la reinicia).
  const dirRef = useRef<0 | 1 | -1>(0)
  // Destino pendiente del teclado: encadena flechas rápidas (cada pulsación
  // avanza una foto desde la anterior aunque el rebote siga en vuelo).
  const kbDestinoRef = useRef<number | null>(null)
  // Compromiso en vuelo (fase 1 del tercer toque: glide sin lock todavía):
  // los impulsos nuevos no lo interrumpen — se encolan (pendienteRef) para
  // no varar el carrusel a mitad de camino sin settle.
  const commitRef = useRef(false)
  // Impulsos de rueda llegados durante el lock o el compromiso: se absorben
  // aquí y confirmar() los DRENA (mueren con su generación) en vez de
  // reponerlos, así nada se mueve después de publicar el índice nuevo. Los
  // saltos explícitos (thumb/scrub/teclado) también la vacían.
  const pendienteRef = useRef<{ dir: 1 | -1; n: number } | null>(null)
  // Regreso en curso: el próximo toque arranca secuencia fresca.
  const isRollingBackRef = useRef(false)
  // ÚNICO timeout de la ventana de encadenado (ver SCROLL_CONFIG): cada
  // toque cancela el anterior y crea exactamente uno nuevo.
  const timeoutRef = useRef(0)
  // Velocidad suavizada (fotos/seg) que alimenta el blur dinámico.
  const velSuavRef = useRef(0)
  const ultimoTRef = useRef(0)
  // Token de animación: cada animación nueva lo incrementa y captura su id;
  // los frames/acciones con id obsoleto se ignoran (nunca pisan un regreso
  // ni un movimiento nuevo).
  const animationIdRef = useRef(0)
  // Generación comprometida: cada confirmar() la incrementa; la ventana de
  // espera y el regreso capturan la vigente al armarse y no actúan si cambió
  // (un commit posterior las mató). Así un timeout/frame tardío jamás escribe
  // la base vieja por encima del índice recién publicado.
  const commitGenRef = useRef(0)
  const touchStartY = useRef(0)
  const touchLastY = useRef(0)
  const touchStartX = useRef(0)
  const touchLastX = useRef(0)
  const touchMode = useRef<'undecided' | 'vertical' | 'horizontal' | 'ignored'>('undecided')
  const touchActive = useRef(false)
  const snapToRef = useRef<(to: number) => void>(() => {})
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  // Eje del carrusel: horizontal con más recorrido en móvil (<1024px),
  // vertical en desktop. El efecto de gestos se re-suscribe al cambiar.
  const [mobile, setMobile] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1023px)').matches,
  )

  // Preload solo de adyacentes (anterior/siguiente al índice publicado)
  // para no descargar la galería completa al montar. Depende del índice
  // publicado: al navegar se precarga la nueva vecindad.
  useEffect(() => {
    const urls =
      product.images && product.images.length > 0
        ? product.images.slice(0, 5)
        : product.imageUrl
          ? [product.imageUrl]
          : []
    if (urls.length <= 1) return
    const current = Math.min(selected, urls.length - 1)
    const neighbors = new Set<number>()
    // En loop el adyacente envuelve (mod); sin loop se acota a los bordes.
    if (loop) {
      neighbors.add(mod(current - 1, urls.length))
      neighbors.add(mod(current + 1, urls.length))
    } else {
      if (current - 1 >= 0) neighbors.add(current - 1)
      if (current + 1 < urls.length) neighbors.add(current + 1)
    }
    neighbors.forEach((i) => {
      const src = urls[i]
      if (!src) return
      const img = new Image()
      img.decoding = 'async'
      img.src = src
    })
  }, [selected, loop, product.id, product.images, product.imageUrl])

  // Track live changes to the reduced-motion preference.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Track del breakpoint móvil: al cruzar 1024px el efecto de gestos se
  // re-suscribe (ver deps) y repinta los marcos en el eje que toca.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1023px)')
    const onChange = (e: MediaQueryListEvent): void => setMobile(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Lock the document while the fixed stage is mounted: the detail view
  // never scrolls, gestures only scrub photos. Restored on unmount.
  // En móvil la página rueda nativa: no se bloquea el scroll.
  useEffect(() => {
    if (mobile) return
    const body = document.body
    const root = document.documentElement
    const prevBody = body.style.overflow
    const prevRoot = root.style.overflow
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    window.scrollTo(0, 0)
    return () => {
      body.style.overflow = prevBody
      root.style.overflow = prevRoot
    }
  }, [mobile])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || galleryLength === 0) return
    const totalSteps = Math.max(galleryLength - 1, 0)
    currentOffsetRef.current = 0
    gestureStartRef.current = 0
    selectedRef.current = 0
    lockRef.current = false

    // Colocación pura por foto: la foto física j se muestra en su
    // ocurrencia virtual más cercana v = j + N*round((p - j)/N), con
    // distancia signada d = v - p. Escala y opacidad continuas por |d|
    // (centro 1 → mitad 0.75 → saliendo 0.1, opacidad → mínima), fijadas en
    // sus mínimos más allá para no invertir el mapeo con edgeFadeDistance
    // 500; el blur es proporcional a la velocidad suavizada (máx maxBlur,
    // 0 quieto). Simétrico en d: la reversa recorre el mismo mapeo al revés.
    const escalaPorDistancia = (ad: number): number => {
      if (ad <= 0.5)
        return centerScale + ((midScale - centerScale) * ad) / 0.5
      return midScale + ((minScale - midScale) * (ad - 0.5)) / 0.5
    }

    // Render central: deriva TODO de currentOffset (única fuente). Ninguna
    // otra función calcula translate: cada frame escribe el offset y llama
    // aquí; el blur sigue a la velocidad y la escala/opacidad a la distancia.
    // EJE: horizontal con más recorrido en móvil, vertical en desktop.
    const renderDesdeOffset = (): void => {
      const p = currentOffsetRef.current
      const horizontal = mobile
      const travel = horizontal ? TRAVEL_PCT_MOBILE : TRAVEL_PCT
      const place = (d: number): string =>
        horizontal
          ? `translate3d(${(d * travel).toFixed(3)}%, 0, 0)`
          : `translate3d(0, ${(d * travel).toFixed(3)}%, 0)`
      // Blur dinámico: sigue a la velocidad, nunca salta (la cola de
      // apagado lo lleva a 0 al detenerse, incluso a mitad de camino).
      const blur = Math.min(maxBlur, velSuavRef.current * blurPerVelocity)
      for (let j = 0; j < galleryLength; j++) {
        const el = imgRefs.current[j]
        if (!el) continue
        const v = j + galleryLength * Math.round((p - j) / galleryLength)
        const d = v - p
        const ad = Math.abs(d)
        if (ad >= edgeFadeDistance) {
          // Fuera de escena (estacionado, invisible y sin costo de pintado).
          el.style.transform = `${place(d)} scale(${minScale.toFixed(4)})`
          el.style.opacity = '0'
          el.style.visibility = 'hidden'
          el.style.filter = 'none'
          continue
        }
        // Escala/opacidad progresivas y continuas por distancia (mapeo
        // existente, fijadas en sus mínimos para no invertir fuera de rango).
        const scale = Math.max(minScale, escalaPorDistancia(ad))
        const opacity = Math.max(minOpacity, Math.min(1, 1 - (1 - minOpacity) * ad))
        el.style.transform = `${place(d)} scale(${scale.toFixed(4)})`
        el.style.opacity = opacity.toFixed(3)
        el.style.visibility = 'visible'
        el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none'
      }
    }

    const cancelSnap = (): void => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }

    // Mide la velocidad instantánea y la suaviza: el blur la sigue sin
    // cambios bruscos tanto al arrancar como al detenerse.
    const medirVelocidad = (p: number): void => {
      const ahora = performance.now()
      const dt = Math.max(ahora - ultimoTRef.current, 1)
      ultimoTRef.current = ahora
      const inst = Math.abs(p - currentOffsetRef.current) / (dt / 1000)
      velSuavRef.current += (inst - velSuavRef.current) * 0.35
    }

    // Vuelo genérico interpolado: el único escritor animado. Invalida el
    // vuelo previo (cancela rAF + token nuevo) y muestrea currentOffset
    // AHORA como origen: un toque a mitad de vuelo continúa desde la
    // posición real (p. ej. 0.27→0.60), jamás reinicia desde 0 o 0.33.
    // Cada frame verifica su token: los obsoletos se ignoran.
    const volarA = (
      hasta: number,
      ms: number,
      easing: (t: number) => number,
      alTerminar?: () => void,
    ): void => {
      cancelSnap()
      // Token nuevo: los frames del vuelo anterior quedan obsoletos.
      const id = ++animationIdRef.current
      const desde = currentOffsetRef.current
      if (Math.abs(hasta - desde) < SNAP_EPS || ms <= 0) {
        currentOffsetRef.current = hasta
        renderDesdeOffset()
        alTerminar?.()
        return
      }
      ultimoTRef.current = performance.now()
      const t0 = ultimoTRef.current
      const paso = (ahora: number): void => {
        // Frame obsoleto (llegó un vuelo nuevo o un regreso): manda el nuevo.
        if (id !== animationIdRef.current) return
        const t = Math.min(Math.max((ahora - t0) / ms, 0), 1)
        const p = desde + (hasta - desde) * easing(t)
        medirVelocidad(p)
        currentOffsetRef.current = p
        renderDesdeOffset()
        if (t < 1) {
          rafRef.current = requestAnimationFrame(paso)
          return
        }
        rafRef.current = 0
        if (id !== animationIdRef.current) return
        alTerminar?.()
      }
      rafRef.current = requestAnimationFrame(paso)
    }

    // Cola de apagado del blur: sin movimiento la velocidad decae y el
    // blur vuelve a 0 de forma gradual, sin cortes. Lleva token propio para
    // no pisar un vuelo nuevo que arranque en medio de la cola.
    const apagarBlur = (): void => {
      cancelSnap()
      const id = ++animationIdRef.current
      let n = 0
      const cola = (): void => {
        if (id !== animationIdRef.current) return
        velSuavRef.current *= 0.7
        renderDesdeOffset()
        if (++n < 8 && velSuavRef.current > 0.01) {
          rafRef.current = requestAnimationFrame(cola)
          return
        }
        rafRef.current = 0
        if (id !== animationIdRef.current) return
        velSuavRef.current = 0
        renderDesdeOffset()
      }
      rafRef.current = requestAnimationFrame(cola)
    }

    // Confirmación: fija el origen y publica el índice (thumbs/alt) SOLO
    // aquí, al completar el recorrido. Los parciales nunca tocan el índice.
    // Deja la secuencia limpia (touchCount=0, inicio a null) y el blur a 0.
    const confirmar = (entero: number): void => {
      const target = loop ? entero : Math.max(0, Math.min(totalSteps, entero))
      cancelSnap()
      window.clearTimeout(timeoutRef.current)
      // Invalida cualquier vuelo residual antes de fijar el estado final.
      animationIdRef.current++
      // Nueva generación comprometida: la ventana de espera, el regreso y la
      // cola de blur armados antes de este commit quedan muertos aunque
      // lleguen a disparar (el regreso lo detecta por generación y no-op).
      commitGenRef.current++
      // El compromiso (si lo había) ya terminó: baja la bandera aquí, único
      // embudo terminal, para que la rueda vuelva a arrancar secuencias.
      commitRef.current = false
      baseRef.current = target
      touchCountRef.current = 0
      dirRef.current = 0
      sequenceStartOffsetRef.current = null
      isRollingBackRef.current = false
      // Sin flecha pendiente: el índice ya quedó publicado.
      kbDestinoRef.current = null
      currentOffsetRef.current = target
      velSuavRef.current = 0
      renderDesdeOffset()
      const slot = mod(target, Math.max(galleryLength, 1))
      if (slot !== selectedRef.current) {
        selectedRef.current = slot
        setSelected(slot)
      }
      // DRENAJE de la cola pendiente (sin reposición): los impulsos que
      // llegaron durante el commit mueren con su generación. Reinyectarlos
      // aquí arrancaba una secuencia parcial con dirección vieja DESPUÉS de
      // publicar el índice nuevo: la galería aterrizaba y enseguida derivaba
      // hacia atrás (hacia la foto anterior) hasta que el timeout la devolvía.
      // La próxima rueda arranca secuencia fresca desde la base nueva.
      pendienteRef.current = null
    }

    // Asentamiento con micro-rebote (muelle subamortiguado): único tramo
    // con lock, termina en snap exacto + confirmación del índice. El
    // sobreimpulso lo fija bounceAmount (~4% del recorrido). Lleva su propio
    // token: si un toque nuevo lo invalida, sus frames se ignoran.
    const asentar = (entero: number): void => {
      const target = loop ? entero : Math.max(0, Math.min(totalSteps, entero))
      if (reducedRef.current || totalSteps === 0) {
        confirmar(target)
        return
      }
      cancelSnap()
      const id = ++animationIdRef.current
      // Muestreo NOW: el muelle parte de la posición física actual.
      const desde = currentOffsetRef.current
      if (Math.abs(desde - target) < SNAP_EPS) {
        confirmar(target)
        return
      }
      lockRef.current = true
      const delta = target - desde
      const t0 = performance.now()
      const settleSec = settleDuration / 1000
      // Amortiguamiento derivado del sobreimpulso deseado:
      // sobreimpulso = exp(-pi*zeta / sqrt(1-zeta²)) → zeta.
      const logB = Math.log(Math.max(bounceAmount, 1e-6))
      const zeta = -logB / Math.sqrt(Math.PI * Math.PI + logB * logB)
      const omega0 = muelleOmega0
      const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
      const zetaTerm = zeta / Math.sqrt(1 - zeta * zeta)
      const s = (ahora: number): void => {
        if (id !== animationIdRef.current) return
        const tau = Math.min(Math.max((ahora - t0) / 1000, 0), settleSec)
        let eased: number
        if (tau >= settleSec) {
          eased = 1
        } else {
          const expTerm = Math.exp(-zeta * omega0 * tau)
          eased =
            1 - expTerm * (Math.cos(omegaD * tau) + zetaTerm * Math.sin(omegaD * tau))
        }
        const p = desde + delta * eased
        medirVelocidad(p)
        currentOffsetRef.current = p
        renderDesdeOffset()
        if (tau < settleSec) {
          rafRef.current = requestAnimationFrame(s)
          return
        }
        rafRef.current = 0
        if (id !== animationIdRef.current) return
        // Snap EXACTO al entero antes de confirmar (sin deriva acumulada).
        currentOffsetRef.current = target
        renderDesdeOffset()
        lockRef.current = false
        confirmar(target)
      }
      rafRef.current = requestAnimationFrame(s)
    }

    // ÚNICO camino de regreso: lo dispara el propio timeout tras 1-2 toques
    // + silencio (determinista, sin evento futuro). Pasos: cancela el
    // timeout, invalida el vuelo previo (token++), captura el offset actual
    // y anima EXACTO hasta sequenceStartOffset; el blur decae a 0 y la
    // escala se restaura progresivamente vía render; al terminar fija
    // currentOffset EXACTO, verifica |offset-inicio|<0.001 (si no, fuerza) y
    // recién ahí touchCount=0 + estado de secuencia limpio.
    const rollbackToSequenceStart = (gen: number): void => {
      // Guardia de generación: un regreso armado antes del último commit
      // nunca escribe, aunque su timeout/frame haya sobrevivido (la base que
      // guarda ya no es reposo: el commit publicó otro índice).
      if (gen !== commitGenRef.current) return
      if (lockRef.current || totalSteps === 0) return
      const inicio = sequenceStartOffsetRef.current
      // Sin secuencia activa no hay nada que revertir.
      if (inicio === null) return
      // Se consume la ventana: el regreso no rearma ningún timeout.
      window.clearTimeout(timeoutRef.current)
      cancelSnap()
      // Invalida el vuelo previo (paso a mitad de camino o cola de blur).
      const id = ++animationIdRef.current
      isRollingBackRef.current = true
      // Captura NOW: el regreso parte de la posición física actual.
      const desde = currentOffsetRef.current
      if (Math.abs(desde - inicio) < SNAP_EPS || returnDuration <= 0) {
        currentOffsetRef.current = inicio
        velSuavRef.current = 0
        renderDesdeOffset()
        commitRef.current = false
        touchCountRef.current = 0
        dirRef.current = 0
        sequenceStartOffsetRef.current = null
        isRollingBackRef.current = false
        return
      }
      ultimoTRef.current = performance.now()
      const t0 = ultimoTRef.current
      const ease = easingPorNombre(returnEasing)
      const paso = (ahora: number): void => {
        // Frame obsoleto (un toque nuevo tomó el control): manda el nuevo.
        if (id !== animationIdRef.current) return
        const t = Math.min(Math.max((ahora - t0) / returnDuration, 0), 1)
        const p = desde + (inicio - desde) * ease(t)
        medirVelocidad(p)
        currentOffsetRef.current = p
        renderDesdeOffset()
        if (t < 1) {
          rafRef.current = requestAnimationFrame(paso)
          return
        }
        rafRef.current = 0
        if (id !== animationIdRef.current) return
        // Fijado EXACTO + aserción final: tras expirar con <3 toques el
        // offset debe volver al inicio (<0.001); si no, se fuerza. Solo al
        // final del regreso, nunca a mitad del movimiento.
        currentOffsetRef.current = inicio
        velSuavRef.current = 0
        renderDesdeOffset()
        if (Math.abs(currentOffsetRef.current - inicio) >= 0.001) {
          currentOffsetRef.current = inicio
          renderDesdeOffset()
        }
        commitRef.current = false
        touchCountRef.current = 0
        dirRef.current = 0
        sequenceStartOffsetRef.current = null
        isRollingBackRef.current = false
      }
      rafRef.current = requestAnimationFrame(paso)
    }

    // Ventana de encadenado: UN solo timeout (timeoutRef). Cada toque
    // cancela el anterior y crea exactamente uno nuevo; al expirar, el
    // propio timeout dispara el regreso central (determinista).
    const armarTimeout = (): void => {
      window.clearTimeout(timeoutRef.current)
      // La ventana pertenece a la generación vigente: si un commit la consume
      // antes de que expire, el disparo tardío se detecta muerto y no regresa.
      const gen = commitGenRef.current
      timeoutRef.current = window.setTimeout(() => {
        if (gen !== commitGenRef.current) return
        rollbackToSequenceStart(gen)
      }, touchTimeout)
    }

    // Tercer toque (o cruce posicional): cancela la espera de inmediato (ya
    // no hay regreso posible), viaja currentOffset→objetivo, luego
    // inercia → micro-rebote → asentamiento → snap EXACTO → selectedIndex
    // publicado → touchCount=0, secuencia a null.
    const completar = (dir: 1 | -1): void => {
      // Sin retorno posible a partir de aquí: se consume la ventana.
      window.clearTimeout(timeoutRef.current)
      // Bandera de compromiso: los impulsos que lleguen durante este glide o
      // el asentamiento no lo interrumpen (se encolan), así el settle + snap
      // + publicación siempre ocurren. La baja confirmar(), único terminal.
      commitRef.current = true
      // El objetivo es la foto siguiente desde el inicio de la secuencia
      // (el carrusel puede estar en cualquier producto, nunca se asume 0).
      const origenEntero = Math.round(
        sequenceStartOffsetRef.current ?? currentOffsetRef.current,
      )
      const destino = loop
        ? origenEntero + dir
        : Math.max(0, Math.min(totalSteps, origenEntero + dir))
      // Fase 1 — inercia: glide rápido desde la posición ACTUAL al borde.
      volarA(destino, stepDuration, easingPorNombre(stepEasing), () => {
        // Fase 2 — asentamiento con rebote, snap exacto y confirmación.
        asentar(destino)
      })
    }

    // Cada toque = un impulso parcial que continúa exactamente desde
    // currentOffset NOW (muestreo a mitad de vuelo: 0.27→0.60, jamás
    // reinicia desde cero). El pase 0→1 guarda el inicio explícito; los
    // toques 2 y 3 lo dejan congelado. La reversa o un regreso previo
    // reinician la cadena desde la posición actual, simétrica.
    const impulsar = (dir: 1 | -1): void => {
      if (totalSteps === 0) return
      // Durante el lock del asentamiento o el compromiso en vuelo, los
      // impulsos no interrumpen: se encolan con conteo (misma dirección
      // acumula, reversa reinicia) y confirmar() los drena al publicar, así
      // ningún vuelo queda sin settle ni nada se mueve tras el commit.
      if (lockRef.current || commitRef.current) {
        const p = pendienteRef.current
        pendienteRef.current =
          p !== null && p.dir === dir
            ? { dir, n: Math.min(p.n + 1, touchesToChange) }
            : { dir, n: 1 }
        return
      }
      // Un regreso en curso no hereda conteo: el toque lo interrumpe y
      // arranca secuencia fresca desde la posición actual.
      if (isRollingBackRef.current) {
        isRollingBackRef.current = false
        touchCountRef.current = 0
        dirRef.current = 0
      }
      // Si el recorrido ya se completó y llegó un toque extra, arranca una
      // cadena nueva en vez de acumular sobre la anterior.
      if (touchCountRef.current >= touchesToChange) {
        touchCountRef.current = 0
        dirRef.current = 0
      }
      if (dirRef.current !== dir) {
        dirRef.current = dir
        touchCountRef.current = 0
      }
      // Secuencia nueva (0→1): el inicio se ancla al entero comprometido
      // (baseRef), NO al offset muestreado. Muestrear a mitad de vuelo
      // (reversa rápida o regreso interrumpido) anclaba el regreso en una
      // fracción y varaba el carrusel a mitad de transición sin rescate. En
      // reposo base == offset, así que el caso normal no cambia; el glide
      // parcial igual continúa desde la posición física actual.
      if (touchCountRef.current === 0)
        sequenceStartOffsetRef.current = baseRef.current
      touchCountRef.current += 1
      // Destino muestreado NOW desde la posición física actual.
      const destinoParcial = currentOffsetRef.current + dir * stepProgress
      // Recorrido completo: por conteo (tercer toque) o porque el paso
      // cruzó la foto (p. ej. tras un arrastre que ya avanzó 2/3).
      const avanzo = Math.abs(destinoParcial - baseRef.current)
      if (touchCountRef.current >= touchesToChange || avanzo >= 1 - SNAP_EPS) {
        completar(dir)
        return
      }
      // Vuelta al origen exacto al revertir un parcial: asienta sin cambiar
      // el índice (sigue siendo el mismo producto).
      if (avanzo <= SNAP_EPS) {
        window.clearTimeout(timeoutRef.current)
        volarA(baseRef.current, stepDuration, easingPorNombre(stepEasing), () => {
          confirmar(baseRef.current)
        })
        return
      }
      // Impulsos 1-2: UN timeout (cancela + crea uno) y glide parcial; al
      // detenerse el blur decae a 0. Si la ventana expira, el timeout
      // revierte al inicio de la secuencia.
      armarTimeout()
      volarA(destinoParcial, stepDuration, easingPorNombre(stepEasing), () => {
        apagarBlur()
      })
    }

    // Teclado: ÚNICO camino (una pulsación = una foto, confirmación
    // directa, sin impulsos parciales). Limpia TODA la máquina de rueda
    // (timeout, conteo, inicio, cola pendiente y compromiso en vuelo) e
    // invalida el vuelo previo con el token; estaciona el offset en el
    // índice comprometido (sin straddle heredado) y asienta con el mismo
    // rebote elegante que un cambio completado. No arma timeouts ni usa
    // stepProgress/rollback. Las flechas rápidas se encadenan desde el
    // destino pendiente para avanzar 1:1.
    const navigateByKeyboard = (dir: 1 | -1): void => {
      if (totalSteps === 0) return
      if (reducedRef.current) {
        // Movimiento reducido: una pulsación = una foto, al instante.
        confirmar(Math.round(currentOffsetRef.current) + dir)
        return
      }
      // Se consume la ventana de rueda: sin regreso pendiente.
      window.clearTimeout(timeoutRef.current)
      cancelSnap()
      // Invalida el vuelo previo (parcial, regreso o asentamiento).
      animationIdRef.current++
      // La flecha es redirección explícita: vacía la cola de rueda pendiente
      // (el asentamiento propio garantiza el terminal en entero exacto).
      pendienteRef.current = null
      // FIX desync flecha→rueda: la flecha cancela TAMBIÉN el compromiso de
      // rueda en vuelo (fase 1 del tercer toque). Sin esto, commitRef quedaba
      // en true con el glide ya invalidado por el token: la próxima secuencia
      // de rueda tras la flecha partía de una base muerta (misma imagen o
      // regreso indebido) en vez de arrancar fresca desde el índice
      // aterrizado por la flecha. Al bajar la bandera aquí, los toques de
      // rueda durante el asentamiento de la flecha se encolan por el lock
      // (se reponen al confirmar, nunca se pierden) y el siguiente toque en
      // reposo ancla su inicio en baseRef ya actualizado.
      commitRef.current = false
      // Secuencia parcial de rueda reiniciada (se limpia, no se cuenta).
      touchCountRef.current = 0
      dirRef.current = 0
      sequenceStartOffsetRef.current = null
      isRollingBackRef.current = false
      // Origen: índice comprometido en reposo; con una flecha aún en vuelo
      // se encadena desde su destino para que cada pulsación avance una foto.
      const enVuelo = lockRef.current || rafRef.current !== 0
      const origen =
        enVuelo && kbDestinoRef.current !== null
          ? kbDestinoRef.current
          : Math.round(baseRef.current)
      currentOffsetRef.current = origen
      velSuavRef.current = 0
      renderDesdeOffset()
      const destino = loop
        ? origen + dir
        : Math.max(0, Math.min(totalSteps, origen + dir))
      kbDestinoRef.current = destino
      // Mismo asentamiento que un cambio completado (rebote + snap exacto +
      // confirmación con blur a 0).
      asentar(destino)
    }

    const isInThumbs = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest(`.${styles.thumbs}`) !== null

    const isFormField = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]') !== null

    // Pintado inicial: foto 0 centrada, resto estacionado; cadena reiniciada.
    baseRef.current = 0
    kbDestinoRef.current = null
    sequenceStartOffsetRef.current = null
    touchCountRef.current = 0
    dirRef.current = 0
    isRollingBackRef.current = false
    velSuavRef.current = 0
    currentOffsetRef.current = 0
    // Estado post-montaje consistente: sin compromiso ni cola heredados (un
    // commit en vuelo al remontar moría sin confirmar y dejaba a la rueda
    // encolando para siempre); la generación nueva entierra ventanas viejas y
    // ningún gesto previo sobrevive al escenario fresco.
    commitRef.current = false
    pendienteRef.current = null
    commitGenRef.current++
    touchActive.current = false
    touchMode.current = 'undecided'
    renderDesdeOffset()
    snapToRef.current = asentar

    const onWheel = (e: WheelEvent): void => {
      if (totalSteps === 0) {
        // Una foto: se captura el gesto para que la página no se mueva.
        e.preventDefault()
        return
      }
      // Rueda horizontal sobre la tira de thumbs: scroll nativo.
      if (isInThumbs(e.target) && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // La escena captura la rueda: la página nunca hace scroll.
      e.preventDefault()
      const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0
      if (dir === 0) return
      if (reducedRef.current) {
        // Movimiento reducido: cada toque confirma una foto al instante.
        confirmar(Math.round(currentOffsetRef.current) + (dir as 1 | -1))
        return
      }
      // Cada toque = un impulso parcial encadenado por ventana de tiempo.
      impulsar(dir as 1 | -1)
    }

    const onTouchStart = (e: TouchEvent): void => {
      const touch = e.touches[0]
      if (!touch) return
      // Durante el lock del asentamiento o el compromiso en vuelo (fase 1
      // del toque que completa) el táctil no roba el control: invalidar esos
      // vuelos los deja huérfanos — el muelle en lock eterno, o commitRef en
      // true sin ningún vuelo que lo lleve a confirmar (un tap o un swipe
      // horizontal no deja touchend vertical que lo rescate). Desde entonces
      // TODA la rueda se encola para siempre y el carrusel parece clavado en
      // la misma foto mientras las flechas siguen funcionando. Se ignora el
      // gesto y la cadena comprometida termina en entero exacto con su
      // confirmación (igual que ya se hacía durante el lock).
      if (lockRef.current || commitRef.current) {
        touchActive.current = false
        return
      }
      // El scrub toma el control: invalida el vuelo previo y consume la
      // ventana para que el regreso no interrumpa el gesto.
      cancelSnap()
      animationIdRef.current++
      window.clearTimeout(timeoutRef.current)
      // Redirección explícita: la secuencia parcial de rueda se reinicia
      // (un tap entre toques no extiende la ventana ni deja conteo heredado)
      // y se vacía la cola de rueda (el touchend propio garantiza el
      // terminal en entero exacto).
      touchCountRef.current = 0
      dirRef.current = 0
      sequenceStartOffsetRef.current = null
      isRollingBackRef.current = false
      pendienteRef.current = null
      touchActive.current = true
      touchMode.current = 'undecided'
      gestureStartRef.current = currentOffsetRef.current
      touchStartY.current = touch.clientY
      touchLastY.current = touch.clientY
      touchStartX.current = touch.clientX
      touchLastX.current = touch.clientX
      ultimoTRef.current = performance.now()
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (!touchActive.current || totalSteps === 0) return
      const touch = e.touches[0]
      if (!touch) return
      if (touchMode.current === 'undecided') {
        const dx = Math.abs(touch.clientX - touchStartX.current)
        const dy = Math.abs(touch.clientY - touchStartY.current)
        if (dx < 10 && dy < 10) return
        // Eje del scrub: horizontal en móvil, vertical en desktop.
        const useHorizontal = mobile ? dx >= dy : dx > dy
        if (useHorizontal) {
          // La tira de thumbs conserva su scroll nativo en ambos ejes.
          if (isInThumbs(e.target)) {
            touchActive.current = false
            return
          }
          if (!mobile) {
            touchMode.current = 'ignored'
            return
          }
          touchMode.current = 'horizontal'
        } else {
          if (mobile) {
            touchMode.current = 'ignored'
            return
          }
          touchMode.current = 'vertical'
        }
      }
      const scrub = mobile ? 'horizontal' : 'vertical'
      if (touchMode.current !== scrub) return
      // El scrub se adueña del gesto: la página queda quieta.
      e.preventDefault()
      // Un commit en vuelo es dueño del terminal igual que el lock: el scrub
      // no le pelea el offset frame a frame (el glide lo recupera solo) y la
      // suelta tampoco lo redirige a la base vieja.
      if (lockRef.current || commitRef.current) {
        if (mobile) touchLastX.current = touch.clientX
        else touchLastY.current = touch.clientY
        return
      }
      const last = mobile ? touchLastX.current : touchLastY.current
      const pos = mobile ? touch.clientX : touch.clientY
      const span = mobile ? TOUCH_FULL_MOBILE : TOUCH_FULL
      const next = currentOffsetRef.current + (last - pos) / span
      if (mobile) touchLastX.current = touch.clientX
      else touchLastY.current = touch.clientY
      medirVelocidad(next)
      currentOffsetRef.current = next
      if (!reducedRef.current) renderDesdeOffset()
    }

    const onTouchEnd = (): void => {
      const scrub = mobile ? 'horizontal' : 'vertical'
      if (!touchActive.current && touchMode.current !== scrub) {
        touchMode.current = 'undecided'
        return
      }
      const wasScrub = touchMode.current === scrub
      touchActive.current = false
      touchMode.current = 'undecided'
      if (!wasScrub) return
      // Con un commit en vuelo, la suelta no decide: el glide + asentamiento
      // en curso publican su destino (la base vieja ya no es reposo y volar
      // hacia ella revertiría el commit recién aterrizado).
      if (lockRef.current || commitRef.current || totalSteps === 0) return
      // Al soltar, la cadena de impulsos se reinicia desde donde quedó.
      window.clearTimeout(timeoutRef.current)
      touchCountRef.current = 0
      dirRef.current = 0
      // El scrub no deja secuencia pendiente: si el próximo gesto es por
      // impulsos, el pase 0→1 guardará su propio inicio (sin estado
      // heredado entre ciclos).
      sequenceStartOffsetRef.current = null
      isRollingBackRef.current = false
      // El táctil confirma solo si cruzó una foto completa (o quedó al
      // borde de una); si no, mantiene la posición parcial sin saltos.
      // En móvil el gesto es corto: basta pasar la mitad para confirmar.
      const startPos = gestureStartRef.current
      const end = currentOffsetRef.current
      const nearest = Math.round(end)
      const crossed =
        Math.floor(end) > Math.floor(startPos) || Math.ceil(end) < Math.ceil(startPos)
      // Gesto corto en móvil (~38px): confirma la foto más cercana sin
      // exigir la foto completa.
      const shortSwipe =
        mobile && nearest !== Math.round(startPos) && Math.abs(end - startPos) >= 0.25
      if (crossed || shortSwipe || Math.abs(end - nearest) <= MARGEN_ASENTADO_TACTIL) {
        asentar(nearest)
        return
      }
      // Sin cruce ni borde: regreso exacto al entero comprometido (baseRef).
      // Estacionar la fracción aquí varaba el carrusel a mitad de transición
      // sin timeout ni secuencia que lo rescate; además contaminaba el
      // inicio de la próxima secuencia. Movimiento reducido: al instante.
      if (reducedRef.current) {
        confirmar(baseRef.current)
        return
      }
      volarA(
        baseRef.current,
        stepDuration,
        easingPorNombre(returnEasing),
        () => {
          confirmar(baseRef.current)
        },
      )
    }

    // ÚNICO listener de teclado de la galería: cada flecha confirma una
    // foto (sin impulsos, sin doble avance). La repetición por mantener la
    // tecla es una ráfaga de pulsaciones y avanza una foto por repetición.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isFormField(e.target)) return
      let dir: 1 | -1 | 0 = 0
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1
      else return
      if (totalSteps === 0) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      navigateByKeyboard(dir as 1 | -1)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchEnd)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      stage.removeEventListener('wheel', onWheel)
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', onTouchEnd)
      stage.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('keydown', onKeyDown)
      // Limpieza al desmontar: sin timeouts vivos y sin animación activa
      // (el token invalida los frames pendientes).
      window.clearTimeout(timeoutRef.current)
      animationIdRef.current++
      cancelSnap()
    }
    // Stage-local gesture rig: remount per product is handled by the parent
    // key, reduced-motion swaps the render path below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryLength, reduced, mobile])

  // Focus the new heading when the product changes (parent remounts per id)
  // so screen readers announce it. preventScroll keeps the stage untouched.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [product.id])

  const safeSelected = Math.min(selected, Math.max(gallery.length - 1, 0))
  const active = gallery[safeSelected] ?? null
  const ghost = product.ghost ?? product.number
  const showPrice = product.price > 0 && product.currency !== 'LL'
  // Moneda a mostrar: la de la variante seleccionada; si viene vacía de la
  // base de datos se usa RD$ (moneda del proyecto en los datos semilla).
  // El valor numérico siempre es el real de product.price, nunca fijo.
  const displayCurrency =
    product.currency !== '' && product.currency !== 'LL'
      ? product.currency
      : 'RD$'

  const showVariants = variants.length > 1 && onVariantSelect
  /** Paleta detectada de este producto (vacía = sin detección). */
  const palette = product.colors ?? []
  /** Variantes con la seleccionada primero (orden estable para el resto). */
  const orderedVariants = [...variants].sort((a, b) => {
    if (a.id === product.id) return -1
    if (b.id === product.id) return 1
    return 0
  })

  // Estado actual compartido: la imagen activa es la thumbnail seleccionada
  // (safeSelected) y el color es el de la variante/producto en pantalla.
  // WhatsApp siempre usa estos mismos valores, sin estados duplicados.
  const priceText = `${displayCurrency} ${product.price.toLocaleString()}`
  const selectedImageUrl = active ?? null
  // URL pública de la imagen seleccionada: si ya es absoluta se usa tal cual,
  // si es relativa se resuelve contra el origen actual.
  const absoluteImageUrl = selectedImageUrl
    ? /^https?:\/\//i.test(selectedImageUrl)
      ? selectedImageUrl
      : typeof window !== 'undefined'
        ? `${window.location.origin}${selectedImageUrl.startsWith('/') ? '' : '/'}${selectedImageUrl}`
        : selectedImageUrl
    : null
  const whatsappMessage = [
    WHATSAPP_CONFIG.messagePrefix,
    '',
    `Producto: ${product.name}`,
    `Color: ${product.color ?? '—'}`,
    `Precio: ${priceText}`,
    `Imagen: ${absoluteImageUrl ?? 'sin imagen'}`,
  ].join('\n')
  // JJ tiene su propio destinatario; DECA usa el número principal.
  const recipient =
    product.category === 'jj' ? WHATSAPP_CONFIG.jjPhone : WHATSAPP_CONFIG.phone
  const whatsappHref = recipient
    ? `https://wa.me/${recipient}?text=${encodeURIComponent(whatsappMessage)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`

  // El clic en un thumb recorre el mismo camino visual que un scrub manual
  // (el único escritor del efecto): apunta a la ocurrencia del loop más
  // cercana, con rebote elegante y confirmación del índice al asentar.
  // Movimiento reducido: salto funcional. Durante el lock del asentamiento
  // los clics se ignoran para no pelear con la animación.
  const goTo = (index: number): void => {
    if (galleryLength <= 1) return
    const slot = mod(index, galleryLength)
    const base = Math.round(currentOffsetRef.current)
    let delta = mod(slot - mod(base, galleryLength), galleryLength)
    if (delta > galleryLength / 2) delta -= galleryLength
    const target = base + delta
    if (delta === 0 && Math.abs(currentOffsetRef.current - target) < SNAP_EPS) return
    if (reducedRef.current) {
      // Salto funcional con la secuencia limpia e invalidando el vuelo previo.
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      animationIdRef.current++
      window.clearTimeout(timeoutRef.current)
      // Terminal exacto y completo: el origen comprometido también avanza al
      // destino (si no, la próxima secuencia/tecla calculaba desde un base
      // viejo y el regreso volvía a un punto que ya no es reposo).
      commitRef.current = false
      pendienteRef.current = null
      kbDestinoRef.current = null
      isRollingBackRef.current = false
      currentOffsetRef.current = target
      baseRef.current = target
      velSuavRef.current = 0
      touchCountRef.current = 0
      dirRef.current = 0
      sequenceStartOffsetRef.current = null
      selectedRef.current = slot
      setSelected(slot)
      return
    }
    if (lockRef.current) return
    window.clearTimeout(timeoutRef.current)
    // Salto explícito: vacía la cola de rueda (el asentamiento propio
    // garantiza el terminal en entero exacto).
    pendienteRef.current = null
    snapToRef.current(target)
  }

  return (
    <div ref={stageRef} className={styles.product} aria-live="polite">
      <div className={styles.layout}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.name}>{product.name}</h1>
        <p className={styles.stepHint}>
          {mobile
            ? 'Swipe horizontally to view this product\u2019s photos.'
            : 'Use the mouse wheel, swipe vertically, or press the arrow keys to view this product\u2019s photos.'}
        </p>

        <div className={styles.center}>
          <div className={styles.field}>
            {gallery.length === 0 || active === null ? (
              <span className={styles.ghost} aria-hidden="true">
                {ghost}
              </span>
            ) : reduced ? (
              <img
                src={active}
                alt={product.name}
                className={styles.photo}
                draggable={false}
                decoding="async"
                loading="eager"
                fetchPriority="high"
              />
            ) : (
              gallery.map((src, index) => {
                // Activa eager + alta prioridad; adyacentes eager para el
                // scrub sin espera; el resto lazy para no descargar todo.
                const distance = loop
                  ? Math.min(
                      mod(index - safeSelected, Math.max(galleryLength, 1)),
                      mod(safeSelected - index, Math.max(galleryLength, 1)),
                    )
                  : Math.abs(index - safeSelected)
                const isActive = index === safeSelected
                return (
                  <img
                    key={`${src}-${index}`}
                    ref={(el) => {
                      imgRefs.current[index] = el
                    }}
                    src={src}
                    alt={isActive ? product.name : ''}
                    aria-hidden={isActive ? undefined : true}
                    className={styles.photo}
                    draggable={false}
                    decoding="async"
                    loading={distance <= 1 ? 'eager' : 'lazy'}
                    {...(isActive ? { fetchPriority: 'high' as const } : {})}
                  />
                )
              })
            )}
          </div>
          {gallery.length > 1 && (
            <div className={styles.dots} role="group" aria-label="Product images">
              {gallery.map((src, index) => {
                const isActive = index === safeSelected
                return (
                  <button
                    key={`${src}-${index}`}
                    type="button"
                    className={isActive ? styles.dotActive : styles.dot}
                    onClick={() => goTo(index)}
                    aria-label={`View image ${index + 1} of ${gallery.length}: ${product.name}`}
                    aria-pressed={isActive}
                    aria-current={isActive ? true : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>

        <div className={styles.infoPanel}>
        <div className={styles.details}>
          <p className={styles.nameInside} aria-hidden="true">{product.name}</p>
          <span className={styles.blockLabel}>Concepto</span>
          <span className={styles.detail}>
            {periodLabel(product.periodStartYear)}
          </span>
          {product.description && (
            <p className={styles.description}>{product.description}</p>
          )}
          {!product.available && (
            <span className={styles.detail}>UNAVAILABLE</span>
          )}
        </div>

        {(showVariants || palette.length > 0) && (
          <div className={styles.colorsBlock} role="group" aria-label="Available colors">
            <span className={styles.blockLabel}>Colores</span>
            {showVariants ? (
            <div className={styles.variants}>
            {orderedVariants.map((variant) => {
              const isSelected = variant.id === product.id
              return (
                <button
                  key={variant.id}
                  type="button"
                  className={isSelected ? styles.variantSelected : styles.variant}
                  onClick={() => {
                    if (!isSelected) onVariantSelect(variant.id)
                  }}
                  aria-label={`View ${variant.name} in ${variant.color}`}
                  aria-pressed={isSelected}
                  aria-current={isSelected ? true : undefined}
                  title={variant.color}
                  disabled={isSelected}
                >
                  <span
                    className={styles.variantDot}
                    style={circleStyle(variant.colors, colorHex(variant.color))}
                    aria-hidden="true"
                  />
                </button>
              )
            })}
            </div>
            ) : (
            <div className={styles.variants}>
              <PaletteCircle colors={palette} />
            </div>
            )}
          </div>
        )}

        {showPrice && (
          <div
            className={styles.price}
            aria-label={`Price: ${displayCurrency} ${product.price.toLocaleString()}`}
          >
            <span className={styles.priceLabel}>Precio</span>
            <span className={styles.priceValue}>
              {displayCurrency} {product.price.toLocaleString()}
            </span>
          </div>
        )}

        <div className={styles.whatsappBlock}>
          <a
            className={styles.whatsappButton}
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Comprar ${product.name} por WhatsApp`}
          >
            Comprar por WhatsApp
          </a>
        </div>
        </div>

        {gallery.length > 1 && (
          <div className={styles.thumbs} role="group" aria-label="Product images">
            {gallery.map((src, index) => {
              const isSelected = index === safeSelected
              return (
                <button
                  key={`${src}-${index}`}
                  type="button"
                  className={isSelected ? styles.thumbSelected : styles.thumb}
                  onClick={() => goTo(index)}
                  aria-label={`View image ${index + 1} of ${gallery.length}: ${product.name}`}
                  aria-pressed={isSelected}
                  aria-current={isSelected ? true : undefined}
                >
                  <img src={src} alt={product.name} className={styles.thumbPhoto} loading="lazy" decoding="async" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default Product
