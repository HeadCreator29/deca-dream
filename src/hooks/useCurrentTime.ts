import { useEffect, useState } from 'react'

/**
 * Returns the current date, updating at the specified interval.
 * Uses a single shared interval per unique intervalMs value across the app.
 */
export function useCurrentTime(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return now
}