import { useEffect } from 'react'
import { keyboardBottomInset } from '@/lib/viewport'

export function useVisualViewportInset() {
  useEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const update = () => {
      document.documentElement.style.setProperty(
        '--keyboard-inset',
        `${keyboardBottomInset(visualViewport, window.innerHeight)}px`,
      )
    }
    update()
    visualViewport.addEventListener('resize', update)
    visualViewport.addEventListener('scroll', update)
    return () => {
      visualViewport.removeEventListener('resize', update)
      visualViewport.removeEventListener('scroll', update)
      document.documentElement.style.setProperty('--keyboard-inset', '0px')
    }
  }, [])
}
