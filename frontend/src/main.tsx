import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter/wght.css'

import { isForbidden } from './api/client.ts'
import { App } from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { ToastProvider } from './lib/toast.tsx'
import './index.css'

// Same default (3 retries) as before, except a 403 is never retried: the
// answer cannot change, and the retries only repeat the refusal in the console.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (failureCount, error) => !isForbidden(error) && failureCount < 3 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
