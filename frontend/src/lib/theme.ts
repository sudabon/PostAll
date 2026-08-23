import { useEffect, useState } from 'react'

export function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof document === 'undefined' ? false : document.documentElement.classList.contains('dark'),
  )
  useEffect(() => {
    const el = document.documentElement
    const apply = () => setDark(el.classList.contains('dark'))
    apply()
    const obs = new MutationObserver(apply)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}
