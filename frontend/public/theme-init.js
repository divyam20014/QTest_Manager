// Applies the saved light/dark choice before the first paint, so public pages
// (sign-in, sign-up, invite, Platform Admin) honour it too. Before this the
// choice was only read once the signed-in shell mounted, so those pages always
// rendered with the OS preference. A separate file, not an inline script, because
// the production Content-Security-Policy is `script-src 'self'`.
//
// Same rule as src/lib/useThemePreference.ts: the stored choice wins, otherwise
// follow the OS. Keep the storage key in sync with that file.
;(function () {
  try {
    var stored = null
    try {
      stored = localStorage.getItem('qtesthub:theme')
    } catch {
      // Blocked storage: fall through to the OS preference.
    }
    var dark =
      stored === 'dark' ||
      (stored !== 'light' &&
        !!window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  } catch {
    // Never let theming break the page.
  }
})()
