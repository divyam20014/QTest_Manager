/** Public marketing pages. `/` is also public for signed-out visitors (see HomeGate). */
export const MARKETING_PATHS = [
  '/platform',
  '/features',
  '/solutions',
  '/quality-intelligence',
  '/pricing',
  '/about',
  '/contact',
  '/request-demo',
  '/security',
  '/privacy',
  '/terms',
] as const

export function isMarketingPath(pathname: string): boolean {
  return (MARKETING_PATHS as readonly string[]).includes(pathname)
}
