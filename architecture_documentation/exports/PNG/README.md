Empty by design. Use the **Export PNG** toolbar button inside `index.html` to
generate a PNG of the diagram currently on screen — it is produced live in
the browser (SVG rendered to a canvas, then `canvas.toBlob`), not pre-rendered
to this folder. See the portal's `README.md` ("Scope limits") for why.
