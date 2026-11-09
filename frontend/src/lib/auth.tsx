import { type ReactNode, createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchMe, type MeResponse } from '@/api/auth'

interface AuthContextValue {
  user: MeResponse | null
  isLoading: boolean
  isAuthenticated: boolean
  refresh: () => Promise<unknown>
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me'] })

  return (
    <AuthContext.Provider
      value={{ user: data ?? null, isLoading, isAuthenticated: !isError && !!data, refresh }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
