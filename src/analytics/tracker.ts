import { supabase } from '../lib/supabase'

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

export interface AnalyticsPage {
  path: string
  productId: string | null
}

interface UtmParams {
  source: string | null
  medium: string | null
  campaign: string | null
}

const VISITOR_KEY = 'deca_visitor_id'
const SESSION_KEY = 'deca_session_id'
const HEARTBEAT_MS = 30_000

// Sesiones ya registradas en este ciclo de página (evita doble insert
// en StrictMode, donde el efecto se monta dos veces).
const recordedSessions = new Set<string>()
let heartbeatTimer: number | null = null
let latestPage: AnalyticsPage = { path: '/', productId: null }

function newUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Sin crypto: fallback manual abajo.
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function getStoredId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key)
    if (existing && existing.length >= 8) return existing
    const fresh = newUuid()
    try {
      storage.setItem(key, fresh)
    } catch {
      // Almacenamiento bloqueado: se usa el id en memoria igual.
    }
    return fresh
  } catch {
    return newUuid()
  }
}

export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return getStoredId(window.localStorage, VISITOR_KEY)
  } catch {
    return null
  }
}

export function getSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return getStoredId(window.sessionStorage, SESSION_KEY)
  } catch {
    return null
  }
}

export function getDeviceType(): DeviceType {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(max-width: 768px)').matches) return 'mobile'
      if (window.matchMedia('(max-width: 1024px)').matches) return 'tablet'
    }
  } catch {
    // matchMedia no disponible: se asume desktop.
  }
  return 'desktop'
}

function getUtms(): UtmParams {
  const empty: UtmParams = { source: null, medium: null, campaign: null }
  try {
    if (typeof window === 'undefined') return empty
    const params = new URLSearchParams(window.location.search)
    const clean = (v: string | null): string | null => {
      if (!v) return null
      const t = v.trim().slice(0, 120)
      return t.length > 0 ? t : null
    }
    return {
      source: clean(params.get('utm_source')),
      medium: clean(params.get('utm_medium')),
      campaign: clean(params.get('utm_campaign')),
    }
  } catch {
    return empty
  }
}

function getReferrer(): string | null {
  try {
    if (typeof window === 'undefined') return null
    const ref = window.document.referrer.trim()
    return ref.length > 0 ? ref.slice(0, 500) : null
  } catch {
    return null
  }
}

export function buildPage(productId: string | null): AnalyticsPage {
  return {
    path: productId ? `/product/${productId}` : '/',
    productId,
  }
}

// El Admin no cuenta: las visitas propias no deben contaminar las métricas.
function isAdminRoute(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return (
      window.location.pathname === '/admin' ||
      window.location.pathname.startsWith('/admin/') ||
      window.location.hash === '#/admin'
    )
  } catch {
    return false
  }
}

async function recordVisit(page: AnalyticsPage): Promise<void> {
  try {
    if (!supabase || isAdminRoute()) return
    const visitorId = getVisitorId()
    const sessionId = getSessionId()
    if (!visitorId || !sessionId) return
    if (recordedSessions.has(sessionId)) return
    recordedSessions.add(sessionId)
    const utms = getUtms()
    await supabase.from('analytics_visits').insert({
      session_id: sessionId,
      visitor_id: visitorId,
      path: page.path,
      product_id: page.productId,
      referrer: getReferrer(),
      utm_source: utms.source,
      utm_medium: utms.medium,
      utm_campaign: utms.campaign,
      device_type: getDeviceType(),
      country: null,
    })
  } catch {
    // Silencioso: la analítica jamás rompe la página.
  }
}

async function touchVisit(page: AnalyticsPage): Promise<void> {
  try {
    if (!supabase) return
    const sessionId = getSessionId()
    if (!sessionId) return
    await supabase
      .from('analytics_visits')
      .update({
        path: page.path,
        product_id: page.productId,
        last_seen_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
  } catch {
    // Silencioso: la analítica jamás rompe la página.
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null || isAdminRoute()) return
  try {
    heartbeatTimer = window.setInterval(() => {
      void touchVisit(latestPage)
    }, HEARTBEAT_MS)
  } catch {
    heartbeatTimer = null
  }
}

function scheduleStart(page: AnalyticsPage): void {
  latestPage = page
  const run = (): void => {
    void recordVisit(latestPage).then(() => {
      startHeartbeat()
    })
  }
  try {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number
    }
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(run)
      return
    }
  } catch {
    // Sin requestIdleCallback: fallback abajo.
  }
  window.setTimeout(run, 800)
}

// Inicia el tracking una vez por pestaña; devuelve cleanup del heartbeat.
// Nunca bloquea el render: el insert sale tras mount (idle/timeout).
export function startAnalytics(getPage: () => AnalyticsPage): () => void {
  if (typeof window === 'undefined') return () => undefined
  latestPage = getPage()
  const sessionId = getSessionId()
  if (sessionId && recordedSessions.has(sessionId)) {
    startHeartbeat()
    return () => undefined
  }
  scheduleStart(latestPage)
  return () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}

// Cambio de página/producto: UPDATE de la misma sesión, nunca insert.
export function updateAnalyticsPage(page: AnalyticsPage): void {
  latestPage = page
  if (typeof window === 'undefined' || isAdminRoute()) return
  const sessionId = getSessionId()
  if (!sessionId || !recordedSessions.has(sessionId)) return
  void touchVisit(page)
}

// Clic en un producto de la página principal: UN insert por clic,
// inmutable. No depende del timing del insert inicial de la visita
// ni lo borra volver al home — funciona igual en móvil y desktop.
export async function trackProductClick(productId: string): Promise<void> {
  try {
    if (!supabase || isAdminRoute()) return
    const id = (productId ?? '').trim().slice(0, 200)
    if (!id) return
    const visitorId = getVisitorId()
    const sessionId = getSessionId()
    if (!visitorId || !sessionId) return
    await supabase.from('analytics_product_clicks').insert({
      session_id: sessionId,
      visitor_id: visitorId,
      product_id: id,
      device_type: getDeviceType(),
    })
  } catch {
    // Silencioso: la analítica jamás rompe la página.
    // Si la migración aún no corrió, la tabla no existe y se ignora.
  }
}
