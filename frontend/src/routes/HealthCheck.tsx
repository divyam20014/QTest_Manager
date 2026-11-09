import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/api/client'
import { Button } from '@/components/ui/button'

interface HealthStatus {
  status: string
}

export function HealthCheck() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthStatus>('/health'),
  })

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">QTestHub</h1>
      <p className="text-[var(--muted-foreground)]">
        {isLoading && 'Checking backend...'}
        {isError && 'Backend unreachable'}
        {data && `Backend status: ${data.status}`}
      </p>
      <Button onClick={() => refetch()} variant="outline">
        Re-check
      </Button>
    </div>
  )
}
