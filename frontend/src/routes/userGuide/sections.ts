import type { GuideSection } from '@/api/userGuide'

/** ADR-114: the section that matches the user's role opens first. */
export function defaultSectionId(
  sections: readonly Pick<GuideSection, 'id'>[],
  tier: 'admin' | 'manager' | 'tester',
): string | undefined {
  return sections.find((s) => s.id === tier)?.id ?? sections[0]?.id
}

/** The section named by the URL hash (`#tester`), when the user is allowed it. */
export function sectionFromHash(
  sections: readonly Pick<GuideSection, 'id'>[],
  hash: string,
): string | undefined {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  return sections.find((s) => s.id === id)?.id
}
