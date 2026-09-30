import { useMemo, type FC } from 'react'
import {
  archivePeriods,
  formatPeriodCompact,
  getArchivePeriodState,
  getDecadeState,
  type ArchivePeriod,
} from '../../data/archive'
import { useProducts } from '../../hooks/useProducts'
import { useCurrentTime } from '../../hooks/useCurrentTime'
import { Decagram } from '../Decagram/Decagram'
import styles from './Header.module.css'

interface HeaderProps {
  onSelectYear?: (year: number) => void
  showBackButton?: boolean
  onBack?: () => void
  /** Whether the living decagram background is active */
  decagramActive?: boolean
  /** Callback when decagram toggle is clicked */
  onDecagramToggle?: () => void
}

const Header: FC<HeaderProps> = ({
  onSelectYear,
  showBackButton = false,
  onBack,
  decagramActive = true,
  onDecagramToggle,
}) => {
  const now = useCurrentTime(60_000)
  // Década completa (29 ago → hoy): mismo cálculo que los años.
  const decadePct = Math.round(getDecadeState(now).progress * 100)
  const { items } = useProducts()
  // Years that actually have products navigate; the rest stay visible.
  const chapterYears = useMemo(
    () => new Set(items.map((item) => item.periodStartYear)),
    [items],
  )

  return (
    <header className={styles.header}>
      {showBackButton ? (
        <button
          type="button"
          className={styles.brandButton}
          onClick={onBack}
          aria-label="Back to archive"
        >
          <span className={styles.backArrow} aria-hidden="true">
            ←
          </span>
          <span className={styles.brandName}>BACK</span>
        </button>
      ) : (
        <div className={styles.brand}>
          <Decagram
            active={decagramActive ?? true}
            size={14}
            onClick={onDecagramToggle}
            aria-label={decagramActive ? 'Desactivar fondo animado' : 'Activar fondo animado'}
            className={styles.symbol}
          />
          <span className={styles.brandName}>DECA</span>
        </div>
      )}

      <nav className={styles.timeline} aria-label="Archive periods">
        {archivePeriods.map((period: ArchivePeriod) => {
          const state = getArchivePeriodState(period, now)
          const label = formatPeriodCompact(period)
          const className = [
            styles.period,
            state.status === 'active' ? styles.active : '',
            state.status === 'completed' ? styles.completed : '',
            state.status === 'future' ? styles.future : '',
          ]
            .filter(Boolean)
            .join(' ')
          const marks = (
            <>
              {label}{' '}
              {state.status === 'completed' && '●'}
              {state.status === 'active' && (
                <>
                  <span aria-hidden="true">◐</span>
                  <span className={styles.pct}>
                    {Math.round(state.progress * 100)}%
                  </span>
                </>
              )}
              {state.status === 'future' && '○'}
            </>
          )
          return chapterYears.has(period.startYear) ? (
            <button
              key={period.id}
              type="button"
              className={className}
              onClick={() => onSelectYear?.(period.startYear)}
              aria-label={`Go to ${label} products`}
            >
              {marks}
            </button>
          ) : (
            <span key={period.id} className={className} aria-disabled="true">
              {marks}
            </span>
          )
        })}
      </nav>

      <div className={styles.rightGroup}>
        <span
          className={styles.indicator}
          aria-label={`Década completada al ${decadePct}%`}
        >
          <span aria-hidden="true">◐</span>{' '}
          <span className={styles.pct}>{decadePct}%</span>
        </span>
      </div>
    </header>
  )
}

export default Header
