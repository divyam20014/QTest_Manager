#!/usr/bin/env node
// One-off build script: parses docs/architecture/diagrams/*.mmd into a static
// JSON data file consumed client-side by architecture_documentation/index.html.
// Run once at authoring time; the shipped portal needs no Node/build step.
"use strict";
const fs = require("fs");
const path = require("path");

const DIAG_DIR = process.argv[2];
const OUT_FILE = process.argv[3];

const files = fs.readdirSync(DIAG_DIR).filter((f) => f.endsWith(".mmd"));

const diagrams = {}; // key -> { raw, type, nodes: [{id,label}], edges: [{from,to,label}] }
const erEntities = {}; // ENTITY_NAME -> { columns: [{name,type,key,note}] }
const erRelationships = []; // {from,to,label,cardinality}

function stripQuotes(s) {
  return s.replace(/^"+|"+$/g, "").trim();
}

for (const file of files) {
  const key = file.replace(/\.mmd$/, "");
  const raw = fs.readFileSync(path.join(DIAG_DIR, file), "utf8");
  const firstCodeLine = raw.split("\n").find((l) => l.trim().length > 0 && !l.trim().startsWith("%%")) || "";
  let type = "flowchart";
  if (/^erDiagram/.test(firstCodeLine.trim())) type = "er";
  else if (/^sequenceDiagram/.test(firstCodeLine.trim())) type = "sequence";
  else if (/^flowchart/.test(firstCodeLine.trim())) type = "flowchart";

  const nodes = [];
  const edges = [];
  const seenNodeIds = new Set();

  if (type === "flowchart") {
    // Node declarations: ID["label"] , ID(["label"]) , ID{"label"} , ID(("label"))
    const nodeRe = /([A-Za-z_][A-Za-z0-9_]*)(\(\(|\(\[|\{|\[)("(?:[^"]|\\")*"|[^\]\)\}]+)(\)\)|\]\)|\}|\])/g;
    let m;
    while ((m = nodeRe.exec(raw)) !== null) {
      const id = m[1];
      if (["classDef", "class", "subgraph", "end", "flowchart", "style"].includes(id)) continue;
      let label = m[3];
      label = stripQuotes(label).replace(/\\n/g, " ").replace(/<br\s*\/?>/gi, " ");
      if (!seenNodeIds.has(id)) {
        seenNodeIds.add(id);
        nodes.push({ id, label });
      }
    }
    // subgraph titles also useful as group labels - skip for now, not needed per-node
    // Edges: A -- "label" --> B   or  A -.label.-> B  or A --> B  or A -->|label| B
    const edgeRe = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:--+|-\.+)\s*(?:"([^"]*)"|\|([^|]*)\|)?\s*(?:--+>|-\.+>|--+|-\.+)\s*([A-Za-z_][A-Za-z0-9_]*)/g;
    let e;
    while ((e = edgeRe.exec(raw)) !== null) {
      const from = e[1];
      const to = e[4];
      const label = (e[2] || e[3] || "").replace(/\\n/g, " ").trim();
      if (seenNodeIds.has(from) || seenNodeIds.has(to)) {
        edges.push({ from, to, label });
      }
    }
    // Handle "A & B --> C" and "A --> B & C" compound edges (used in usecase diagrams)
    const compoundRe = /([A-Za-z_][A-Za-z0-9_]*(?:\s*&\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*-->\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*&\s*[A-Za-z_][A-Za-z0-9_]*)+)/g;
    let c;
    while ((c = compoundRe.exec(raw)) !== null) {
      const froms = c[1].split("&").map((s) => s.trim());
      const tos = c[2].split("&").map((s) => s.trim());
      for (const f of froms) for (const t of tos) edges.push({ from: f, to: t, label: "" });
    }
  } else if (type === "sequence") {
    const partRe = /(?:actor|participant)\s+([A-Za-z_][A-Za-z0-9_]*)\s+as\s+(.+)/g;
    let m;
    while ((m = partRe.exec(raw)) !== null) {
      nodes.push({ id: m[1], label: m[2].replace(/\\n/g, " ").trim() });
    }
  } else if (type === "er") {
    // Relationship lines: ENTITY1 ||--o{ ENTITY2 : "label"
    const relRe = /^\s*([A-Z_][A-Z0-9_]*)\s+([|o}{.\-]+)\s+([A-Z_][A-Z0-9_]*)\s*:\s*"([^"]*)"/gm;
    let r;
    while ((r = relRe.exec(raw)) !== null) {
      erRelationships.push({ from: r[1], to: r[3], cardinality: r[2], label: r[4] });
    }
    // Attribute blocks: ENTITY_NAME {\n  type name "note"\n  ...\n}
    const blockRe = /([A-Z_][A-Z0-9_]*)\s*\{([^}]*)\}/g;
    let b;
    while ((b = blockRe.exec(raw)) !== null) {
      const entityName = b[1];
      const bodyLines = b[2].split("\n").map((l) => l.trim()).filter(Boolean);
      const columns = [];
      for (const line of bodyLines) {
        const colRe = /^(\S+)\s+(\S+)(\s+(PK|FK|UK|PK_FK))?(\s+"([^"]*)")?/;
        const cm = line.match(colRe);
        if (cm) {
          columns.push({
            type: cm[1],
            name: cm[2],
            key: cm[4] || "",
            note: cm[6] || "",
          });
        }
      }
      erEntities[entityName] = { columns };
    }
  }

  diagrams[key] = { file, type, nodes, edges, raw };
}

const out = { diagrams, erEntities, erRelationships };
fs.writeFileSync(OUT_FILE, "window.QTH_GENERATED = " + JSON.stringify(out, null, 0) + ";\n");
console.log("Wrote", OUT_FILE);
console.log("Diagrams parsed:", Object.keys(diagrams).length);
console.log("ER entities parsed:", Object.keys(erEntities).length);
console.log("ER relationships parsed:", erRelationships.length);
let totalNodes = 0, totalEdges = 0;
for (const k of Object.keys(diagrams)) { totalNodes += diagrams[k].nodes.length; totalEdges += diagrams[k].edges.length; }
console.log("Total flowchart/sequence nodes:", totalNodes, "edges:", totalEdges);
