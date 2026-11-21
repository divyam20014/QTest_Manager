// Applies the saved theme before the first paint, so every page (sign-in,
// sign-up, invite, Platform Admin, marketing, docs) honours it, not just the
// signed-in shell. A separate file, not an inline script, because the production
// Content-Security-Policy is `script-src 'self'`.
//
// Same rule as src/lib/useThemePreference.ts: the stored choice wins, otherwise
// follow the OS. Stored ids: light, dark, cobalt, sage, indigo (a data-theme
// attribute each) and custom (data-theme="custom" plus the computed tokens the
// app cached under qtesthub:theme-custom, validated here before they are
// injected). Keep the storage keys in sync with src/lib/useThemePreference.ts.
;(function () {
  try {
    var root = document.documentElement
    var stored = null
    var cached = null
    try {
      stored = localStorage.getItem('qtesthub:theme')
      if (stored === 'custom') cached = localStorage.getItem('qtesthub:theme-custom')
    } catch {
      // Blocked storage: fall through to the OS preference.
    }

    if (stored === 'cobalt' || stored === 'sage' || stored === 'indigo') {
      root.setAttribute('data-theme', stored)
      return
    }

    if (stored === 'custom' && cached) {
      try {
        var data = JSON.parse(cached)
        var valid =
          data &&
          data.v === 1 &&
          (data.scheme === 'light' || data.scheme === 'dark') &&
          data.tokens &&
          typeof data.tokens === 'object'
        var names = valid ? Object.keys(data.tokens) : []
        var colour = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [0-9.]{1,4}\))$/
        for (var i = 0; valid && i < names.length; i++) {
          if (!/^--[a-z0-9-]{1,40}$/.test(names[i]) || !colour.test(String(data.tokens[names[i]]))) valid = false
        }
        if (valid && names.length > 0) {
          for (var j = 0; j < names.length; j++) root.style.setProperty(names[j], data.tokens[names[j]])
          root.style.colorScheme = data.scheme
          root.setAttribute('data-theme', 'custom')
          return
        }
      } catch {
        // Corrupt cache: fall through to the OS preference.
      }
    }

    // ADR-101: with no explicit saved choice (nothing stored, or System) the public
    // marketing pages default to Cobalt & Sunshine; every other page keeps the OS
    // rule below. Keep MARKETING in sync with src/routes/marketingPaths.ts. "/" is
    // marketing only for a visitor without a session hint (see HomeGate).
    var MARKETING = /^\/(platform|features|solutions|quality-intelligence|pricing|about|contact|request-demo|security|privacy|terms)\/?$/
    var path = location.pathname
    var hinted = false
    try {
      hinted = localStorage.getItem('qtesthub:session-hint') === '1'
    } catch {
      // Blocked storage: treat as signed out.
    }
    if ((stored === null || stored === 'system' || stored === 'custom' || (stored !== 'light' && stored !== 'dark')) && (MARKETING.test(path) || (path === '/' && !hinted))) {
      root.setAttribute('data-theme', 'cobalt')
      return
    }

    var dark =
      stored === 'dark' ||
      (stored !== 'light' &&
        !!window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.setAttribute('data-theme', dark ? 'dark' : 'light')
  } catch {
    // Never let theming break the page.
  }
})()
