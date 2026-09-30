/**
 * Detección automática de colores de producto (100% local, sin dependencias).
 *
 * Cómo funciona:
 *  1. La imagen se reduce a miniatura (≈112px) en un <canvas> y se leen sus píxeles.
 *  2. El fondo se estima desde las 4 esquinas: si coinciden, todo píxel
 *     parecido al fondo se ignora (pared, mesa, fondo blanco, sombras leves).
 *     Rescate: si eso deja muy poco peso (gorra del mismo color que el
 *     fondo), se repite sin excluir para no comerse el producto.
 *  3. Cada píxel vota con un peso según su cercanía al centro (elipse):
 *     la gorra suele estar al centro, los bordes pesan casi nada.
 *  4. Los votos se agrupan en cubetas: los tonos grandes mandan por área,
 *     las sombras chicas se pliegan en su tono base y los acentos chicos
 *     pero distintos (bordados, sogas, letras) se conservan desde 0.8%.
 *     Resultado: 3–5 colores con el primario primero.
 *  5. Cada grupo se nombra con el nombre legible más cercano (ver
 *     COLOR_HEX en productColors.ts + extras de abajo) y el primero
 *     queda marcado como primario.
 *
 * La primera foto del producto es la referencia. Todo corre en el navegador:
 * no se sube nada ni se llama a ningún servicio externo.
 */

import { COLOR_HEX } from './productColors'

/** Color detectado listo para guardar en el producto. */
export interface DetectedColor {
  name: string
  hex: string
  /** Proporción dentro del área del producto (0–100, suma ≈100). */
  percentage: number
  primary: boolean
}

// ── Parámetros editables ──────────────────────────────────
// Tamaño máximo de la miniatura analizada (más = más lento, igual resultado).
const SAMPLE_SIZE = 160
// Cuántos colores conservar como máximo.
const MAX_COLORS = 5
// Presencia mínima para no guardar ruido de sombras/costuras.
const MIN_SHARE = 0.04
// Distancia RGB bajo la cual dos cubetas se fusionan en un solo tono.
const MERGE_DISTANCE = 30
// Pliegue de sombras: un grupo chico (menos de este % del peso) cercano a
// otro tono se funde en él (luz/sombra de la misma tela o hilo).
const SHADE_FOLD_DISTANCE = 60
const SHADE_FOLD_MAX_SHARE = 0.12
// …pero un fragmento saturado (hilo de bordado) jamás se funde en un tono
// gris: solo en otro tono con color, para no apagar el diseño.
const SMALL_CHROMA_SAT = 0.35
const SHADE_FOLD_MIN_SAT_HOST = 0.2
// Acentos: grupos chicos pero lejos de todo tono grande son diseños
// (bordados, sogas, letras): se fusionan entre sí y se conservan desde
// esta presencia mínima para que aparezcan aunque ocupen poco.
const ACCENT_MERGE_DISTANCE = 95
const ACCENT_MIN_SHARE = 0.008
// Distancia RGB bajo la cual un píxel se considera fondo y se ignora.
const BACKGROUND_DISTANCE = 42
// Cuán parecidas deben ser las esquinas para asumir que hay fondo liso.
const CORNERS_AGREE_DISTANCE = 40
// Si al excluir el fondo queda menos de esta proporción del peso total,
// la gorra es del mismo color que el fondo (negro sobre negro, blanco
// sobre blanco): se repite sin excluir para no comerse el producto.
const BG_KEEP_RATIO = 0.35

/** Nombres extra (no están en COLOR_HEX) con su HEX representativo. */
const EXTRA_NAMES: Record<string, string> = {
  'OFF-WHITE': '#F1EFE9',
  BLUE: '#2A5DB0',
  YELLOW: '#E8C838',
  PURPLE: '#6B4A8B',
  // Rojo para nombrar bordados: el RED de COLOR_HEX (#D7263D) es muy vivo y
  // los rojos bordados oscuros caían en Burgundy. Este representante intermedio
  // clasifica #9B3028 como Red sin mover los granates a Red. Solo afecta al
  // nombre detectado; COLOR_HEX (puntos de variante) queda intacto.
  RED: '#A8242C',
}

