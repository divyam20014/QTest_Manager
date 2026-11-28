import type { PlanStatus } from '@/api/testPlans'

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { draft: 'Draft', active: 'Active', complete: 'Complete' }
export const PLAN_STATUS_TONE = { draft: 'neutral', active: 'info', complete: 'positive' } as const
