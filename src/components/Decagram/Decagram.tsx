import { type FC, type SVGProps } from 'react'
import styles from './Decagram.module.css'

interface DecagramProps extends SVGProps<SVGSVGElement> {
  /** Whether the decagram is active (filled) or inactive (outline) */
  active?: boolean
  /** Size in pixels */
  size?: number
  /** Click handler */
  onClick?: () => void
  /** Accessible label */
  'aria-label'?: string
}

/**
 * Decagram — 10-pointed star (decagram) symbol.
 * Brand mark + toggle for the living background.
 */
export const Decagram: FC<DecagramProps> = ({
  active = true,
  size = 24,
  onClick,
  'aria-label': ariaLabel = 'Toggle living background',
  className,
  ...props
}) => {
  const isButton = typeof onClick === 'function'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${styles.decagram} ${active ? styles.active : styles.inactive} ${isButton ? styles.button : ''} ${className || ''}`}
      role={isButton ? 'button' : 'img'}
      tabIndex={isButton ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
      aria-label={ariaLabel}
      aria-pressed={isButton ? active : undefined}
      {...props}
    >
      <defs>
        <path id="decagramPath" d="M16,2 L18.1,9.5 L24.8,3.9 L21.5,12 L30.3,11.4 L22.8,16 L30.3,20.6 L21.5,20 L24.8,28.1 L18.1,22.5 L16,31 L13.9,22.5 L7.2,28.1 L10.5,20 L1.7,20.6 L9.2,16 L1.7,11.4 L10.5,12 L7.2,3.9 L13.9,9.5 Z" />
      </defs>
      {/* Outer glow when active */}
      {active && (
        <use
          href="#decagramPath"
          className={styles.glow}
          filter="url(#decagramGlow)"
        />
      )}
      {/* Main decagram shape */}
      <use
        href="#decagramPath"
        className={active ? styles.filled : styles.outline}
      />
      {/* SVG filter for glow */}
      <defs>
        <filter id="decagramGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  )
}

export default Decagram