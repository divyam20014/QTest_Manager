/* QTestHub Architecture Portal — application logic.
   Pure client-side; no backend, no network calls, no CDN. Reads diagram
   geometry from data.generated.js (auto-parsed from the .mmd sources) and
   curated descriptions from content.js, renders diagrams with the locally
   vendored Mermaid + svg-pan-zoom libraries. */
"use strict";

(function () {
  const C = window.QTH_CONTENT;
  const G = window.QTH_GENERATED;

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    flow: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h7a4 4 0 0 1 4 4v4"/>',
    sequence: '<path d="M4 4v16M20 4v16M4 9h16M4 15h16"/>',
    flowchart: '<rect x="4" y="3" width="6" height="4"/><rect x="14" y="17" width="6" height="4"/><path d="M7 7v5a3 3 0 0 0 3 3h7"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    actor: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
  };
  const svgIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

  // ---------------------------------------------------------------- Theme
  const THEME_KEY = "qth_arch_theme";
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "var(--font-sans), sans-serif",
      flowchart: { htmlLabels: true, curve: "basis" },
      er: { useMaxWidth: false },
      sequence: { useMaxWidth: false, actorMargin: 60 },
    });
  }
  function initTheme() {
    let theme = null;
    const forced = location.search.match(/[?&]theme=(dark|light)/);
    if (forced) theme = forced[1];
    if (!theme) { try { theme = localStorage.getItem(THEME_KEY); } catch (e) {} }
    if (!theme) theme = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    applyTheme(theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    Viewer.rerenderActive();
  }

  // ---------------------------------------------------------------- Sidebar / nav
  let activeSection = "overview";
  const sectionViewEls = {};

  function buildSidebar() {
    const nav = document.getElementById("sidebar");
    nav.innerHTML = "";
    const label = document.createElement("div");
    label.className = "nav-group-label";
    label.textContent = "Documentation";
    nav.appendChild(label);
    C.sections.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      btn.dataset.section = s.id;
      btn.innerHTML = svgIcon(s.icon) + `<span>${s.label}</span>`;
      btn.addEventListener("click", () => {
        showSection(s.id);
        closeMobileSidebar();
      });
      nav.appendChild(btn);
    });
  }

  function showSection(id) {
    activeSection = id;
    document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.section === id));
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + id));
    const el = document.getElementById("view-" + id);
    if (el && !el.dataset.rendered) {
      el.dataset.rendered = "1";
      Views[id] && Views[id](el);
    }
    Viewer.onSectionShown(id);
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarScrim").classList.remove("open");
  }

  // ---------------------------------------------------------------- View shells
  function buildViewShells() {
    const main = document.getElementById("mainViews");
    C.sections.forEach((s) => {
      const view = document.createElement("section");
      view.className = "view";
      view.id = "view-" + s.id;
      main.appendChild(view);
      sectionViewEls[s.id] = view;
    });
  }

  // ---------------------------------------------------------------- Diagram viewer (shared engine)
  const Viewer = (function () {
    let panZoom = null;
    let currentCanvas = null;
    let currentKey = null;
    let currentSection = null;
    let currentRenderFn = null; // () => Promise<void>  (re-invoked on theme change)

    function destroyPanZoom() {
      if (panZoom) { try { panZoom.destroy(); } catch (e) {} panZoom = null; }
    }

    async function renderInto(canvasEl, raw, seedId) {
      canvasEl.classList.add("loading");
      destroyPanZoom();
      canvasEl.innerHTML = "";
      try {
        const { svg, bindFunctions } = await mermaid.render("mmd-" + seedId + "-" + Math.random().toString(36).slice(2, 8), raw);
        canvasEl.innerHTML = svg;
        const svgEl = canvasEl.querySelector("svg");
        if (svgEl) {
          // Mermaid emits width="100%" with no height attribute; svg-pan-zoom
          // needs real pixel width/height (matching the viewBox) to compute
          // an initial fit correctly, or it mis-scales and clips content.
          const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
          if (vb && vb.width && vb.height) {
            svgEl.setAttribute("width", String(vb.width));
            svgEl.setAttribute("height", String(vb.height));
          } else {
            svgEl.removeAttribute("height");
          }
          svgEl.style.maxWidth = "none";
          svgEl.style.width = "100%";
          svgEl.style.height = "100%";
          if (bindFunctions) bindFunctions(canvasEl);
          panZoom = window.svgPanZoom(svgEl, {
            zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true,
            minZoom: 0.1, maxZoom: 10, dblClickZoomEnabled: true,
          });
          requestAnimationFrame(() => { if (panZoom) { panZoom.resize(); panZoom.fit(); panZoom.center(); } });
        }
      } catch (err) {
        canvasEl.innerHTML = `<div style="padding:32px;color:var(--danger);font-size:13px;">Diagram render error: ${String(err && err.message || err)}</div>`;
      } finally {
        canvasEl.classList.remove("loading");
      }
      return canvasEl.querySelector("svg");
    }

    function zoomBy(factor) { if (panZoom) panZoom.zoomBy(factor); }
    function resetView() { if (panZoom) { panZoom.resetZoom(); panZoom.center(); panZoom.fit(); } }
    function fitView() { if (panZoom) panZoom.fit(); }

    function toggleFullscreen(workspaceEl) {
      workspaceEl.classList.toggle("is-fullscreen");
      setTimeout(() => { if (panZoom) panZoom.resize(); }, 50);
    }

    function currentSvg() { return currentCanvas ? currentCanvas.querySelector("svg") : null; }

    function exportSvg() {
      const svgEl = currentSvg();
      if (!svgEl) return;
      const clone = svgEl.cloneNode(true);
      clone.removeAttribute("style");
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
      clone.insertAdjacentHTML("afterbegin", `<rect width="100%" height="100%" fill="${bg}"/>`);
      const xml = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, (currentKey || "diagram") + ".svg");
    }

    function exportPng() {
      const svgEl = currentSvg();
      if (!svgEl) return;
      const bbox = svgEl.getBBox ? svgEl.getBBox() : { width: svgEl.clientWidth, height: svgEl.clientHeight };
      const w = Math.max(800, Math.ceil(bbox.width + (bbox.x || 0) * 2 || svgEl.viewBox.baseVal.width || 1200));
      const h = Math.max(600, Math.ceil(bbox.height + (bbox.y || 0) * 2 || svgEl.viewBox.baseVal.height || 800));
      const clone = svgEl.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
      clone.insertAdjacentHTML("afterbegin", `<rect width="100%" height="100%" fill="${bg}"/>`);
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      img.onload = function () {
        const canvas = document.createElement("canvas");
        const scale = 2;
        canvas.width = w * scale; canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => downloadBlob(blob, (currentKey || "diagram") + ".png"), "image/png");
      };
      img.onerror = function () { URL.revokeObjectURL(url); alert("PNG export failed for this diagram (unsupported SVG features). Try SVG export instead."); };
      img.src = url;
    }

    function downloadBlob(blob, filename) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function setActive(sectionId, key, canvasEl) {
      currentSection = sectionId; currentKey = key; currentCanvas = canvasEl;
    }

    function rerenderActive() {
      if (currentRenderFn) currentRenderFn();
    }

    function setRerenderFn(fn) { currentRenderFn = fn; }

    function onSectionShown(id) {
      setTimeout(() => { if (panZoom && currentSection === id) panZoom.resize(); }, 60);
    }

    return {
      renderInto, zoomBy, resetView, fitView, toggleFullscreen,
      exportSvg, exportPng, setActive, rerenderActive, setRerenderFn, onSectionShown,
      get panZoom() { return panZoom; },
    };
  })();

  // ---------------------------------------------------------------- Node index / click-to-info / highlight
  function domNodeId(el) {
    const m = (el.id || "").match(/^flowchart-(.+?)-\d+$/);
    return m ? m[1] : null;
  }
  function entityKeyFromGroup(g) {
    const idAttr = g.id || "";
    let m = idAttr.match(/^entity-(.+)$/i);
    if (m) return m[1].replace(/-\d+$/, "").toUpperCase();
    const t = g.querySelector("text");
    if (t) {
      const txt = t.textContent.trim().toUpperCase();
      if (G.erEntities[txt]) return txt;
    }
    return null;
  }

  function wireFlowchartInteractivity(svgEl, diagramKey, infoRenderer) {
    const diag = G.diagrams[diagramKey];
    if (!diag) return;
    const nodeEls = Array.from(svgEl.querySelectorAll("g.node"));
    const byId = {};
    nodeEls.forEach((g) => {
      const nid = domNodeId(g);
      if (nid) byId[nid] = g;
    });
    nodeEls.forEach((g) => {
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const nid = domNodeId(g);
        const nodeData = diag.nodes.find((n) => n.id === nid);
        highlightConnected(nid, byId, diag.edges);
        infoRenderer({
          kind: "component",
          title: (nodeData && nodeData.label) || nid || "Component",
          id: nid,
          diagramKey,
        });
      });
    });
    svgEl.addEventListener("click", () => clearHighlight(nodeEls));
  }

  function highlightConnected(nodeId, byId, edges) {
    const connected = new Set([nodeId]);
    edges.forEach((e) => {
      if (e.from === nodeId) connected.add(e.to);
      if (e.to === nodeId) connected.add(e.from);
    });
    Object.keys(byId).forEach((id) => {
      const el = byId[id];
      el.classList.remove("node-dim", "node-selected");
      if (connected.has(id)) {
        el.classList.add(id === nodeId ? "node-selected" : undefined);
        el.classList.remove("node-dim");
      } else {
        el.classList.add("node-dim");
      }
    });
  }
  function clearHighlight(nodeEls) {
    nodeEls.forEach((g) => g.classList.remove("node-dim", "node-selected"));
  }

  function decorateProcessFlow(svgEl) {
    const successRe = /\b(dashboard|approved|composed|assignable|done|runnable|200|201 created|verified|closed|proceed)\b/i;
    const dangerRe = /\b(40\d|429|409|reject|blocked|forbidden|unauthorized|terminal)\b/i;
    Array.from(svgEl.querySelectorAll("g.node")).forEach((g) => {
      const text = g.textContent || "";
      const shapeEl = g.querySelector("polygon");
      if (shapeEl) g.classList.add("decision-shape");
      let cls = null;
      if (dangerRe.test(text)) cls = "flow-fail";
      else if (successRe.test(text)) cls = "flow-success";
      if (cls) {
        const shape = g.querySelector("rect, polygon, circle, ellipse, path");
        if (shape) {
          shape.style.stroke = cls === "flow-fail" ? "var(--danger)" : "var(--success)";
          shape.style.strokeWidth = "2px";
        }
      }
    });
  }

  function wireErInteractivity(svgEl, onPick) {
    let groups = Array.from(svgEl.querySelectorAll('[id^="entity-" i]'));
    if (groups.length === 0) {
      groups = Array.from(svgEl.querySelectorAll("g")).filter((g) => {
        const t = g.querySelector("text");
        return t && G.erEntities[t.textContent.trim().toUpperCase()];
      });
    }
    const byKey = {};
    groups.forEach((g) => {
      const key = entityKeyFromGroup(g);
      if (key) { byKey[key] = g; g.classList.add("er-entity-group"); }
    });
    Object.keys(byKey).forEach((key) => {
      byKey[key].addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectEntity(key, byKey);
        onPick(key);
      });
    });
    return byKey;
  }

  function selectEntity(key, byKey) {
    const related = new Set([key]);
    G.erRelationships.forEach((r) => {
      if (r.from === key) related.add(r.to);
      if (r.to === key) related.add(r.from);
    });
    Object.keys(byKey).forEach((k) => {
      const el = byKey[k];
      el.classList.remove("node-dim", "node-selected");
      if (related.has(k)) { if (k === key) el.classList.add("node-selected"); }
      else el.classList.add("node-dim");
    });
  }

  // ---------------------------------------------------------------- Info panel helper
  function makeInfoPanel() {
    const panel = document.createElement("div");
    panel.className = "info-panel";
    panel.innerHTML = `<button class="ip-close" title="Close">&times;</button><div class="ip-body"><p class="ip-empty">Click a component, table, or entity in the diagram to see its details here.</p></div>`;
    panel.querySelector(".ip-close").addEventListener("click", () => panel.classList.remove("open"));
    const body = panel.querySelector(".ip-body");
    function render(html) { body.innerHTML = html; panel.classList.add("open"); }
    return { el: panel, render };
  }

  function renderComponentInfo(info, docs) {
    const d = (docs && docs[info.id]) || null;
    let html = `<h3 class="ip-title">${escapeHtml(info.title)}</h3><div class="ip-type">Component</div>`;
    if (d) {
      html += `<div class="ip-field"><label>Source</label><div class="val"><code>${escapeHtml(d.source)}</code></div></div>`;
      html += `<div class="ip-field"><label>Notes</label><div class="val">${escapeHtml(d.notes)}</div></div>`;
    } else {
      html += `<div class="ip-field"><label>Label</label><div class="val">${escapeHtml(info.title)}</div></div><p style="font-size:12px;color:var(--text-faint)">No extended description authored for this node; label shown as declared in the diagram source.</p>`;
    }
    return html;
  }

  function renderEntityInfo(key) {
    const ent = G.erEntities[key];
    let html = `<h3 class="ip-title">${escapeHtml(key)}</h3><div class="ip-type">Database Table</div>`;
    if (ent && ent.columns.length) {
      html += `<table><thead><tr><th>Column</th><th>Type</th><th>Key</th></tr></thead><tbody>`;
      ent.columns.forEach((c) => {
        const keyCls = c.key === "PK" || c.key === "PK_FK" ? "key-pk" : (c.key === "FK" ? "key-fk" : "");
        html += `<tr><td>${escapeHtml(c.name)}${c.note ? `<br><span style="color:var(--text-faint);font-size:10.5px">${escapeHtml(c.note)}</span>` : ""}</td><td>${escapeHtml(c.type)}</td><td class="${keyCls}">${escapeHtml(c.key)}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    const rels = G.erRelationships.filter((r) => r.from === key || r.to === key);
    if (rels.length) {
      html += `<div class="ip-field" style="margin-top:12px"><label>Relationships</label>`;
      rels.forEach((r) => {
        html += `<div class="val" style="margin-bottom:4px">${escapeHtml(r.from)} → ${escapeHtml(r.to)} <span style="color:var(--text-faint)">(${escapeHtml(r.label)})</span></div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------------- Toolbar builder
  function buildToolbar({ selectHtml, onSelectChange, workspaceEl }) {
    const bar = document.createElement("div");
    bar.className = "diagram-toolbar";
    bar.innerHTML = `
      ${selectHtml ? `<div class="toolbar-group"><select class="toolbar-select" id="tbSelect"></select></div>` : ""}
      <div class="toolbar-group">
        <button class="toolbar-btn" data-act="zoomin" title="Zoom in">${svgIcon("flow")}+</button>
        <button class="toolbar-btn" data-act="zoomout" title="Zoom out">−</button>
        <button class="toolbar-btn" data-act="fit" title="Fit to screen">Fit</button>
        <button class="toolbar-btn" data-act="reset" title="Reset position">Reset</button>
      </div>
      <div class="toolbar-group">
        <button class="toolbar-btn" data-act="fullscreen" title="Fullscreen this diagram">Fullscreen</button>
      </div>
      <div class="toolbar-group">
        <button class="toolbar-btn" data-act="svg" title="Export as SVG">Export SVG</button>
        <button class="toolbar-btn" data-act="png" title="Export as PNG">Export PNG</button>
      </div>
      <div class="toolbar-spacer"></div>
    `;
    bar.querySelector('[data-act="zoomin"]').addEventListener("click", () => Viewer.zoomBy(1.25));
    bar.querySelector('[data-act="zoomout"]').addEventListener("click", () => Viewer.zoomBy(0.8));
    bar.querySelector('[data-act="fit"]').addEventListener("click", () => Viewer.fitView());
    bar.querySelector('[data-act="reset"]').addEventListener("click", () => Viewer.resetView());
    bar.querySelector('[data-act="fullscreen"]').addEventListener("click", () => Viewer.toggleFullscreen(workspaceEl));
    bar.querySelector('[data-act="svg"]').addEventListener("click", () => Viewer.exportSvg());
    bar.querySelector('[data-act="png"]').addEventListener("click", () => Viewer.exportPng());
    return bar;
  }

  // ---------------------------------------------------------------- Views
  const Views = {};

  Views.overview = function (view) {
    const o = C.overview;
    view.innerHTML = `
      <div class="view-scroll">
        <div class="card">
          <h1>${o.title}</h1>
          <p>${o.what}</p>
          <div class="meta-row">
            <span class="meta-chip">Audience: ${o.audience}</span>
          </div>
        </div>

        <div class="card">
          <h2>Document index</h2>
          <div class="doc-index-grid" id="ovDocIndex"></div>
        </div>

        <div class="card">
          <h2>Architectural highlights</h2>
          <ul class="highlight-list" id="ovHighlights"></ul>
        </div>

        <div class="card">
          <h2>Methodology</h2>
          <ul class="highlight-list">${o.methodology.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
        </div>

        <div class="card">
          <h2>Scope limits of this portal <span class="badge warn">disclosed</span></h2>
          <div class="callout scope-limit"><ul>${o.scopeLimits.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>
        </div>
      </div>
    `;
    const grid = view.querySelector("#ovDocIndex");
    o.docIndex.forEach((d) => {
      const card = document.createElement("div");
      card.className = "doc-index-card";
      card.innerHTML = `<div class="di-title">${escapeHtml(d.label)}</div><div class="di-desc">${escapeHtml(d.desc)}</div>`;
      card.addEventListener("click", () => { showSection(d.id); document.querySelector(`.nav-item[data-section="${d.id}"]`).click(); });
      grid.appendChild(card);
    });
    const hl = view.querySelector("#ovHighlights");
    o.highlights.forEach((h) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="hl-title">${escapeHtml(h.title)}</div><div>${escapeHtml(h.body)}</div>`;
      hl.appendChild(li);
    });
  };

  function buildGenericFlowView(view, { title, purpose, scope, diagramKey, docs, decorate }) {
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(scope)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ workspaceEl: ws });
    const body = document.createElement("div");
    body.className = "diagram-body";
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div");
    canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(canvasWrap);
    body.appendChild(info.el);
    ws.appendChild(toolbar);
    ws.appendChild(body);

    async function doRender() {
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[diagramKey].raw, diagramKey);
      if (!svgEl) return;
      Viewer.setActive(activeSection, diagramKey, canvas);
      wireFlowchartInteractivity(svgEl, diagramKey, (nodeInfo) => info.render(renderComponentInfo(nodeInfo, docs)));
      if (decorate) decorate(svgEl);
    }
    Viewer.setRerenderFn(doRender);
    doRender();
  }

  Views.system = function (view) {
    buildGenericFlowView(view, {
      title: C.system.title, purpose: C.system.purpose, scope: C.system.scope,
      diagramKey: C.system.diagram, docs: C.system.componentDocs,
    });
    // append router + deployment reference cards below the workspace
    const extra = document.createElement("div");
    extra.className = "view-scroll";
    extra.style.flex = "0 0 auto";
    extra.style.maxHeight = "32%";
    extra.style.borderTop = "1px solid var(--border)";
    extra.innerHTML = `
      <div class="card">
        <h2>Routers registered <code>backend/app/main.py</code></h2>
        <p>${C.system.routers.map((r) => `<code>${escapeHtml(r)}</code>`).join(" ")}</p>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Dev deployment</h2><p>${escapeHtml(C.system.deployment.dev)}</p></div>
        <div class="card"><h2>Prod deployment</h2><p>${escapeHtml(C.system.deployment.prod)}</p></div>
        <div class="card"><h2>Health checks</h2><p>${escapeHtml(C.system.deployment.healthchecks)}</p></div>
      </div>
    `;
    view.appendChild(extra);
  };

  Views.dfd = function (view) {
    const d = C.dfd;
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(d.title)}</h1>
        <p>${escapeHtml(d.purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(d.scope)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ selectHtml: true, workspaceEl: ws });
    const select = toolbar.querySelector("#tbSelect");
    d.levels.forEach((l) => { const opt = document.createElement("option"); opt.value = l.id; opt.textContent = l.label; select.appendChild(opt); });

    const body = document.createElement("div");
    body.className = "diagram-body";
    const canvasWrap = document.createElement("div"); canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div"); canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(canvasWrap); body.appendChild(info.el);
    ws.appendChild(toolbar); ws.appendChild(body);

    const noteBox = document.createElement("div");
    ws.appendChild(noteBox);

    async function renderLevel(levelId) {
      const lvl = d.levels.find((l) => l.id === levelId) || d.levels[0];
      noteBox.outerHTML = `<div class="note-box" id="dfdNote"><strong>${escapeHtml(lvl.label)}:</strong> ${escapeHtml(lvl.note)}</div>`;
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[levelId].raw, levelId);
      if (!svgEl) return;
      Viewer.setActive("dfd", levelId, canvas);
      wireFlowchartInteractivity(svgEl, levelId, (nodeInfo) => info.render(renderComponentInfo(nodeInfo, {})));
    }
    select.addEventListener("change", () => renderLevel(select.value));
    Viewer.setRerenderFn(() => renderLevel(select.value));
    renderLevel(d.levels[0].id);
  };

  Views.sequence = function (view) {
    const d = C.sequence;
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(d.title)}</h1>
        <p>${escapeHtml(d.purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(d.scope)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ workspaceEl: ws });
    const body = document.createElement("div");
    body.className = "diagram-body";
    const list = document.createElement("div");
    list.className = "sequence-steps-panel";
    d.workflows.forEach((w, i) => {
      const item = document.createElement("div");
      item.className = "seq-item" + (i === 0 ? " active" : "");
      item.dataset.id = w.id;
      item.innerHTML = `<div class="si-title">${escapeHtml(w.label)}</div><div class="si-source">${escapeHtml(w.source)}</div>`;
      item.addEventListener("click", () => { select(w.id); });
      list.appendChild(item);
    });
    const canvasWrap = document.createElement("div"); canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div"); canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(list); body.appendChild(canvasWrap); body.appendChild(info.el);
    ws.appendChild(toolbar); ws.appendChild(body);
    const noteWrap = document.createElement("div");
    ws.appendChild(noteWrap);

    async function select(id) {
      list.querySelectorAll(".seq-item").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
      const w = d.workflows.find((x) => x.id === id);
      noteWrap.innerHTML = `<div class="note-box">${escapeHtml(w.note)}</div>`;
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[id].raw, id);
      Viewer.setActive("sequence", id, canvas);
      if (svgEl) wireSequenceInteractivity(svgEl, id, info);
    }
    function wireSequenceInteractivity(svgEl, id, info) {
      const diag = G.diagrams[id];
      const actorEls = Array.from(svgEl.querySelectorAll(".actor"));
      actorEls.forEach((g) => {
        g.style.cursor = "pointer";
        g.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const text = (g.querySelector("text") && g.querySelector("text").textContent) || "participant";
          info.render(`<h3 class="ip-title">${escapeHtml(text)}</h3><div class="ip-type">Actor / Participant</div><p style="font-size:13px;color:var(--text-muted)">Click a message step on the left panel's note, or pan/zoom to inspect this actor's interactions in the diagram.</p>`);
        });
      });
      // Expand/scroll-to for workflow steps: step through message groups in order
      const msgEls = Array.from(svgEl.querySelectorAll(".messageText, text.messageText"));
      if (msgEls.length) {
        const existing = ws.querySelector("#seqStepStrip");
        if (existing) existing.remove();
      }
    }
    Viewer.setRerenderFn(() => select(list.querySelector(".seq-item.active").dataset.id));
    select(d.workflows[0].id);
  };

  Views.process = function (view) {
    const d = C.process;
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(d.title)}</h1>
        <p>${escapeHtml(d.purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(d.scope)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ workspaceEl: ws });
    const body = document.createElement("div");
    body.className = "diagram-body";
    const list = document.createElement("div");
    list.className = "list-panel";
    d.flows.forEach((f, i) => {
      const item = document.createElement("div");
      item.className = "lp-item" + (i === 0 ? " active" : "");
      item.dataset.id = f.id;
      item.textContent = f.label;
      item.addEventListener("click", () => select(f.id));
      list.appendChild(item);
    });
    const canvasWrap = document.createElement("div"); canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div"); canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(list); body.appendChild(canvasWrap); body.appendChild(info.el);
    ws.appendChild(toolbar); ws.appendChild(body);
    const legend = document.createElement("div");
    legend.className = "note-box";
    legend.innerHTML = `<strong>Legend:</strong> diamond = decision point &nbsp;·&nbsp; <span style="color:var(--success)">green outline</span> = success/terminal path &nbsp;·&nbsp; <span style="color:var(--danger)">red outline</span> = failure/rejection path`;
    ws.appendChild(legend);
    const noteWrap = document.createElement("div");
    ws.appendChild(noteWrap);

    async function select(id) {
      list.querySelectorAll(".lp-item").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
      const f = d.flows.find((x) => x.id === id);
      noteWrap.innerHTML = `<div class="note-box${/not identified|requires clarification/i.test(f.note) ? " danger" : ""}"><strong>${escapeHtml(f.label)}</strong><br>Source: <code>${escapeHtml(f.source)}</code><br>${escapeHtml(f.note)}</div>`;
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[id].raw, id);
      Viewer.setActive("process", id, canvas);
      if (svgEl) {
        decorateProcessFlow(svgEl);
        wireFlowchartInteractivity(svgEl, id, (nodeInfo) => info.render(renderComponentInfo(nodeInfo, {})));
      }
    }
    Viewer.setRerenderFn(() => select(list.querySelector(".lp-item.active").dataset.id));
    select(d.flows[0].id);
  };

  Views.erd = function (view) {
    const d = C.erd;
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(d.title)}</h1>
        <p>${escapeHtml(d.purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(d.scope)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ selectHtml: true, workspaceEl: ws });
    const select = toolbar.querySelector("#tbSelect");
    d.diagrams.forEach((l) => { const opt = document.createElement("option"); opt.value = l.id; opt.textContent = l.label; select.appendChild(opt); });
    const searchGroup = document.createElement("div");
    searchGroup.className = "toolbar-group";
    searchGroup.innerHTML = `<input type="text" class="toolbar-select" id="erSearch" placeholder="Search table…" style="width:180px" />`;
    toolbar.insertBefore(searchGroup, toolbar.querySelector(".toolbar-spacer"));

    const body = document.createElement("div");
    body.className = "diagram-body";
    const list = document.createElement("div");
    list.className = "list-panel";
    list.id = "erEntityList";
    const canvasWrap = document.createElement("div"); canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div"); canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(list); body.appendChild(canvasWrap); body.appendChild(info.el);
    ws.appendChild(toolbar); ws.appendChild(body);
    const note = document.createElement("div");
    note.className = "note-box";
    note.innerHTML = `RLS-exempt tables (resolved before a tenant context can exist): ${d.rlsExempt.map((t) => `<code>${t}</code>`).join(", ")} — ${escapeHtml(d.rlsExemptNote)}`;
    ws.appendChild(note);

    let byKeyCurrent = {};
    function populateList(diagramId) {
      list.innerHTML = "";
      const diag = G.diagrams[diagramId];
      const names = Object.keys(G.erEntities).filter((n) => diag.raw.includes(n)).sort();
      names.forEach((n) => {
        const item = document.createElement("div");
        item.className = "lp-item";
        item.textContent = n;
        item.dataset.name = n;
        item.addEventListener("click", () => { selectEntity(n, byKeyCurrent); info.render(renderEntityInfo(n)); markListActive(n); });
        list.appendChild(item);
      });
    }
    function markListActive(name) {
      list.querySelectorAll(".lp-item").forEach((el) => el.classList.toggle("active", el.dataset.name === name));
    }

    async function renderDiagram(id) {
      populateList(id);
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[id].raw, id);
      Viewer.setActive("erd", id, canvas);
      if (svgEl) {
        byKeyCurrent = wireErInteractivity(svgEl, (key) => { info.render(renderEntityInfo(key)); markListActive(key); });
      }
    }
    select.addEventListener("change", () => renderDiagram(select.value));
    toolbar.querySelector("#erSearch").addEventListener("input", (e) => {
      const q = e.target.value.trim().toUpperCase();
      list.querySelectorAll(".lp-item").forEach((el) => {
        el.style.display = !q || el.dataset.name.includes(q) ? "" : "none";
      });
      if (q && byKeyCurrent[q]) { selectEntity(q, byKeyCurrent); info.render(renderEntityInfo(q)); markListActive(q); }
    });
    Viewer.setRerenderFn(() => renderDiagram(select.value));
    renderDiagram(d.diagrams[0].id);
  };

  Views.usecase = function (view) {
    const d = C.usecase;
    view.innerHTML = `
      <div class="view-header">
        <h1>${escapeHtml(d.title)}</h1>
        <p>${escapeHtml(d.purpose)}</p>
        <div class="meta-row"><span class="meta-chip">${escapeHtml(d.scope)}</span><span class="meta-chip">${escapeHtml(d.notation)}</span></div>
      </div>
      <div class="diagram-workspace" id="ws"></div>
    `;
    const ws = view.querySelector("#ws");
    const toolbar = buildToolbar({ selectHtml: true, workspaceEl: ws });
    const select = toolbar.querySelector("#tbSelect");
    [{ id: "usecase-overview", label: "Overview — Actors × Major Modules" }, d.detailDiagram].forEach((l) => {
      const opt = document.createElement("option"); opt.value = l.id; opt.textContent = l.label; select.appendChild(opt);
    });
    const body = document.createElement("div");
    body.className = "diagram-body";
    const list = document.createElement("div");
    list.className = "list-panel";
    d.actors.forEach((a) => {
      const item = document.createElement("div");
      item.className = "lp-item";
      item.textContent = a.name;
      item.addEventListener("click", () => {
        info.render(`<h3 class="ip-title">${escapeHtml(a.name)}</h3><div class="ip-type">Actor</div><div class="ip-field"><label>Source</label><div class="val"><code>${escapeHtml(a.source)}</code></div></div><div class="ip-field"><label>Description</label><div class="val">${escapeHtml(a.desc)}</div></div>`);
      });
      list.appendChild(item);
    });
    const canvasWrap = document.createElement("div"); canvasWrap.className = "diagram-canvas-wrap";
    const canvas = document.createElement("div"); canvas.className = "diagram-canvas";
    canvasWrap.appendChild(canvas);
    const info = makeInfoPanel();
    body.appendChild(list); body.appendChild(canvasWrap); body.appendChild(info.el);
    ws.appendChild(toolbar); ws.appendChild(body);

    async function render(id) {
      const svgEl = await Viewer.renderInto(canvas, G.diagrams[id].raw, id);
      Viewer.setActive("usecase", id, canvas);
      if (svgEl) wireFlowchartInteractivity(svgEl, id, (nodeInfo) => info.render(renderComponentInfo(nodeInfo, {})));
    }
    select.addEventListener("change", () => render(select.value));
    Viewer.setRerenderFn(() => render(select.value));
    render("usecase-overview");
  };

  // ---------------------------------------------------------------- Global search
  let searchIndex = [];
  function buildSearchIndex() {
    const items = [];
    C.overview.docIndex.forEach((d) => items.push({ name: d.label, type: "Document", section: d.id, desc: d.desc }));
    Object.keys(C.system.componentDocs).forEach((k) => items.push({ name: k, type: "Component", section: "system", desc: C.system.componentDocs[k].notes, diagramKey: C.system.diagram }));
    C.dfd.levels.forEach((l) => items.push({ name: l.label, type: "DFD Level", section: "dfd", desc: l.note, diagramKey: l.id }));
    C.sequence.workflows.forEach((w) => items.push({ name: w.label, type: "Sequence", section: "sequence", desc: w.note, diagramKey: w.id }));
    C.process.flows.forEach((f) => items.push({ name: f.label, type: "Flowchart", section: "process", desc: f.note, diagramKey: f.id }));
    C.usecase.actors.forEach((a) => items.push({ name: a.name, type: "Actor", section: "usecase", desc: a.desc }));
    Object.keys(G.erEntities).forEach((name) => items.push({ name, type: "Table", section: "erd", desc: `${G.erEntities[name].columns.length} columns`, entityKey: name }));
    // auto node labels from generated data (flowchart/sequence) for broader recall
    Object.keys(G.diagrams).forEach((key) => {
      const diag = G.diagrams[key];
      diag.nodes.forEach((n) => {
        if (n.label && n.label.length > 1) items.push({ name: n.label.split(" ").slice(0, 8).join(" "), type: "Diagram element", section: null, desc: "In " + key, diagramKey: key });
      });
    });
    searchIndex = items;
  }

  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return searchIndex.filter((it) => it.name.toLowerCase().includes(q) || (it.desc || "").toLowerCase().includes(q)).slice(0, 24);
  }

  function wireSearch() {
    const input = document.getElementById("globalSearch");
    const results = document.getElementById("searchResults");
    let activeIdx = -1;
    function renderResults(list) {
      if (!list.length) { results.innerHTML = `<div class="search-empty">No matches</div>`; results.classList.add("open"); return; }
      results.innerHTML = list.map((it, i) => `<div class="search-result-item" data-i="${i}"><div class="srl-title">${escapeHtml(it.name)}</div><div class="srl-meta">${escapeHtml(it.type)}${it.desc ? " — " + escapeHtml(it.desc) : ""}</div></div>`).join("");
      results.classList.add("open");
      activeIdx = -1;
      Array.from(results.children).forEach((el, i) => el.addEventListener("click", () => selectResult(list[i])));
    }
    function selectResult(it) {
      results.classList.remove("open");
      input.value = "";
      const sec = it.section || Object.keys(C.sections).length && (findSectionForDiagram(it.diagramKey) || it.section);
      if (sec) {
        showSection(sec);
        const navBtn = document.querySelector(`.nav-item[data-section="${sec}"]`);
        if (navBtn) navBtn.click();
      }
    }
    function findSectionForDiagram(diagramKey) {
      if (!diagramKey) return null;
      if (diagramKey === C.system.diagram) return "system";
      if (C.dfd.levels.some((l) => l.id === diagramKey)) return "dfd";
      if (C.sequence.workflows.some((w) => w.id === diagramKey)) return "sequence";
      if (C.process.flows.some((f) => f.id === diagramKey)) return "process";
      if (diagramKey.startsWith("erd-")) return "erd";
      if (diagramKey.startsWith("usecase-")) return "usecase";
      return null;
    }
    let currentList = [];
    input.addEventListener("input", () => { currentList = runSearch(input.value); renderResults(currentList); });
    input.addEventListener("focus", () => { if (input.value.trim()) renderResults(currentList); });
    input.addEventListener("keydown", (e) => {
      const items = Array.from(results.children);
      if (e.key === "ArrowDown") { activeIdx = Math.min(items.length - 1, activeIdx + 1); updateActive(items); e.preventDefault(); }
      else if (e.key === "ArrowUp") { activeIdx = Math.max(0, activeIdx - 1); updateActive(items); e.preventDefault(); }
      else if (e.key === "Enter" && activeIdx >= 0 && currentList[activeIdx]) { selectResult(currentList[activeIdx]); }
      else if (e.key === "Escape") { results.classList.remove("open"); }
    });
    function updateActive(items) { items.forEach((el, i) => el.classList.toggle("active", i === activeIdx)); }
    document.addEventListener("click", (e) => { if (!e.target.closest(".topnav-search")) results.classList.remove("open"); });
  }

  // ---------------------------------------------------------------- Top-level wiring
  function wireTopnav() {
    document.getElementById("btnTheme").addEventListener("click", toggleTheme);
    document.getElementById("btnFullscreen").addEventListener("click", () => {
      const ws = document.querySelector(".view.active .diagram-workspace");
      if (ws) Viewer.toggleFullscreen(ws);
    });
    document.getElementById("btnExportSvg").addEventListener("click", () => Viewer.exportSvg());
    document.getElementById("btnExportPng").addEventListener("click", () => Viewer.exportPng());
    document.getElementById("btnPrint").addEventListener("click", () => {
      document.querySelectorAll(".view").forEach((v) => { if (!v.dataset.rendered) { v.dataset.rendered = "1"; const id = v.id.replace("view-", ""); Views[id] && Views[id](v); } });
      setTimeout(() => window.print(), 300);
    });
    document.getElementById("menuToggle").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
      document.getElementById("sidebarScrim").classList.toggle("open");
    });
    document.getElementById("sidebarScrim").addEventListener("click", closeMobileSidebar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const fsWs = document.querySelector(".diagram-workspace.is-fullscreen");
        if (fsWs) fsWs.classList.remove("is-fullscreen");
      }
    });
  }

  function init() {
    initTheme();
    buildSidebar();
    buildViewShells();
    buildSearchIndex();
    wireSearch();
    wireTopnav();
    showSection("overview");
    document.querySelector('.nav-item[data-section="overview"]').classList.add("active");
    // Optional deep link: ?gotoSection=system|dfd|sequence|process|erd|usecase
    // opens directly to that section instead of the Overview landing page.
    const gotoMatch = location.search.match(/[?&]gotoSection=([a-z]+)/);
    if (gotoMatch && document.querySelector(`.nav-item[data-section="${gotoMatch[1]}"]`)) {
      document.querySelector(`.nav-item[data-section="${gotoMatch[1]}"]`).click();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