interface RGB {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const num = parseInt(full, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function rgbToHex({ r, g, b }: RGB): string {
  const to = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${to(r)}${to(g)}${to(b)}`
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a.r - b.r) * (a.r - b.r) +
      (a.g - b.g) * (a.g - b.g) +
      (a.b - b.b) * (a.b - b.b),
  )
}

/** Nombre genérico en inglés por tono, cuando ningún nombre conocido acerca. */
function genericNameByHue({ r, g, b }: RGB): string {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 40) return 'Black'
  if (min > 235) return 'White'
  if (max - min < 24) return 'Gray'
  const hue = rgbToHsl(r, g, b)
  if (hue < 14 || hue >= 344) return 'Red'
  if (hue < 38) return max - min < 90 ? 'Brown' : 'Orange'
  if (hue < 72) return 'Yellow'
  if (hue < 160) return 'Green'
  if (hue < 200) return 'Teal'
  if (hue < 262) return 'Blue'
  return 'Purple'
}

function rgbToHsl(r: number, g: number, b: number): number {
  return rgbToHslFull(r, g, b).h
}

/** H/S/L (h 0–360, s/l 0–1) para decisiones por tono. */
function rgbToHslFull(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: h * 360, s, l }
}

const NAMED_PALETTE: { name: string; rgb: RGB }[] = [
  ...Object.entries(COLOR_HEX).map(([name, hex]) => ({
    // Nombres en formato legible: "OFF-WHITE" → "Off-White".
    name: name
      .toLowerCase()
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('-'),
    rgb: hexToRgb(hex),
  })),
  ...Object.entries(EXTRA_NAMES).map(([name, hex]) => ({
    name:
      name.charAt(0).toUpperCase() + name.slice(1).toLowerCase().replace('-w', '-W'),
    rgb: hexToRgb(hex),
  })),
]

/** Nombre legible más cercano al HEX. El HEX original siempre se conserva. */
export function nearestColorName(hex: string): string {
  const rgb = hexToRgb(hex)
  // Tonos vívidos amarillo-verdosos (volt, chartreuse, verde fuerte): en RGB
  // quedan más cerca del oliva apagado de la paleta, pero visualmente son
  // Yellow o Green. El oliva real es poco saturado y no entra acá.
  const { h, s } = rgbToHslFull(rgb.r, rgb.g, rgb.b)
  if (s > 0.7 && h >= 48 && h < 88) return 'Yellow'
  if (s > 0.7 && h >= 88 && h < 152) return 'Green'
  let best = NAMED_PALETTE[0]
  let bestDist = colorDistance(rgb, best.rgb)
  for (const entry of NAMED_PALETTE) {
    const dist = colorDistance(rgb, entry.rgb)
    if (dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }
  // Si ni el más cercano se parece, nombre genérico por tono.
  if (bestDist > 95) return genericNameByHue(rgb)
  return best.name
}

function loadImage(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let objectUrl: string | null = null
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(
        new Error(
          'No se pudo leer la imagen (formato o CORS del origen remoto).',
        ),
      )
    }
    if (typeof source === 'string') {
      // crossOrigin para no "manchar" el canvas con URLs remotas (Supabase
      // sirve Access-Control-Allow-Origin: *, así que la lectura funciona).
      img.crossOrigin = 'anonymous'
      img.src = source
    } else {
      objectUrl = URL.createObjectURL(source)
      img.src = objectUrl
    }
  })
}

interface VoteBucket {
  r: number
  g: number
  b: number
  weight: number
  dead?: boolean
}

function bucketMean(c: VoteBucket): RGB {
  return { r: c.r / c.weight, g: c.g / c.weight, b: c.b / c.weight }
}

/**
 * Analiza la imagen y devuelve hasta MAX_COLORS colores del producto,
 * ordenados por predominancia (el primero es el primario).
 * Lanza Error si la imagen no se puede leer.
 */
export async function detectColorsFromImage(
  source: File | string,
): Promise<DetectedColor[]> {
  const img = await loadImage(source)
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('El navegador no permite leer píxeles (canvas).')
  // Sin suavizado: al reducir, cada píxel conserva su color puro en vez de
  // mezclarse con el vecino (el suavizado apagaba los bordados finos).
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, width, height)

  let pixels: ImageData
  try {
    pixels = ctx.getImageData(0, 0, width, height)
  } catch {
    throw new Error('No se pudo leer la imagen (CORS del origen remoto).')
  }
  const data = pixels.data

  const at = (x: number, y: number): RGB => {
    const i = (y * width + x) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2] }
  }

  // Fondo = promedio de las 4 esquinas (parche de 10% del lado menor).
  const patch = Math.max(1, Math.floor(Math.min(width, height) * 0.1))
  const corners: RGB[] = []
  const cornerOrigins = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ]
  for (const [cx, cy] of cornerOrigins) {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = cy; y < Math.min(cy + patch, height); y++) {
      for (let x = cx; x < Math.min(cx + patch, width); x++) {
        const px = at(x, y)
        r += px.r
        g += px.g
        b += px.b
        n++
      }
    }
    corners.push({ r: r / n, g: g / n, b: b / n })
  }
  // Solo hay "fondo" si las 4 esquinas coinciden entre sí.
  let background: RGB | null = {
    r: corners.reduce((s, c) => s + c.r, 0) / 4,
    g: corners.reduce((s, c) => s + c.g, 0) / 4,
    b: corners.reduce((s, c) => s + c.b, 0) / 4,
  }
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      if (colorDistance(corners[i], corners[j]) > CORNERS_AGREE_DISTANCE) {
        background = null
      }
    }
  }

  // Votación con peso central (elipse): centro = 1, bordes ≈ 0.12.
  // Devuelve cubetas + peso conservado + peso total (incluye fondo).
  const vote = (excludeBg: RGB | null): { buckets: Map<number, VoteBucket>; kept: number; total: number } => {
    const buckets = new Map<number, VoteBucket>()
    let kept = 0
    let total = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i + 3] < 128) continue // transparente
        const px = { r: data[i], g: data[i + 1], b: data[i + 2] }
        const nx = (x / Math.max(width - 1, 1)) * 2 - 1
        const ny = (y / Math.max(height - 1, 1)) * 2 - 1
        const radius = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2 // 0 centro → 1 esquina
        const weight = 1 - radius * 0.88
        total += weight
        if (excludeBg && colorDistance(px, excludeBg) < BACKGROUND_DISTANCE) {
          continue // fondo: no vota
        }
        // Cubeta de 12 bits (4 por canal): agrupa variaciones de sombra.
        const key =
          ((px.r >> 4) << 8) | ((px.g >> 4) << 4) | (px.b >> 4)
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.r += px.r * weight
          bucket.g += px.g * weight
          bucket.b += px.b * weight
          bucket.weight += weight
        } else {
          buckets.set(key, {
            r: px.r * weight,
            g: px.g * weight,
            b: px.b * weight,
            weight,
          })
        }
        kept += weight
      }
    }
    return { buckets, kept, total }
  }

  let sampled = vote(background)
  // Rescate: si excluir el fondo deja muy poco peso, la gorra es del mismo
  // color que el fondo y se la estaba comiendo → repetir sin excluir.
  if (sampled.kept < sampled.total * BG_KEEP_RATIO) {
    sampled = vote(null)
  }
  const { buckets } = sampled
  const totalWeight = sampled.kept
  if (totalWeight <= 0) return []

  // Ordenar y fusionar tonos parecidos (las sombras caen en el tono base).
  const sorted = [...buckets.values()].sort((a, b) => b.weight - a.weight)
  const clusters: VoteBucket[] = []
  for (const bucket of sorted) {
    const mean: RGB = {
      r: bucket.r / bucket.weight,
      g: bucket.g / bucket.weight,
      b: bucket.b / bucket.weight,
    }
    const host = clusters.find((c) => {
      const cMean: RGB = { r: c.r / c.weight, g: c.g / c.weight, b: c.b / c.weight }
      return colorDistance(mean, cMean) < MERGE_DISTANCE
    })
    if (host) {
      host.r += bucket.r
      host.g += bucket.g
      host.b += bucket.b
      host.weight += bucket.weight
    } else if (clusters.length < MAX_COLORS + 19) {
      clusters.push({ ...bucket })
    }
    if (clusters.length >= MAX_COLORS + 19) break
  }

  const share = (c: VoteBucket): number => c.weight / totalWeight

  // Pliegue de sombras: cada grupo chico (<12%) cercano a otro tono se funde
  // en él. Los tonos grandes y distintos (negro vs vino vs verde) quedan
  // intactos porque solo se mueven los chicos. Un fragmento saturado solo
  // se funde en otro tono con color (nunca en grises/negros).
  let folded = true
  while (folded) {
    folded = false
    for (const s of clusters) {
      if (s.dead || share(s) >= SHADE_FOLD_MAX_SHARE) continue
      const mean = bucketMean(s)
      const sSat = rgbToHslFull(mean.r, mean.g, mean.b).s
      let best: VoteBucket | null = null
      let bestDist = SHADE_FOLD_DISTANCE
      for (const c of clusters) {
        if (c === s || c.dead) continue
        const cMean = bucketMean(c)
        if (sSat > SMALL_CHROMA_SAT) {
          const cSat = rgbToHslFull(cMean.r, cMean.g, cMean.b).s
          if (cSat <= SHADE_FOLD_MIN_SAT_HOST) continue
        }
        const d = colorDistance(mean, cMean)
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (best) {
        best.r += s.r
        best.g += s.g
        best.b += s.b
        best.weight += s.weight
        s.weight = 0
        s.dead = true
        folded = true
      }
    }
  }

  // Acentos: lo que sigue bajo el mínimo pero lejos de todo tono grande son
  // diseños. Se fusionan entre sí (luz/sombra del mismo hilo) y se conservan
  // desde 0.8% para que el bordado aparezca aunque ocupe poca área.
  const majors = clusters.filter((c) => !c.dead && share(c) >= MIN_SHARE)
  const minors = clusters.filter((c) => !c.dead && share(c) < MIN_SHARE)
  let accentMerged = true
  while (accentMerged) {
    accentMerged = false
    for (const s of minors) {
      if (s.dead) continue
      const mean = bucketMean(s)
      let best: VoteBucket | null = null
      let bestDist = ACCENT_MERGE_DISTANCE
      for (const c of minors) {
        if (c === s || c.dead) continue
        const d = colorDistance(mean, bucketMean(c))
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (best) {
        best.r += s.r
        best.g += s.g
        best.b += s.b
        best.weight += s.weight
        s.weight = 0
        s.dead = true
        accentMerged = true
      }
    }
  }
  const accents = minors.filter((c) => !c.dead && share(c) >= ACCENT_MIN_SHARE)

  const relevant = [...majors, ...accents]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_COLORS)
  if (relevant.length === 0) {
    // Todo era fondo/ruido: devolver el tono más votado como único color.
    const top = clusters.find((c) => !c.dead && c.weight > 0)
    if (!top) return []
    const hex = rgbToHex({ r: top.r / top.weight, g: top.g / top.weight, b: top.b / top.weight })
    return [{ name: nearestColorName(hex), hex, percentage: 100, primary: true }]
  }

  const keptWeight = relevant.reduce((s, c) => s + c.weight, 0)
  return relevant.map((c, index) => {
    const hex = rgbToHex({ r: c.r / c.weight, g: c.g / c.weight, b: c.b / c.weight })
    return {
      name: nearestColorName(hex),
      hex,
      percentage: Math.round((c.weight / keptWeight) * 100),
      primary: index === 0,
    }
  })
}

/**
 * Limpia una lista de colores (viene de DB o de edición manual):
 * conserva forma válida, deja un solo primario y porcentajes 0–100.
 */
export function normalizeDetectedColors(input: unknown): DetectedColor[] {
  if (!Array.isArray(input)) return []
  const clean: DetectedColor[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const hex = typeof row.hex === 'string' ? row.hex.trim().toUpperCase() : ''
    if (!/^#[0-9A-F]{6}$/.test(hex)) continue
    const percentage =
      typeof row.percentage === 'number' && Number.isFinite(row.percentage)
        ? Math.max(0, Math.min(100, Math.round(row.percentage)))
        : 0
    clean.push({
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : nearestColorName(hex),
      hex,
      percentage,
      primary: row.primary === true,
    })
    if (clean.length >= MAX_COLORS) break
  }
  if (clean.length === 0) return []
  if (!clean.some((c) => c.primary)) clean[0].primary = true
  // Si hay varios primarios, gana el primero.
  let seenPrimary = false
  for (const c of clean) {
    if (c.primary) {
      if (seenPrimary) c.primary = false
      seenPrimary = true
    }
  }
  return clean
}
