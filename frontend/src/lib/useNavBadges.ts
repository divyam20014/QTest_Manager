import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getDefectStatusCounts } from '@/api/defects'
import { getMyWorkSummary } from '@/api/myWork'
import { useAuth } from '@/lib/auth'
import { openDefectCount } from '@/lib/navBadges'
import type { BadgeCounts } from '@/lib/navRegistry'

/**
 * The sidebar counts, each straight from the API (never a placeholder):
 *  - defects: open defects the user can see (same scoping as the Defects list);
 *  - myWork: the user's own run cases still to do plus test cases waiting for their
 *    review, from `GET /my-work/summary` (the same queries as the My Work tabs).
 * A count that has not loaded or failed reads as 0, which hides the badge.
 */
export function useNavBadges(): { counts: BadgeCounts; ready: boolean } {
  const { user } = useAuth()
  const defects = useQuery({
    queryKey: ['defects', 'status-counts', 'nav-badge', user?.user_id],
    queryFn: () => getDefectStatusCounts(),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const myWork = useQuery({
    queryKey: ['my-work', 'summary', user?.user_id],
    queryFn: getMyWorkSummary,
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const counts: BadgeCounts = {
    defects: openDefectCount(defects.data),
    myWork: myWork.data ? myWork.data.run_cases_total + myWork.data.reviews_total : 0,
  }
  return { counts, ready: defects.isSuccess && myWork.isSuccess }
}

/**
 * A polite, focus-neutral message for a screen-reader live region when a badge count
 * changes after the first load (a new defect, a finished run case). Silent on first load.
 */
export function useBadgeAnnouncement(counts: BadgeCounts, ready: boolean): string {
  const [state, setState] = useState<{ prev: BadgeCounts | null; message: string }>({ prev: null, message: '' })
  // Derived during render (the documented "adjust state while rendering" pattern), not in an effect.
  if (ready && (!state.prev || state.prev.defects !== counts.defects || state.prev.myWork !== counts.myWork)) {
    const parts: string[] = []
    if (state.prev) {
      if (state.prev.defects !== counts.defects) parts.push(`Defects: ${counts.defects} open`)
      if (state.prev.myWork !== counts.myWork) parts.push(`My Work: ${counts.myWork} pending`)
    }
    setState({ prev: { ...counts }, message: parts.length > 0 ? parts.join('. ') : state.message })
  }
  return state.message
}
