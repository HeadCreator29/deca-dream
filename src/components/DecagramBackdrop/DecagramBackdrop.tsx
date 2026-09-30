import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import styles from './DecagramBackdrop.module.css'

/**
 * DecagramBackdrop — a living decagram drifting like a microorganism.
 * Organic brownian drift + subtle shape morphing via SVG turbulence.
 */
const DecagramBackdrop: FC = () => {
  const motionRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const filterRef = useRef<SVGFilterElement>(null)

  useEffect(() => {
    const motionEl = motionRef.current
    const markEl = markRef.current
    const filterEl = filterRef.current

    if (!motionEl || !markEl || !filterEl) return

    // Respect prefers-reduced-motion — check once at mount
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let prefersReducedMotion = mediaQuery.matches

    const handleReducedMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches
      if (prefersReducedMotion) {
        motionEl.style.transform = 'none'
      }
    }
    mediaQuery.addEventListener('change', handleReducedMotionChange)

    if (prefersReducedMotion) {
      motionEl.style.transform = 'none'
    }

    // Calculate max translation so mark CENTER reaches viewport edges (half size max)
    const calculateBounds = () => {
      const markRect = markEl.getBoundingClientRect()
      const maxX = markRect.width / 2
      const maxY = markRect.height / 2
      return { maxX, maxY, markWidth: markRect.width, markHeight: markRect.height }
    }

    let bounds = calculateBounds()

    // Handle resize
    const handleResize = () => {
      bounds = calculateBounds()
    }
    window.addEventListener('resize', handleResize)

    // ── MICROORGANISM MOVEMENT PARAMETERS ──────────────────────────────
    // Irrational frequency ratios ensure non-repeating, lifelike paths
    const phi = (1 + Math.sqrt(5)) / 2 // golden ratio
    const sqrt2 = Math.sqrt(2)

    // Primary drift frequencies (VERY slow - floating in viscous medium)
    const fX1 = 0.00009 / phi   // ~124s - languid horizontal drift
    const fX2 = 0.00003 * phi   // ~199s - ultra-slow secondary drift
    const fY1 = 0.00009 / sqrt2  // ~110s - vertical drift
    const fY2 = 0.00003 * sqrt2  // ~165s - vertical secondary

    // Breathing / pulsing (very slow - metabolic rhythm)
    const fBreath = 0.0003 // ~174s - deep, slow breathing

    // Phase offsets (distributed via golden angle for non-resonance)
    const phaseX1 = 2.7
    const phaseX2 = Math.PI * phi
    const phaseY1 = Math.PI * (phi - 1)
    const phaseY2 = Math.PI * (2 - phi)
    const phaseBreath = Math.PI * 0.5

    // Amplitudes - subtle, floating
    const aX1 = 0.55
    const aX2 = 0.25
    const aY1 = 0.55
    const aY2 = 0.25
    const aJitter = 0.100    // 0.6% - barely visible micro-movements (viscous damping)
    const aJitterRot = 0.33  // degrees - microscopic rotation tremors
    const aBreath = 0.033    // 1.5% scale pulsing - gentle breathing
    const aRot = 33.3        // degrees - very slow body rotation

    // Shape morphing parameters
    const fMorph = 0.2  // ~260s - extremely slow shape shifting
    const aMorph = 0.05      // 5% max displacement - subtle

    const startTime = performance.now()
    let rafId: number

    // Brownian state for micro-jitter persistence
    let brownianX = 0
    let brownianY = 0
    let brownianRot = 33

    const animate = (now: number) => {
      if (prefersReducedMotion) return

      const t = now - startTime // milliseconds
      const dt = 1/60

      // ── PRIMARY DRIFT (slow, intentional wandering) ──────────────────
      let baseX =
        Math.sin(t * fX1 + phaseX1) * bounds.maxX * aX1 +
        Math.sin(t * fX2 + phaseX2) * bounds.maxX * aX2

      let baseY =
        Math.cos(t * fY1 + phaseY1) * bounds.maxY * aY1 +
        Math.sin(t * fY2 + phaseY2) * bounds.maxY * aY2

      // ── BROWNIAN MICRO-JITTER (tiny, persistent - gaussian-like) ──
      // Box-Muller-ish: sum of 3 uniforms ≈ gaussian, heavily damped
      const theta = 0.08 // fast mean reversion = heavily damped
      const sigma = 0.035 // very low volatility = still water
      
      // Gaussian-ish random (sum of 3 uniforms ≈ gaussian)
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.816
      
      brownianX += theta * (0 - brownianX) * dt + sigma * Math.sqrt(dt) * gauss()
      brownianY += theta * (0 - brownianY) * dt + sigma * Math.sqrt(dt) * gauss()
      brownianRot += theta * (0 - brownianRot) * dt + sigma * Math.sqrt(dt) * gauss()

      // ── COMBINE POSITION (pure drift + micro-jitter, NO tumbles) ───────
      let x = baseX + brownianX * bounds.maxX * aJitter
      let y = baseY + brownianY * bounds.maxY * aJitter

      // ── EDGE SOFT BOUNCE (extremely gentle, asymptotic) ────────────────
      // Smooth asymptotic approach to boundary - never a hard push
      const edgeThreshold = 0.85
      const edgeZone = 1 - edgeThreshold // 15% zone
      
      if (Math.abs(x) > bounds.maxX * edgeThreshold) {
        const normalizedOvershoot = (Math.abs(x) - bounds.maxX * edgeThreshold) / (bounds.maxX * edgeZone)
        // Smooth cubic ease-out: starts at 0, derivative 0, asymptotically approaches
        const pushFactor = normalizedOvershoot * normalizedOvershoot * normalizedOvershoot * 0.02
        const pushDir = x > 0 ? -1 : 1
        x += pushDir * bounds.maxX * pushFactor
      }
      if (Math.abs(y) > bounds.maxY * edgeThreshold) {
        const normalizedOvershoot = (Math.abs(y) - bounds.maxY * edgeThreshold) / (bounds.maxY * edgeZone)
        const pushFactor = normalizedOvershoot * normalizedOvershoot * normalizedOvershoot * 0.02
        const pushDir = y > 0 ? -1 : 1
        y += pushDir * bounds.maxY * pushFactor
      }

      // ── ROTATION (slow body rotation + micro-tremors) ─────────────────
      // No velocity following - just gentle rotation like floating
      const baseRotation =
        Math.sin(t * fX1 * 0.5 + phaseX1) * aRot * 0.6 +
        Math.cos(t * fY1 * 0.4 + phaseY1) * aRot * 0.4
      const rotation = baseRotation + brownianRot * aJitterRot

      // ── SUBTLE SQUASH & STRETCH (barely visible - viscous damping) ─────
      // Very slight deformation from brownian motion only
      const microStretch = 1 + Math.min(Math.abs(brownianX) * 0.3, 0.015) // max 1.5%
      const microSquash = 1 - Math.min(Math.abs(brownianY) * 0.2, 0.01)   // max 1%

      // ── BREATHING (deep, slow metabolic pulse) ────────────────────────
      const breath = Math.sin(t * fBreath + phaseBreath) * aBreath
      const baseScale = 1 + breath

      // Apply minimal squash/stretch
      const scaleX = baseScale * microStretch
      const scaleY = baseScale * microSquash

      // ── APPLY TRANSFORM (gentle, uniform-ish scaling) ─────────────────
      motionEl.style.transform = `
        translate3d(${x}px, ${y}px, 0)
        rotate(${rotation}deg)
        scale(${scaleX}, ${scaleY})
      `.replace(/\s+/g, ' ').trim()

      // ── SHAPE MORPHING (SVG turbulence - extremely slow, organic) ──────
      if (filterEl) {
        const turbulence = filterEl.querySelector('feTurbulence') as SVGElement
        if (turbulence) {
          // Two-layer turbulence: extremely slow, organic
          const morph1 = Math.sin(t * fMorph + 0) * aMorph * 0.015
          const morph2 = Math.cos(t * fMorph * 1.618 + Math.PI * 0.618) * aMorph * 0.008
          const baseFreq = 0.012 + morph1 + morph2 // slightly lower base
          const numOctaves = 3 + Math.floor((Math.sin(t * fMorph * 0.5) + 1) * 1.2) // 3-4 octaves
          turbulence.setAttribute('baseFrequency', `${baseFreq} ${baseFreq * 1.25}`)
          turbulence.setAttribute('numOctaves', String(numOctaves))
        }

        // Displacement scale - subtle breathing only
        const displacement = filterEl.querySelector('feDisplacementMap') as SVGElement
        if (displacement) {
          const dispScale = 5 + Math.sin(t * fBreath * 0.6 + Math.PI * 0.3) * 2
          displacement.setAttribute('scale', String(dispScale))
        }
      }

      rafId = requestAnimationFrame(animate)
    }

    rafId = requestAnimationFrame(animate)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', handleResize)
      mediaQuery.removeEventListener('change', handleReducedMotionChange)
    }
  }, [])

  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.decagramMotion} ref={motionRef}>
        <div className={styles.mark} ref={markRef}>
          <svg
            ref={svgRef}
            viewBox="-8 -8 48 48"
            focusable="false"
            aria-hidden="true"
            style={{ filter: 'url(#organicMorph)' }}
          >
            <defs>
              <filter id="organicMorph" ref={filterRef} x="-50%" y="-50%" width="200%" height="200%">
                {/* Fractal turbulence for organic distortion */}
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.015 0.0195"
                  numOctaves="4"
                  stitchTiles="stitch"
                  result="turbulence"
                />
                {/* Displacement map using the turbulence */}
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="turbulence"
                  scale="8"
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="displaced"
                />
                {/* Subtle blur to soften displacement edges */}
                <feGaussianBlur in="displaced" stdDeviation="0.5" result="softened" />
                {/* Composite back over original for subtle blending */}
                <feBlend in="softened" in2="SourceGraphic" mode="normal" />
              </filter>
            </defs>
            <path
              fill="#000000"
              d="M16,1 L18.1,9.5 L24.8,3.9 L21.5,12 L30.3,11.4 L22.8,16
                 L30.3,20.6 L21.5,20 L24.8,28.1 L18.1,22.5 L16,31
                 L13.9,22.5 L7.2,28.1 L10.5,20 L1.7,20.6 L9.2,16
                 L1.7,11.4 L10.5,12 L7.2,3.9 L13.9,9.5 Z"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default DecagramBackdrop