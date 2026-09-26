import * as React from 'react'

import { usePreferences } from '~/lib/preferences'

/** True when motion should be kept still: chosen in Settings, or asked for by the OS. */
export function usePrefersReducedMotion(): boolean {
  const { motion } = usePreferences()
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  if (motion === 'reduce') return true
  if (motion === 'full') return false
  return reduced
}
