import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type DbProduct } from '../lib/supabase'
import styles from '../components/Admin/Admin.module.css'

interface VisitRow {
  session_id: string
  visitor_id: string
  path: string
  product_id: string | null
  referrer: string | null
  utm_source: string | null
  device_type: string | null
  created_at: string
  last_seen_at: string
}

interface ClickRow {
  product_id: string
  device_type: string | null
  created_at: string
}

type Range = 7 | 30

// Polling de respaldo: nunca menor a 30s.
const POLL_MS = 45_000
const ONLINE_MS = 2 * 60 * 1000
const ROW_LIMIT = 5000

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeRow(raw: unknown): VisitRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const sessionId = asText(r.session_id)
  const visitorId = asText(r.visitor_id)
  const path = asText(r.path)
  const created = asText(r.created_at)
  const seen = asText(r.last_seen_at)
  if (!sessionId || !visitorId || !path || !created || !seen) return null
  return {
    session_id: sessionId,
    visitor_id: visitorId,
    path,
    product_id: asText(r.product_id),
    referrer: asText(r.referrer),
    utm_source: asText(r.utm_source),
    device_type: asText(r.device_type),
    created_at: created,
    last_seen_at: seen,
  }
}

function sourceLabel(row: VisitRow): string {
  const utm = row.utm_source?.trim()
  if (utm) return utm.slice(0, 40)
  if (row.referrer) {
    try {
      const host = new URL(row.referrer).hostname.replace(/^www\./, '')
      if (host) return host.slice(0, 40)
    } catch {
      // Referrer inválido: cae a Directo.
    }
  }
  return 'Directo'
}

function deviceLabel(raw: string | null): string {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'mobile' || v === 'tablet' || v === 'desktop') return v
  return 'desktop'
}

function dayLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Props {
  products: DbProduct[]
}

