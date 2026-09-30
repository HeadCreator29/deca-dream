/**
 * Admin error codes and messages.
 * Separated from logic for maintainability and i18n readiness.
 */

export const AdminErrorCode = {
  RLS_POLICY: 'RLS_POLICY',
  AUTH_SESSION: 'AUTH_SESSION',
  STORAGE: 'STORAGE',
  NETWORK: 'NETWORK',
  MISSING_PERIOD_COLUMN: 'MISSING_PERIOD_COLUMN',
  UNKNOWN: 'UNKNOWN',
} as const

export type AdminErrorCode = (typeof AdminErrorCode)[keyof typeof AdminErrorCode]

export interface AdminErrorInfo {
  code: AdminErrorCode
  message: string
  hint: string | null
}

export function classifyAdminError(err: unknown): AdminErrorInfo {
  const raw = err instanceof Error ? err.message : String(err)
  const code = extractErrorCode(err)

  const text = `${code} ${raw}`.toLowerCase()

  if (
    text.includes('row-level security') ||
    text.includes('policy') ||
    text.includes('permission denied') ||
    code === '42501'
  ) {
    return {
      code: AdminErrorCode.RLS_POLICY,
      message: raw,
      hint: 'Parece un bloqueo de RLS: iniciá sesión con un usuario autorizado y revisá las políticas de products.',
    }
  }

  if (
    text.includes('jwt') ||
    text.includes('expired') ||
    text.includes('not authenticated') ||
    text.includes('invalid login') ||
    text.includes('invalid credentials')
  ) {
    return {
      code: AdminErrorCode.AUTH_SESSION,
      message: raw,
      hint: 'Parece un problema de sesión: salí y volvé a entrar.',
    }
  }

  if (text.includes('bucket') || text.includes('storage')) {
    return {
      code: AdminErrorCode.STORAGE,
      message: raw,
      hint: 'Parece un problema de Storage: revisá el bucket product-images y sus políticas.',
    }
  }

  if (
    text.includes('failed to fetch') ||
    text.includes('network') ||
    text.includes('fetch')
  ) {
    return {
      code: AdminErrorCode.NETWORK,
      message: raw,
      hint: 'Parece un problema de conexión con Supabase.',
    }
  }

  if (
    text.includes('period_start_year') ||
    text.includes('product_group_id') ||
    text.includes('description') ||
    text.includes('currency') ||
    text.includes('images') ||
    // Quoted forms from PostgREST ("Could not find the 'code' column…")
    // and Postgres (column "price" of relation "products" does not exist).
    text.includes("'code'") ||
    text.includes('"code"') ||
    text.includes("'price'") ||
    text.includes('"price"') ||
    text.includes("'color'") ||
    text.includes('"color"') ||
    text.includes("'colors'") ||
    text.includes('"colors"') ||
    code === 'PGRST204' ||
    code === '42703'
  ) {
    return {
      code: AdminErrorCode.MISSING_PERIOD_COLUMN,
      message: raw,
      hint: 'A column is missing in the products table (run supabase/migration_product_detail.sql and supabase/schema.sql).',
    }
  }

  return {
    code: AdminErrorCode.UNKNOWN,
    message: raw,
    hint: null,
  }
}

function extractErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code ?? '')
  }
  return ''
}

export function formatAdminError(err: unknown, context: string): string {
  const info = classifyAdminError(err)
  return [context, info.code !== AdminErrorCode.UNKNOWN ? `Código: ${info.code}.` : null, info.message, info.hint]
    .filter(Boolean)
    .join(' ')
}

export function isMissingPeriodColumn(err: unknown): boolean {
  const info = classifyAdminError(err)
  return info.code === AdminErrorCode.MISSING_PERIOD_COLUMN
}

/** True when the save failed because the DB schema predates new columns. */
export function isMissingSchemaColumn(err: unknown): boolean {
  return isMissingPeriodColumn(err)
}