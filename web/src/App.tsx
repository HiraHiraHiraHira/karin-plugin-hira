import { lazy, Suspense, useEffect, type FormEvent } from 'react'
import { cn, Description, ScrollShadow, Spinner, Surface, Toast } from '@heroui/react'
import { useMemoizedFn, useSetState } from 'ahooks'

import { loginWithAuthKey } from './auth/request'
import { authChangedEventName, hasAuthToken } from './auth/token'
import { useTheme } from './hooks/useTheme'
import { detectDevice, type DeviceLayout } from './utils/device'

type RootState = {
  authenticating: boolean
  authenticated: boolean
  device: DeviceLayout
}

const normalizePath = (path: string) => path.replace(/\/+$/, '') || '/'

const ConfigPanel = lazy(() => import('./components/common/ConfigPanel'))
const LoginPanel = lazy(() => import('./components/common/LoginPanel'))

const LoadingPanel = ({ label }: { label: string }) => (
  <Surface className="flex min-h-screen items-center justify-center gap-4">
    <Spinner size="sm" aria-label={label} />
    <Description>{label}</Description>
  </Surface>
)

const App = () => {
  useTheme()

  const [state, setState] = useSetState<RootState>({
    authenticating: true,
    authenticated: hasAuthToken(),
    device: detectDevice()
  })

  const syncDevice = useMemoizedFn(() => {
    const nextDevice = detectDevice()
    setState((current) => current.device === nextDevice ? null : { device: nextDevice })
  })

  useEffect(() => {
    const handleAuthChange = () => setState({ authenticated: hasAuthToken() })
    window.addEventListener(authChangedEventName, handleAuthChange)
    window.addEventListener('storage', handleAuthChange)

    return () => {
      window.removeEventListener(authChangedEventName, handleAuthChange)
      window.removeEventListener('storage', handleAuthChange)
    }
  }, [setState])

  useEffect(() => {
    let animationFrameId = 0
    const handleViewportChange = () => {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = window.requestAnimationFrame(syncDevice)
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [syncDevice])

  useEffect(() => {
    const boot = async () => {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token')

      if (!token) {
        setState({ authenticating: false })
        return
      }

      try {
        await loginWithAuthKey(token)
        window.history.replaceState(null, '', normalizePath(window.location.pathname))
      } finally {
        setState({
          authenticating: false,
          authenticated: hasAuthToken()
        })
      }
    }

    boot()
  }, [setState])

  const handleLogin = useMemoizedFn((_event?: FormEvent) => {
    setState({
      authenticated: true,
      authenticating: false
    })
  })

  if (state.authenticating) {
    return (
      <Surface className="flex min-h-screen items-center justify-center gap-4">
        <Spinner size="sm" aria-label="正在进入配置页" />
        <Description>正在进入配置页</Description>
      </Surface>
    )
  }

  if (!state.authenticated) {
    return (
      <Suspense fallback={<LoadingPanel label="正在加载登录页" />}>
        <LoginPanel onLogin={handleLogin} />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<LoadingPanel label="正在加载配置页" />}>
      <Surface className="h-screen overflow-hidden">
        <Toast.Provider placement="top" />
        <ScrollShadow
          hideScrollBar
          className={cn(
            'h-full px-3 py-3 sm:px-5 sm:py-4',
            state.device === 'mobile' && [
              'data-[top-scroll=true]:[mask-image:none]',
              'data-[top-scroll=true]:[-webkit-mask-image:none]',
              'data-[top-bottom-scroll=true]:[mask-image:linear-gradient(180deg,black_calc(100%_-_var(--scroll-shadow-size)),transparent)]',
              'data-[top-bottom-scroll=true]:[-webkit-mask-image:linear-gradient(180deg,black_calc(100%_-_var(--scroll-shadow-size)),transparent)]'
            ]
          )}
          size={56}
        >
          <ConfigPanel device={state.device} variant="karin" />
        </ScrollShadow>
      </Surface>
    </Suspense>
  )
}

export default App
