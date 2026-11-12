# QTestHub — Interactive Architecture Documentation Portal

Open **`index.html`** directly in Chrome (double-click it, or `File > Open`). No
build step, no server, no internet connection required — every library is
vendored locally under `assets/js/`.

## What this is

A self-contained, interactive HTML/CSS/JS portal covering all six requested
diagram categories (System Architecture, Data Flow Diagrams, Sequence
Diagrams, Process Flow / Flowcharts, Entity-Relationship Diagram, Use Case
Diagrams), rendered live from Mermaid source and driven by vendored
`mermaid.min.js` + `svg-pan-zoom.min.js` — no CDN, no fetch() calls (which
Chrome blocks on `file://` anyway), so it works fully offline.

It reuses the diagram content and technical descriptions from the earlier,
source-verified documentation pass at `docs/architecture/` (the same
`.mmd` Mermaid sources, copied into `assets/diagrams/`) and wraps that
content in a navigable, clickable, searchable portal.

## Directory structure

```
architecture_documentation/
  index.html                 <- open this in Chrome
  README.md                  <- this file
  scripts/
    build-data.js            <- one-off Node script that parses assets/diagrams/*.mmd
                                 into assets/js/data.generated.js (node/edge index,
                                 ER entity columns, ER relationships, raw mermaid source).
                                 Re-run it after editing any .mmd file — see below.
  assets/
    css/styles.css           <- design system (CSS custom properties, dark/light themes)
    js/
      mermaid.min.js          <- vendored Mermaid v10 (no CDN)
      svg-pan-zoom.min.js     <- vendored svg-pan-zoom v3.6 (no CDN)
      data.generated.js       <- auto-generated diagram geometry (do not hand-edit)
      content.js              <- hand-authored descriptions, actor info, module summaries
      app.js                  <- application logic: navigation, rendering, search,
                                 click-to-info, highlight-connected, export, theming
    diagrams/*.mmd            <- the 27 editable Mermaid source files (same content as
                                 docs/architecture/diagrams/, copied here so this portal
                                 is fully self-contained)
    icons/                    <- (icons are inline SVG in index.html/app.js; this
                                 folder is reserved for future custom icon assets)
  exports/
    SVG/ PNG/ PDF/            <- empty; see "Exports" below
```

## Editing a diagram

1. Edit the relevant `.mmd` file under `assets/diagrams/`.
2. Re-run the build script so `data.generated.js` picks up your change:
   ```
   node scripts/build-data.js assets/diagrams assets/js/data.generated.js
   ```
3. Reload `index.html` in Chrome.

To add curated click-info text (component descriptions, actor descriptions,
workflow notes), edit `assets/js/content.js` by hand — that file is never
auto-generated.

## Interactive features

- **Navigation**: left sidebar across all 7 sections (Overview + 6 diagram
  categories). Deep link directly to one with `?gotoSection=system` (or
  `dfd`, `sequence`, `process`, `erd`, `usecase`) on the URL.
- **Zoom / pan**: mouse wheel or the toolbar `+`/`−`, drag to pan, `Fit` and
  `Reset` buttons, double-click to zoom.
- **Fullscreen**: per-diagram fullscreen toggle (toolbar and top nav), `Esc`
  to exit.
- **Click-to-explore**: click any component/node/table/actor to open an info
  panel with its description, source-code reference, and (for flowcharts)
  dims every unconnected node so the clicked node's neighborhood stands out.
- **DFD level switcher**: dropdown to move between Level 0/1/2 diagrams.
- **Sequence workflow picker**: left list of all 9 workflows with their note
  and source references; selecting one re-renders that diagram.
- **Process flow legend**: diamond = decision point, green outline =
  success/terminal path, red outline = failure/rejection path — computed
  automatically from each flowchart's node shapes and label text.
- **ERD**: switch between the 3 sub-diagrams, search tables by name, click a
  table to see its full column list (with PK/FK marked) and every
  relationship it participates in, with connected tables highlighted.
- **Use case diagrams**: click an actor in the left list to see its
  description and real permission/source reference.
- **Global search**: top-nav search box indexes every component, table,
  sequence workflow, flowchart, actor, and document section — type to
  filter, arrow keys + Enter to jump straight to that section.
- **Dark / light theme**: toggle in the top nav, persisted in
  `localStorage`, defaults to the OS preference on first visit.
- **Export SVG / PNG**: toolbar buttons export the diagram currently on
  screen, generated client-side from the live rendered SVG (no server).
- **Download documentation (print/PDF)**: the printer icon in the top nav
  renders every section sequentially and opens the browser's native print
  dialog (`window.print()`) with a dedicated print stylesheet — save as PDF
  from there. This was a deliberate choice over vendoring a heavier
  client-side PDF-generation library; see the Overview page's disclosed
  scope limits for why.
- **Responsive**: works down to phone width — the sidebar becomes a
  slide-out drawer (hamburger icon in the top nav).

## Scope limits (disclosed, not hidden)

- This portal does not pre-render static SVG/PNG/PDF files into
  `exports/` — those folders exist per the requested output structure, but
  files are generated on demand in the browser via the Export buttons
  rather than checked into the repository. There is nothing to regenerate;
  it happens live.
- The "Download Documentation" action is the browser's native print
  pipeline, not a bespoke PDF generator — see above.
- SCIM provisioning, true GDPR physical erasure, SAML, and external tracker
  sync are explicitly marked "Not Identified in Current Implementation" or
  similar in the relevant info panels, matching the same disclosures made
  in `docs/architecture/*.md`.
- No application source code was touched to build this portal — only new
  files under `architecture_documentation/` were created.

## Validation performed

- All 27 `.mmd` diagrams were rendered headlessly (Chrome `--headless
  --dump-dom`) and confirmed free of Mermaid parse errors and JavaScript
  console errors. Two real Mermaid syntax bugs were found this way and
  fixed in the copied `.mmd` sources: stray semicolons inside unquoted
  sequence-diagram message text (3 files), and a dual `FK UK` attribute key
  combination not supported by Mermaid's ER grammar (1 file, 2 lines).
- A real `svg-pan-zoom` "fit to screen" bug was found and fixed (Mermaid
  emits `width="100%"` with no `height` attribute; `svg-pan-zoom` needs
  real pixel dimensions matching the `viewBox` to fit correctly — without
  this fix, only the top portion of larger diagrams was visible on load).
- Click-to-info, highlight-connected, DFD level switching, sequence
  workflow switching, ERD search, theme toggle, and global search were all
  exercised via a scripted interaction harness during development (since
  removed from the shipped `app.js`) and confirmed working across every
  section.
- Screenshots were taken and visually reviewed at desktop (1600×1000) and
  phone (~480px effective width) sizes in both light and dark themes.