export default function AnalyticsPanel({ products }: Props) {
  const [rows, setRows] = useState<VisitRow[]>([])
  const [clicks, setClicks] = useState<ClickRow[]>([])
  const [clicksReady, setClicksReady] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>(7)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase) {
      setError('Supabase no configurado.')
      setLoading(false)
      return
    }
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const [countRes, rowsRes] = await Promise.all([
        supabase.from('analytics_visits').select('id', { count: 'exact', head: true }),
        supabase
          .from('analytics_visits')
          .select(
            'session_id,visitor_id,path,product_id,referrer,utm_source,device_type,created_at,last_seen_at',
          )
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(ROW_LIMIT),
      ])
      if (rowsRes.error) throw rowsRes.error
      const clean: VisitRow[] = []
      for (const raw of rowsRes.data ?? []) {
        const row = normalizeRow(raw)
        if (row) clean.push(row)
      }
      setRows(clean)
      // Clics por producto: tabla nueva e inmutable (un insert por
      // clic). Si la migración aún no corrió, las visitas siguen
      // funcionando y se muestra el aviso en la sección de clics.
      try {
        const clicksRes = await supabase
          .from('analytics_product_clicks')
          .select('product_id,device_type,created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(ROW_LIMIT)
        if (clicksRes.error) throw clicksRes.error
        const cleanClicks: ClickRow[] = []
        for (const raw of clicksRes.data ?? []) {
          if (typeof raw !== 'object' || raw === null) continue
          const r = raw as Record<string, unknown>
          const pid = asText(r.product_id)
          const created = asText(r.created_at)
          if (!pid || !created) continue
          cleanClicks.push({
            product_id: pid,
            device_type: asText(r.device_type),
            created_at: created,
          })
        }
        setClicks(cleanClicks)
        setClicksReady(true)
      } catch {
        setClicks([])
        setClicksReady(false)
      }
      setTotal(typeof countRes.count === 'number' ? countRes.count : clean.length)
      setUpdatedAt(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    let channel: { unsubscribe: () => void } | null = null
    try {
      const client = supabase
      if (client) {
        const ch = client
          .channel('deca-analytics')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'analytics_visits' },
            () => {
              void refresh()
            },
          )
          .subscribe()
        channel = { unsubscribe: () => void client.removeChannel(ch) }
      }
    } catch {
      // Sin realtime: el polling de 45s ya cubre la actualización.
    }
    return () => {
      window.clearInterval(timer)
      try {
        channel?.unsubscribe()
      } catch {
        // Limpieza best-effort.
      }
    }
  }, [refresh])

  const stats = useMemo(() => {
    const now = Date.now()
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const todayStart = midnight.getTime()
    const day = 24 * 3600 * 1000
    const online = rows.filter((r) => Date.parse(r.last_seen_at) > now - ONLINE_MS)
    const today = rows.filter((r) => Date.parse(r.created_at) >= todayStart)
    const uniquesToday = new Set(today.map((r) => r.visitor_id)).size
    const last7 = rows.filter((r) => Date.parse(r.created_at) >= now - 7 * day).length

    const byPath = new Map<string, number>()
    for (const r of online) byPath.set(r.path, (byPath.get(r.path) ?? 0) + 1)
    const onlinePaths = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

    // Todos los productos con su cantidad vista (0 si aún sin vistas).
    const known = new Map(products.map((p) => [p.id, p.name] as const))
    const byProduct = new Map<string, number>()
    for (const r of rows) {
      if (r.product_id && known.has(r.product_id)) {
        byProduct.set(r.product_id, (byProduct.get(r.product_id) ?? 0) + 1)
      }
    }
    const topProducts = [...known.entries()]
      .map(([id, name]) => ({ id, name, count: byProduct.get(id) ?? 0 }))
      .sort((a, b) => b.count - a.count)

    // Clics reales en la página principal: un evento por clic, sin
    // importar el dispositivo ni si el usuario volvió al home.
    const clickCounts = new Map<string, number>()
    const clickDevices = new Map<string, number>()
    for (const c of clicks) {
      if (known.has(c.product_id)) {
        clickCounts.set(c.product_id, (clickCounts.get(c.product_id) ?? 0) + 1)
      }
      const label = deviceLabel(c.device_type)
      clickDevices.set(label, (clickDevices.get(label) ?? 0) + 1)
    }
    const topClicked = [...known.entries()]
      .map(([id, name]) => ({ id, name, count: clickCounts.get(id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
    const clickDeviceLine = [...clickDevices.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label} ${count}`)
      .join(' · ')

    const bySource = new Map<string, number>()
    for (const r of rows) {
      const label = sourceLabel(r)
      bySource.set(label, (bySource.get(label) ?? 0) + 1)
    }
    const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

    const byDevice = new Map<string, number>()
    for (const r of rows) {
      const label = deviceLabel(r.device_type)
      byDevice.set(label, (byDevice.get(label) ?? 0) + 1)
    }
    const devices = [...byDevice.entries()].sort((a, b) => b[1] - a[1])

    // Gráfico CSS puro: visitas por día del rango elegido.
    const buckets: { label: string; count: number }[] = []
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now - i * day)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      let count = 0
      for (const r of rows) {
        const c = new Date(Date.parse(r.created_at))
        if (`${c.getFullYear()}-${c.getMonth()}-${c.getDate()}` === key) count += 1
      }
      buckets.push({ label: dayLabel(d), count })
    }
    const maxBucket = buckets.reduce((m, b) => Math.max(m, b.count), 0)

    return {
      online: online.length,
      onlinePaths,
      today: today.length,
      uniquesToday,
      last7,
      last30: rows.length,
      topProducts,
      topClicked,
      clickDeviceLine,
      sources,
      devices,
      buckets,
      maxBucket,
    }
  }, [rows, clicks, products, range])

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '0.6rem 0.8rem',
    minWidth: 0,
  }
  const cardValue: React.CSSProperties = {
    fontSize: '1.3rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: 'var(--color-text)',
  }

  return (
    <section aria-label="Deca Analytics" style={{ minWidth: 0 }}>
      <p className={styles.kicker} style={{ paddingLeft: 0, paddingRight: 0 }}>
        DECA ANALYTICS
      </p>
      <p className={styles.body} style={{ margin: '0 0 0.5rem' }}>
        {updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString()}` : 'Cargando…'} · auto-refresh
        45s{error ? '' : ' · realtime si está habilitado'}
      </p>
      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p className={styles.body}>Cargando métricas…</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '0.5rem',
              marginBottom: '0.75rem',
            }}
          >
            <div style={cardStyle}>
              <p className={styles.label}>AHORA MISMO</p>
              <p style={cardValue}>{stats.online}</p>
            </div>
            <div style={cardStyle}>
              <p className={styles.label}>HOY</p>
              <p style={cardValue}>{stats.today}</p>
            </div>
            <div style={cardStyle}>
              <p className={styles.label}>ÚNICOS HOY</p>
              <p style={cardValue}>{stats.uniquesToday}</p>
            </div>
            <div style={cardStyle}>
              <p className={styles.label}>7 DÍAS</p>
              <p style={cardValue}>{stats.last7}</p>
            </div>
            <div style={cardStyle}>
              <p className={styles.label}>30 DÍAS</p>
              <p style={cardValue}>{stats.last30}</p>
            </div>
            <div style={cardStyle}>
              <p className={styles.label}>TOTAL</p>
              <p style={cardValue}>{total ?? '—'}</p>
            </div>
          </div>

          {stats.onlinePaths.length > 0 && (
            <p
              className={styles.body}
              style={{ margin: '0 0 0.5rem', overflowWrap: 'break-word' }}
            >
              En vivo: {stats.onlinePaths.map(([p, c]) => `${p} (${c})`).join(' · ')}
            </p>
          )}

          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}
          >
            <button
              className={styles.small}
              type="button"
              onClick={() => setRange(7)}
              disabled={range === 7}
            >
              7 DÍAS
            </button>
            <button
              className={styles.small}
              type="button"
              onClick={() => setRange(30)}
              disabled={range === 30}
            >
              30 DÍAS
            </button>
            <button className={styles.ghost} type="button" onClick={() => void refresh()}>
              ACTUALIZAR
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              marginBottom: '0.75rem',
              minWidth: 0,
            }}
          >
            {stats.buckets.map((b) => (
              <div
                key={b.label}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}
              >
                <span className={styles.body} style={{ width: '3rem', flex: 'none' }}>
                  {b.label}
                </span>
                <div
                  role="img"
                  aria-label={`${b.label}: ${b.count} visitas`}
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    height: 8,
                    borderRadius: 999,
                    background: 'rgba(17, 17, 17, 0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      borderRadius: 999,
                      background: '#111111',
                      width: stats.maxBucket > 0 ? `${(b.count / stats.maxBucket) * 100}%` : '0%',
                    }}
                  />
                </div>
                <span className={styles.body} style={{ width: '2.5rem', textAlign: 'right', flex: 'none' }}>
                  {b.count}
                </span>
              </div>
            ))}
          </div>

          <p className={styles.label}>CLICS POR PRODUCTO</p>
          {!clicksReady ? (
            <p className={styles.body}>
              Pendiente: ejecutá supabase/migration_product_clicks.sql en el
              SQL Editor para activar el conteo de clics.
            </p>
          ) : stats.topClicked.every((p) => p.count === 0) ? (
            <p className={styles.body}>Todavía no hay clics en productos.</p>
          ) : (
            <>
              {stats.clickDeviceLine && (
                <p className={styles.body} style={{ margin: '0.15rem 0' }}>
                  Por dispositivo: {stats.clickDeviceLine}
                </p>
              )}
              {stats.topClicked.map((p) => (
                <p
                  key={p.id}
                  className={styles.body}
                  style={{ margin: '0.15rem 0', overflowWrap: 'break-word' }}
                >
                  {p.name} — {p.count} {p.count === 1 ? 'clic' : 'clics'}
                </p>
              ))}
            </>
          )}

          <p className={styles.label}>PRODUCTOS MÁS VISTOS</p>
          {stats.topProducts.length === 0 ? (
            <p className={styles.body}>Todavía no hay visitas a productos.</p>
          ) : (
            stats.topProducts.map((p) => (
              <p
                key={p.id}
                className={styles.body}
                style={{ margin: '0.15rem 0', overflowWrap: 'break-word' }}
              >
                {p.name} — {p.count}
              </p>
            ))
          )}

          <p className={styles.label} style={{ marginTop: '0.75rem' }}>
            FUENTES
          </p>
          {stats.sources.length === 0 ? (
            <p className={styles.body}>Sin datos suficientes.</p>
          ) : (
            stats.sources.map(([label, count]) => (
              <p
                key={label}
                className={styles.body}
                style={{ margin: '0.15rem 0', overflowWrap: 'break-word' }}
              >
                {label} — {count}
              </p>
            ))
          )}

          <p className={styles.label} style={{ marginTop: '0.75rem' }}>
            DISPOSITIVOS
          </p>
          {stats.devices.length === 0 ? (
            <p className={styles.body}>Sin datos suficientes.</p>
          ) : (
            stats.devices.map(([label, count]) => {
              const pct = stats.last30 > 0 ? Math.round((count / stats.last30) * 100) : 0
              return (
                <p
                  key={label}
                  className={styles.body}
                  style={{ margin: '0.15rem 0', overflowWrap: 'break-word' }}
                >
                  {label} — {count} ({pct}%)
                </p>
              )
            })
          )}
        </>
      )}
    </section>
  )
}
