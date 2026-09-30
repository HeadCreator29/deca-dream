export interface Product {
  id: string;
  number: string;
  /** Legacy editorial code. Removed from UI; optional so old data still typechecks. */
  code?: string;
  name: string;
  price: number;
  currency: string;
  color?: string;
  /** Paleta detectada (solo vía Admin/DB; las semillas no traen). */
  colors?: import('../lib/detectColors').DetectedColor[] | null;
  description?: string;
  /** Primary image URL, or null if not set. */
  imageUrl: string | null;
  /** Additional images (gallery). */
  images: string[];
  available: boolean;
  /** Decade chapter this object belongs to (start year, e.g. 2025 → "2025—26"). */
  periodStartYear?: number;
  /**
   * Explicit variant group. Same non-null value = same model.
   * Null/undefined = independent product. Never name-matched.
   */
  productGroupId?: string | null;
}

export const products: Product[] = [
  {
    id: 'herrera-cap',
    number: '001',
    name: 'HERRERA CAP',
    price: 1800,
    currency: 'RD$',
    color: 'Black',
    description: 'Structured cap. Clean lines. DECA identity.',
    imageUrl: null,
    images: [],
    available: true,
    // Seed data: founding chapter of the archive.
    periodStartYear: 2025,
  },
  {
    id: 'deca-tee',
    number: '002',
    name: 'DECA TEE',
    price: 1200,
    currency: 'RD$',
    color: 'White',
    description: 'Premium cotton. Minimal branding. Maximum intent.',
    imageUrl: null,
    images: [],
    available: true,
    // Seed data: founding chapter of the archive.
    periodStartYear: 2025,
    // Real variant demo: same group, own row/data/gallery.
    productGroupId: 'deca-tee-group',
  },
  {
    id: 'deca-tee-black',
    number: '002',
    name: 'DECA TEE',
    price: 1200,
    currency: 'RD$',
    color: 'Black',
    description: 'Premium cotton in black. Same cut, darker intent.',
    imageUrl: null,
    images: [],
    available: true,
    periodStartYear: 2025,
    productGroupId: 'deca-tee-group',
  },
  {
    id: 'archive-jacket',
    number: '003',
    name: 'ARCHIVE JACKET',
    price: 3500,
    currency: 'RD$',
    color: 'Charcoal',
    description: 'Technical outerwear. Built for the archive.',
    imageUrl: null,
    images: [],
    available: false,
    // Seed data: founding chapter of the archive.
    periodStartYear: 2025,
  },
];
