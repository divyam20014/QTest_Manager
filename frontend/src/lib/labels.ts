// Shared raw-key -> friendly-label helpers (UI/UX review bug #15: statuses
// and audit action codes like `ready_for_review`/`testrun.paused` were
// shown verbatim in several places). Each entity already has its own
// curated label map (test case/defect status, audit action maps) for the
// values worth a bespoke label -- this is the fallback for everything
// else, so NOTHING ever reaches the screen as a raw snake_case/dot.case
// key, even a value nobody wrote an explicit label for yet.
const WORD_OVERRIDES: Record<string, string> = {
  testcase: 'Test Case',
  testrun: 'Test Run',
  testrunsettings: 'Test Run Settings',
  mfa: 'MFA',
  sso: 'SSO',
  scim: 'SCIM',
  api: 'API',
  ai: 'AI',
  id: 'ID',
  sla: 'SLA',
  url: 'URL',
}

/** "ready_for_review" / "in_progress" -> "Ready For Review" / "In Progress". */
export function humanizeKey(value: string): string {
  return value
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((word) => WORD_OVERRIDES[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/** "testrun.paused" -> "Test Run Paused". Audit log action codes are
 * `entity.verb` dot-separated; split on '.' first so each half is
 * humanized on its own rather than running the whole string through one
 * pass (which would read "Testrun.paused" as a single mangled word). */
export function humanizeActionCode(action: string): string {
  return action
    .split('.')
    .map((part) => humanizeKey(part))
    .join(' ')
}
