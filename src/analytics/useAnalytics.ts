import { useEffect, useRef } from 'react'
import { buildPage, startAnalytics, updateAnalyticsPage } from './tracker'

type View = 'home' | 'product'

// Conecta el estado view de App al tracker con el mínimo acople:
// un insert por pestaña + UPDATE al navegar (nunca insert de más).
export function usePageTracking(view: View, productId: string | null): void {
  const firstUpdate = useRef(true)
  const pageRef = useRef(buildPage(view === 'product' ? productId : null))
  pageRef.current = buildPage(view === 'product' ? productId : null)

  useEffect(() => {
    const cleanup = startAnalytics(() => pageRef.current)
    return cleanup
  }, [])

  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false
      return
    }
    updateAnalyticsPage(buildPage(view === 'product' ? productId : null))
  }, [view, productId])
}
