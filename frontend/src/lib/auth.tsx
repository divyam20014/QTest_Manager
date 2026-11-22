import { type ReactNode, createContext, useContext, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchMe, type MeResponse } from '@/api/auth'

interface AuthContextValue {
  user: MeResponse | null
  isLoading: boolean
  isAuthenticated: boolean
  refresh: () => Promise<unknown>
}

const HINT_KEY = 'qtesthub:session-hint'

/** True when this browser last saw a signed-in session. A user upgrading
 * from a build without the hint gets one transient public render until
 * /auth/me resolves. Storage failures read as "no hint". Only ever a
 * rendering hint, never an access decision. */
export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (isLoading) return
    try {
      if (!isError && data) localStorage.setItem(HINT_KEY, '1')
      else localStorage.removeItem(HINT_KEY)
    } catch {
      // Blocked storage: the hint is optional.
    }
  }, [isLoading, isError, data])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me'] })

  return (
    <AuthContext.Provider
      value={{ user: data ?? null, isLoading, isAuthenticated: !isError && !!data, refresh }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/** The signed-in user's id, or null (also outside an AuthProvider, e.g. in unit tests). */
export function useCurrentUserId(): string | null {
  return useContext(AuthContext)?.user?.user_id ?? null
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
