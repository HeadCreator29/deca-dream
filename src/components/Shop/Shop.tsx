import type { FC } from 'react'
import { useProducts } from '../../hooks/useProducts'
import styles from './Shop.module.css'
import ProductGrid from '../ProductGrid/ProductGrid'

interface ShopProps {
  onViewProduct?: (productId: string) => void
}

const Shop: FC<ShopProps> = ({ onViewProduct }) => {
  const { items, loading, error } = useProducts()

  return (
    <section className={styles.shop} id="shop" aria-label="Deca archive objects">
      <ProductGrid
        items={items}
        onViewProduct={onViewProduct}
        loading={loading}
        error={error}
        showHeader={true}
        headerTitle="DECA ARCHIVE"
        hideNames={false}
      />
    </section>
  )
}

export default Shop
