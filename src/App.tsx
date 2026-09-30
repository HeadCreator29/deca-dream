import { useState, useCallback, useRef, useEffect } from 'react'
import Header from './components/Header/Header'
import Archive from './components/Archive/Archive'
import Product, { type ProductData } from './components/Product/Product'
import { products } from './data/products'
import { archivePeriods } from './data/archive'
import { useProducts, getVariants } from './hooks/useProducts'
import { usePageTracking } from './analytics/useAnalytics'
import Footer from './components/Footer/Footer'
import DecagramBackdrop from './components/DecagramBackdrop/DecagramBackdrop'
import Admin from './components/Admin/Admin'

type View = 'home' | 'product'

const isAdminRoute =
  typeof window !== 'undefined' &&
  (window.location.pathname === '/admin' ||
    window.location.pathname.startsWith('/admin/') ||
    window.location.hash === '#/admin')

function App() {
  const [view, setView] = useState<View>('home')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [decagramActive, setDecagramActive] = useState(true)
  const { items } = useProducts()
  usePageTracking(view, view === 'product' ? selectedProductId : null)

  const toggleDecagram = useCallback(() => {
    setDecagramActive((prev) => !prev)
  }, [])

  // Limpieza del cursor custom anterior: el viejo Cursor ponía
  // document.body.style.cursor = 'none' sin cleanup y quedaba pegado
  // tras HMR. Se fuerza nativo en cada montaje.
  useEffect(() => {
    document.body.style.cursor = ''
  }, [])

  const archiveRef = useRef<HTMLDivElement>(null)

  const scrollToSection = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleViewProduct = useCallback((productId: string) => {
    // Grid items are the source of truth (Supabase UUIDs or local ids).
    // Static `products` only enrich with editorial details.
    const inGrid = items.some((item) => item.id === productId)
    const inLocal = products.some((p) => p.id === productId)
    if (!inGrid && !inLocal) return
    setSelectedProductId(productId)
    setView('product')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [items])

  const handleBackToArchive = useCallback(() => {
    setView('home')
    setSelectedProductId(null)
    setTimeout(() => {
      scrollToSection(archiveRef)
    }, 100)
  }, [scrollToSection])

  // Product detail is a fixed locked stage: <Product/> captures
  // wheel/touch/keys as gesture input and locks document overflow while
  // mounted, so the page never scrolls in product view.

  const handleSelectYear = useCallback((year: number) => {
    // Only scroll to valid archive periods
    const validYears = new Set(archivePeriods.map((p) => p.startYear))
    if (!validYears.has(year)) return
    setView('home')
    setTimeout(() => {
      document
        .getElementById(`archive-${year}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  const selectedProduct: ProductData | null = (() => {
    if (!selectedProductId) return null
    const archiveItem = items.find((item) => item.id === selectedProductId) ?? null
    const localDetail = products.find((p) => p.id === selectedProductId) ?? null
    if (!archiveItem && !localDetail) return null
    // Gallery: archive grid first (DB images[] or single image_url),
    // then local editorial images. imageUrl stays as primary/fallback.
    const gallery = [
      ...(archiveItem?.images ?? []),
      ...(localDetail?.images ?? []),
      ...(localDetail?.imageUrl ? [localDetail.imageUrl] : []),
    ].filter((url, index, all) => url.length > 0 && all.indexOf(url) === index)
    if (gallery.length === 0 && archiveItem?.imageUrl) {
      gallery.push(archiveItem.imageUrl)
    }
    // Editorial fields: DB row wins when present, local seed fills gaps.
    // Each variant keeps its own row/data — never copied from siblings.
    const groupId = archiveItem?.productGroupId ?? localDetail?.productGroupId ?? null
    const dbPrice = archiveItem?.price ?? 0
    const price = dbPrice > 0 ? dbPrice : (localDetail?.price ?? 0)
    const currency = archiveItem?.currency || localDetail?.currency || ''
    const color = archiveItem?.color ?? localDetail?.color
    const description = archiveItem?.description ?? localDetail?.description
    const colors = archiveItem?.colors ?? localDetail?.colors ?? []
    return {
      id: selectedProductId,
      number: localDetail?.number ?? archiveItem?.ghost ?? '000',
      name: archiveItem?.name ?? localDetail?.name ?? '',
      price,
      currency,
      color,
      colors,
      description,
      available: localDetail?.available ?? true,
      imageUrl: gallery[0] ?? archiveItem?.imageUrl ?? null,
      images: gallery,
      ghost: archiveItem?.ghost ?? localDetail?.number ?? '000',
      periodStartYear:
        archiveItem?.periodStartYear ?? localDetail?.periodStartYear ?? 2025,
      productGroupId: groupId,
      category: archiveItem?.category ?? 'deca',
    }
  })()

  // Real color variants: same explicit group id, each with its own id.
  // Switching = changing product id through the existing handler.
  // Un grupo nunca mezcla líneas: solo variantes de la misma categoría.
  const selectedVariants = (() => {
    if (!selectedProduct?.productGroupId) return []
    const groupId = selectedProduct.productGroupId
    const selectedCategory =
      items.find((item) => item.id === selectedProductId)?.category ?? 'deca'
    const fromGrid = getVariants(items, groupId).filter(
      (item) => (item.category ?? 'deca') === selectedCategory,
    )
    if (fromGrid.length > 1) {
      return fromGrid.map((item) => ({
        id: item.id,
        color: item.color ?? item.name,
        name: item.name,
        colors: item.colors ?? [],
      }))
    }
    // Local fallback (no Supabase): derive from static seeds.
    const localGroup = products.filter((p) => (p.productGroupId ?? null) === groupId)
    if (localGroup.length > 1) {
      return localGroup.map((p) => ({ id: p.id, color: p.color ?? p.name, name: p.name, colors: p.colors ?? [] }))
    }
    return []
  })()

  // Línea JJ vive al final del Archive como un capítulo más.
  // Private admin panel. No public links point here — URL only.
  if (isAdminRoute) {
    return (
      <div className="grain">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <main id="main-content">
          <Admin />
        </main>
      </div>
    )
  }

  return (
    <div className="grain">
      {/* Skip navigation */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <Header
        onSelectYear={handleSelectYear}
        showBackButton={view === 'product'}
        onBack={handleBackToArchive}
        decagramActive={decagramActive}
        onDecagramToggle={toggleDecagram}
      />

      {view === 'product' && selectedProduct ? (
        <Product
          key={selectedProduct.id}
          product={selectedProduct}
          variants={selectedVariants}
          onVariantSelect={handleViewProduct}
        />
      ) : (
        <>
          {decagramActive && <DecagramBackdrop />}
          <main id="main-content">
          <div ref={archiveRef}>
            <Archive onViewProduct={handleViewProduct} />
          </div>

          <Footer />
        </main>
        </>
      )}
    </div>
  )
}

export default App
