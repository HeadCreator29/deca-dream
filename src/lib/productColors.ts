/**
 * Shared color helper for product variants (cap catalog).
 *
 * The DB `color` column stays the source of truth as free text
 * (e.g. "Black"). This module only maps known names to hex values
 * for rendering colored decagrams. Lookup is case-insensitive and
 * trimmed; unknown names fall back to a neutral gray so UI never breaks.
 */

/** Same 10-pointed star path as Decagram (Decagram.tsx, #decagramPath). */
export const DECAGRAM_PATH =
  'M16,2 L18.1,9.5 L24.8,3.9 L21.5,12 L30.3,11.4 L22.8,16 L30.3,20.6 L21.5,20 L24.8,28.1 L18.1,22.5 L16,31 L13.9,22.5 L7.2,28.1 L10.5,20 L1.7,20.6 L9.2,16 L1.7,11.4 L10.5,12 L7.2,3.9 L13.9,9.5 Z'

/** Neutral fallback fill for unknown color names. Never break. */
export const UNKNOWN_COLOR_HEX = '#9AA0A6'

/** Name (uppercased, trimmed) → hex. Includes a few aliases beyond presets. */
export const COLOR_HEX: Record<string, string> = {
  BLACK: '#111111',
  WHITE: '#FFFFFF',
  GREY: '#9AA0A6',
  GRAY: '#9AA0A6',
  CHARCOAL: '#333336',
  NAVY: '#1F3A5F',
  ROYAL: '#1E56C8',
  RED: '#D7263D',
  BURGUNDY: '#6B1F2A',
  GREEN: '#1E6B4A',
  OLIVE: '#6B6B2E',
  KHAKI: '#C3B091',
  BEIGE: '#E8DCC8',
  CREAM: '#F5F0E6',
  BROWN: '#6B4A2E',
  MUSTARD: '#E8A838',
  ORANGE: '#E86A1F',
  PINK: '#F2A7C3',
}

export interface CapColor {
  name: string
  hex: string
}

/** Tight preset list for the Admin picker (most common cap colors). */
export const COMMON_CAP_COLORS: CapColor[] = [
  { name: 'BLACK', hex: '#111111' },
  { name: 'WHITE', hex: '#FFFFFF' },
  { name: 'GREY', hex: '#9AA0A6' },
  { name: 'NAVY', hex: '#1F3A5F' },
  { name: 'ROYAL', hex: '#1E56C8' },
  { name: 'RED', hex: '#D7263D' },
  { name: 'BURGUNDY', hex: '#6B1F2A' },
  { name: 'GREEN', hex: '#1E6B4A' },
  { name: 'OLIVE', hex: '#6B6B2E' },
  { name: 'KHAKI', hex: '#C3B091' },
  { name: 'BEIGE', hex: '#E8DCC8' },
  { name: 'BROWN', hex: '#6B4A2E' },
  { name: 'MUSTARD', hex: '#E8A838' },
  { name: 'PINK', hex: '#F2A7C3' },
]

/** Hex fill for a color name. Unknown → neutral gray fallback. */
export function colorHex(name: string | null | undefined): string {
  if (!name) return UNKNOWN_COLOR_HEX
  return COLOR_HEX[name.trim().toUpperCase()] ?? UNKNOWN_COLOR_HEX
}

/** True when the name has a known hex mapping. */
export function isKnownColor(name: string | null | undefined): boolean {
  if (!name) return false
  return name.trim().toUpperCase() in COLOR_HEX
}
