import { apiFetch } from '@/api/client'

export type LeadKind = 'demo' | 'contact' | 'pricing' | 'enterprise'

export interface LeadSubmission {
  kind: LeadKind
  full_name: string
  business_email: string
  company: string
  job_role?: string
  team_size?: string
  primary_requirement?: string
  message?: string
  source_page?: string
  /** Honeypot -- always empty for real visitors. */
  website?: string
}

export function submitLead(lead: LeadSubmission): Promise<{ received: boolean }> {
  return apiFetch<{ received: boolean }>('/public/leads', {
    method: 'POST',
    body: JSON.stringify(lead),
  })
}
