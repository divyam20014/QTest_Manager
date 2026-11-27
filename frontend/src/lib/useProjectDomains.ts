import { useQuery } from '@tanstack/react-query'

import { getBranding } from '@/api/settings'

/** ADR-139: the organization's project domains. Same query as the app shell, so usually cached. */
export function useProjectDomains(): string[] {
  const branding = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  return branding.data?.project_domains ?? []
}
