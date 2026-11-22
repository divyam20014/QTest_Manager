import { apiFetch } from '@/api/client'

// ADR-114: the tenant User Guide, served by the API as ordered sections. The
// server only returns the sections this user's permissions allow.
export interface GuideSection {
  id: string
  title: string
  audience: 'everyone' | 'manager' | 'admin'
  markdown: string
}

export interface UserGuide {
  sections: GuideSection[]
}

export function getUserGuide(): Promise<UserGuide> {
  return apiFetch<UserGuide>('/user-guide')
}
