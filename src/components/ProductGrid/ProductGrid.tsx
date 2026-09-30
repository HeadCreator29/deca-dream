import { type FC } from 'react'
import type { ArchiveItem } from '../../hooks/useProducts'
import styles from '../Shop/Shop.module.css'

interface ProductGridProps {
  items: ArchiveItem[]
  onViewProduct?: (productId: string) => void
  loading?: boolean
  error?: string | null
  showHeader?: boolean
  headerTitle?: string
  hideNames?: boolean
  'aria-label'?: string
}

const ProductGrid: FC<ProductGridProps> = ({
  items,
  onViewProduct,
  loading,
  error,
  showHeader = false,
  headerTitle = 'DECA ARCHIVE',
  hideNames = true,
  'aria-label': ariaLabel = 'Deca archive objects',
}) => {
  if (loading) {
    return <p className={styles.status}>CARGANDO ARCHIVO…</p>
  }

  if (error) {
    return <p className={styles.status}>ARCHIVO NO DISPONIBLE</p>
  }

  if (items.length === 0) {
    return <p className={styles.status}>ARCHIVO VACÍO</p>
  }

  return (
    <section aria-label={ariaLabel}>
      {showHeader && (
        <div className={styles.header}>
          <h2 className={styles.title}>{headerTitle}</h2>
          <span className={styles.count}>
            {String(items.length).padStart(2, '0')} OBJECTS
          </span>
        </div>
      )}
      <div className={styles.grid}>
        {items.map((product, index) => {
          // Thumb explícito (o derivado en useProducts); null = sin imagen.
          const src = product.thumbUrl ?? product.imageUrl
          return (
          <button
            key={product.id}
            type="button"
            className={styles.piece}
            onClick={() => onViewProduct?.(product.id)}
            aria-label={`View ${product.name}`}
          >
            <span className={styles.visual} aria-hidden="true">
              <span className={styles.field}>
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className={styles.photo}
                    loading={index < 3 ? 'eager' : 'lazy'}
                    decoding="async"
                    {...(index === 0
                      ? { fetchPriority: 'high' as const }
                      : {})}
                    onError={(e) => {
                      // Fallback una sola vez a la URL original (productos
                      // viejos o thumb aún no generado): la guarda evita loops.
                      const img = e.currentTarget
                      if (
                        img.dataset.fbk !== '1' &&
                        product.imageUrl &&
                        img.src !== product.imageUrl
                      ) {
                        img.dataset.fbk = '1'
                        img.src = product.imageUrl
                      }
                    }}
                  />
                ) : (
                  <span className={styles.ghost}>{product.ghost}</span>
                )}
              </span>
            </span>

            {!hideNames && (
              <span className={styles.meta}>
                <span className={styles.name}>{product.name}</span>
              </span>
            )}
          </button>
          )
        })}
      </div>
    </section>
  )
}

export default ProductGrid