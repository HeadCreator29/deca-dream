import type { FC } from 'react'
import styles from './Footer.module.css'

const Footer: FC = () => {
  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <div className={styles.leftBlock}>
          <span className={styles.statement}>DECA ESTUVO AQUÍ.</span>
          <span className={styles.dates}>2025—2035</span>
          <span className={styles.location}>SANTO DOMINGO, RD</span>
          <span className={styles.copy}>© DECA DREAM</span>
        </div>

        <nav className={styles.links} aria-label="Social links">
          <a
            href="https://www.instagram.com/deca.dream?utm_source=ig_web_button_share_sheet&stkn=ZDNlZDc0MzIxNw=="
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            INSTAGRAM
          </a>
          <a
            href="https://kick.com/decadream"
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            KICK
          </a>
        </nav>
      </div>
    </footer>
  )
}

export default Footer
