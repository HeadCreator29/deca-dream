import type { FC } from 'react'
import styles from './About.module.css'

const About: FC = () => {
  return (
    <section className={styles.about}>
      <h2 className={styles.title}>DECA DREAM</h2>

      <p className={styles.dates}>2025—2035</p>

      <p className={styles.description}>
        UNA DÉCADA CONSTRUYENDO ALGO GRANDE
        <br />
        DESDE CERO EN TIEMPO REAL.
      </p>

      <p className={styles.location}>
        ONE DECADE.
        ONE DREAMER.
        ONE LEGACY.
      </p>
    </section>
  )
}

export default About
