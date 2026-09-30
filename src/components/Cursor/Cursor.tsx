import { useState, useEffect, useRef, useCallback, type FC } from 'react'
import styles from './Cursor.module.css'

/**
 * Decagram Cursor — Single filled yellow-orange decagram.
 * Always visible everywhere (no native cursor).
 * Expands on interactive elements for feedback.
 * Hidden on mobile.
 */
const Cursor: FC = () => {
  const [isHoveringInteractive, setIsHoveringInteractive] = useState(false)
  const [isMobile, setIsMobile] = useState(true)

  // Position refs — mutable for RAF, no re-render on every move
  const mousePos = useRef({ x: -100, y: -100 })
  const cursorPos = useRef({ x: -100, y: -100 })

  // DOM ref for direct manipulation (skip React re-renders)
  const cursorRef = useRef<HTMLDivElement>(null)

  // RAF tracking
  const rafId = useRef<number>(0)

  // Detect mobile/touch devices
  useEffect(() => {
    const mql = window.matchMedia('(hover: none) and (pointer: coarse)')
    setIsMobile(mql.matches)

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Track mouse position
  useEffect(() => {
    if (isMobile) return

    const onMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [isMobile])

  // Detect hover on interactive elements — ONLY for visual feedback (expand cursor)
  // NEVER switches to native cursor
  useEffect(() => {
    if (isMobile) return

    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'A' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.closest('a') ||
        target.closest('button') ||
        target.closest('[role="button"]') ||
        target.closest('[role="link"]')
      ) {
        setIsHoveringInteractive(true)
      }
    }

    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        setIsHoveringInteractive(false)
      }
    }

    document.addEventListener('mouseover', onOver, { passive: true })
    window.addEventListener('mouseleave', onLeave, { passive: true })
    return () => {
      document.removeEventListener('mouseover', onOver)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [isMobile])

  // Custom cursor retirado: siempre cursor nativo. Si este componente
  // llegara a montarse por error, no oculta nada y se limpia al salir.
  useEffect(() => {
    document.body.style.cursor = ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [])

  // Animation loop — smooth follow
  useEffect(() => {
    if (isMobile) return

    const cursorLerp = 0.18 // smooth follow

    const animate = () => {
      cursorPos.current.x += (mousePos.current.x - cursorPos.current.x) * cursorLerp
      cursorPos.current.y += (mousePos.current.y - cursorPos.current.y) * cursorLerp

      if (cursorRef.current) {
        cursorRef.current.style.left = `${cursorPos.current.x}px`
        cursorRef.current.style.top = `${cursorPos.current.y}px`
      }

      rafId.current = requestAnimationFrame(animate)
    }

    rafId.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId.current)
  }, [isMobile])

  const handleTouchStart = useCallback(() => {
    setIsMobile(true)
  }, [])

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    return () => window.removeEventListener('touchstart', handleTouchStart)
  }, [handleTouchStart])

  // Don't render on mobile
  if (isMobile) return null

  // Expand cursor on interactive elements (visual feedback only)
  const cursorClass = isHoveringInteractive
    ? `${styles.decagramCursor} ${styles.hover}`
    : styles.decagramCursor

  return (
    <div
      ref={cursorRef}
      className={cursorClass}
      aria-hidden="true"
    >
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          className={styles.cursorPath}
          d="M14,1 L15.8,7.8 L22.5,3.5 L19.3,11 L27.5,10.5 L20.5,15 L27.5,19.5 L19.3,19 L22.5,28.5 L15.8,22.2 L14,27 L12.2,22.2 L7.5,28.5 L10.5,19 L1.5,19.5 L9.5,15 L1.5,10.5 L9.5,11 L7.5,3.5 L12.2,7.8 Z"
        />
      </svg>
    </div>
  )
}

export default Cursor