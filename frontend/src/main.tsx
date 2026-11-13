import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { isAccountNotAllowed } from '@/api/client'
import { AuthProvider } from '@/auth/AuthProvider'
import { PlatformProvider } from '@/platform'
import { registerPwa } from '@/pwa/register'
import { Boot } from './Boot'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 許可されていないアカウントの拒否は再試行しても変わらない。サインアウト後に要求を重ねない。
      retry: (failureCount, error) => !isAccountNotAllowed(error) && failureCount < 3,
    },
  },
})

registerPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <PlatformProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <Boot>
                <App />
              </Boot>
            </AuthProvider>
          </QueryClientProvider>
        </PlatformProvider>
      </LazyMotion>
    </MotionConfig>
  </StrictMode>,
)
