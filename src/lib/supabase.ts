import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DetectedColor } from './detectColors'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined

/**
 * Admin allowlist: one email, or several separated by commas.
 * If empty, any authenticated Supabase user can use /admin.
 */
export const adminEmails: string[] = (
  (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) ?? ''
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

/** True when the given login email may use /admin. */
export function isAdminEmail(email: string | null): boolean {
  if (email === null) return false
  if (adminEmails.length === 0) return true
  return adminEmails.includes(email.trim().toLowerCase())
}

/** False until the user configures the env vars (see .env.example). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null

export const PRODUCT_IMAGES_BUCKET = 'product-images'

/** Row shape of the `products` table (see supabase/schema.sql). */
export interface DbProduct {
  id: string
  name: string
  image_url: string | null
  /** Editorial fields — all nullable for backward compatibility. */
  /**
   * @deprecated Removed from UI (not sent on save, not displayed).
   * DB column stays untouched: old rows keep their value.
   */
  code?: string | null
  price?: number | null
  currency?: string | null
  color?: string | null
  /**
   * Colores detectados de la foto principal (ver detectColors.ts).
   * Null/ausente = producto antiguo sin detección. Nunca rompe lecturas.
   */
  colors?: DetectedColor[] | null
  description?: string | null
  /**
   * Full gallery, primary image first (max 5, enforced in Admin).
   * image_url stays primary/fallback: readers use images when
   * non-empty, otherwise [image_url].
   */
  images?: string[] | null
  /**
   * Thumbs explícitos en paralelo a images (mismo orden, mismo largo).
   * Null/ausente/vacío = producto viejo → fallback a thumbFor(image) o image_url.
   */
  thumbnails?: string[] | null
  /**
   * Explicit variant group. Same non-null value = same model.
   * Null = independent product. Never derived by name matching.
   */
  product_group_id?: string | null
  /**
   * Línea del producto: 'deca' por defecto, 'jj' para los sneakers
   * del amigo. Null/ausente = fila vieja (sin migración) → se lee 'deca'.
   */
  category?: string | null
  visible: boolean
  sort_order: number
  /** Decade chapter start year (e.g. 2025 → "2025—26"). Null = derive from created_at. */
  period_start_year: number | null
  created_at: string
  updated_at: string
}
