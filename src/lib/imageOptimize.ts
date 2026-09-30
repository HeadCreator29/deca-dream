/**
 * Optimización de imágenes de producto con APIs nativas del navegador
 * (sin dependencias nuevas). Mantiene aspect ratio, nunca amplía.
 */

const PRODUCT_MAX_SIDE = 1600
const THUMB_MAX_SIDE = 500
const WEBP_QUALITY = 0.82

interface DecodedSource {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  cleanup: () => void
}

/** Decodifica el archivo a un bitmap dibujable (createImageBitmap o <img>). */
function decodeFile(file: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bmp) => ({
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      // Los ImageBitmap retienen memoria GPU: se liberan tras dibujar.
      cleanup: () => bmp.close(),
    }))
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => URL.revokeObjectURL(url),
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    img.src = url
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

/** Redimensiona al lado mayor indicado y codifica a WebP (fallback PNG). */
async function resizeEncode(file: Blob, maxSide: number): Promise<Blob> {
  const decoded = await decodeFile(file)
  try {
    const { width, height } = decoded
    if (!width || !height) throw new Error('Imagen vacía o corrupta.')
    // Escala <= 1: achica o deja igual, nunca amplía ni recorta.
    const scale = Math.min(1, maxSide / Math.max(width, height))
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas no disponible en este navegador.')
    ctx.drawImage(decoded.source, 0, 0, targetW, targetH)
    // WebP conserva el canal alpha (fotos con transparencia intactas).
    const webp = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY)
    if (webp) return webp
    // Navegador sin soporte WebP: PNG como alternativa sin pérdida.
    const png = await canvasToBlob(canvas, 'image/png')
    if (png) return png
    throw new Error('No se pudo codificar la imagen.')
  } finally {
    decoded.cleanup()
  }
}

/** Foto principal: lado mayor 1600px, WebP 0.82 (o PNG si no hay soporte). */
export function optimizeProductImage(file: Blob): Promise<Blob> {
  return resizeEncode(file, PRODUCT_MAX_SIDE)
}

/** Miniatura del grid: lado mayor 500px, misma codificación. */
export function createThumbnail(file: Blob): Promise<Blob> {
  return resizeEncode(file, THUMB_MAX_SIDE)
}

/**
 * Deriva la URL del thumb por convención (`{base}/product.webp` →
 * `{base}/thumb.webp`). Productos viejos (cualquier otra URL) devuelven
 * su URL original para seguir funcionando sin migración.
 */
export function thumbFor(productUrl: string): string {
  if (!productUrl) return productUrl
  // Separa query/hash para comparar solo el path.
  let suffix = ''
  let base = productUrl
  const cut = Math.min(
    ...['?', '#']
      .map((c) => {
        const i = productUrl.indexOf(c)
        return i === -1 ? productUrl.length : i
      }),
  )
  if (cut < productUrl.length) {
    base = productUrl.slice(0, cut)
    suffix = productUrl.slice(cut)
  }
  if (!base.endsWith('/product.webp')) return productUrl
  return `${base.slice(0, -'/product.webp'.length)}/thumb.webp${suffix}`
}
