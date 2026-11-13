// Lineage that GovernAI builds itself from Databricks: where the walk starts, what is stored, and how the result is
// laid out in layers for the graph. Pure functions: no React, no storage, no network.
import { trainingTables } from './governance.js';

const TABLE = /^[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}\.[A-Za-z0-9_-]{1,255}$/;
const isTable = (t) => typeof t === 'string' && t.length <= 220 && TABLE.test(t);

// Where the walk starts: the tables the model version in use was trained on (from its training run and the model
// version's dependencies), tables already registered from the catalog, and any table names the user adds.
export function lineageRoots(x, extra = []) {
  if (!x) return [];
  const fromModel = trainingTables(x.connector).tables.map((t) => t.name);
  const registered = (x.datasets || []).map((d) => d.uc?.name);
  return [...new Set([...fromModel, ...registered, ...(extra || [])].filter(isTable))].sort().slice(0, 30);
}

// What is kept on the product: names only, cut to size, and no edge that points at a table that was left out.
export function cleanLineage(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const nodes = [];
  const seen = new Set();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (nodes.length >= 150) break;
    if (!n || typeof n.name !== 'string' || !n.name || n.name.length > 220 || seen.has(n.name)) continue;
    if (n.kind === 'table' ? !isTable(n.name) : n.kind !== 'path') continue;
    seen.add(n.name);
    nodes.push({ name: n.name, kind: n.kind, type: typeof n.type === 'string' ? n.type.slice(0, 30) : '' });
  }
  const edges = [];
  const eseen = new Set();
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    if (edges.length >= 500) break;
    if (!e || !seen.has(e.from) || !seen.has(e.to) || e.from === e.to || eseen.has(`${e.from}\n${e.to}`)) continue;
    eseen.add(`${e.from}\n${e.to}`);
    edges.push({ from: e.from, to: e.to });
  }
  return {
    readAt: now, roots: (Array.isArray(raw.roots) ? raw.roots : []).filter(isTable).slice(0, 30), nodes, edges,
    layers: Number.isInteger(raw.layers) && raw.layers >= 0 ? Math.min(raw.layers, 50) : 0,
    truncated: ['depth', 'size', 'time'].includes(raw.truncated) ? raw.truncated : null,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 60) : '',
    notes: (Array.isArray(raw.notes) ? raw.notes : []).filter((n) => typeof n === 'string').slice(0, 5).map((n) => n.slice(0, 300)),
  };
}

// Layers for the graph, left to right: the furthest sources first, the model's own inputs last (the AI system and
// its outputs are drawn after them). A node's layer is its longest path to a model input, so a table never sits to
// the right of something it feeds. A link that closes a cycle is left out of the drawing.
// Returns { columns: [[{ key, name, kind, type, dataset }]], edges: [{ from, to, fromKey, toKey }], tables, layers }.
export function lineageLayers(lineage, datasets = []) {
  const nodes = new Map();   // key -> node
  const down = new Map();    // key -> Set of keys it feeds
  const up = new Map();      // key -> Set of keys it is built from
  const link = (a, b) => { (down.get(a) || down.set(a, new Set()).get(a)).add(b); (up.get(b) || up.set(b, new Set()).get(b)).add(a); };
  for (const n of lineage?.nodes || []) nodes.set(n.name, { key: n.name, name: n.name, kind: n.kind, type: n.type || '', dataset: null });
  for (const e of lineage?.edges || []) if (nodes.has(e.from) && nodes.has(e.to)) link(e.from, e.to);
  const roots = new Set((lineage?.roots || []).filter((r) => nodes.has(r)));
  for (const d of datasets || []) {
    const t = d.uc?.name;
    if (t && nodes.has(t)) { nodes.get(t).dataset = d; roots.add(t); continue; }
    // A dataset typed by hand, or a catalog table not in the walk: an input in its own right, fed by its source system.
    const key = `ds:${d.id || d.name}`;
    nodes.set(key, { key, name: t || d.name || 'Unnamed dataset', kind: 'dataset', type: '', dataset: d });
    roots.add(key);
    const sys = `sys:${d.sourceSystem || 'Unknown source'}`;
    if (!nodes.has(sys)) nodes.set(sys, { key: sys, name: d.sourceSystem || 'Unknown source', kind: 'system', type: '', dataset: null });
    link(sys, key);
  }
  // Drop the links that close a cycle (found walking upstream from the inputs), then take the longest path.
  const state = new Map(); const dropped = new Set();
  const visit = (k) => {
    state.set(k, 1);
    for (const s of up.get(k) || []) {
      if (state.get(s) === 1) dropped.add(`${s}\n${k}`);
      else if (!state.has(s)) visit(s);
    }
    state.set(k, 2);
  };
  for (const r of roots) if (!state.has(r)) visit(r);
  const dist = new Map();
  const distOf = (k) => {
    if (dist.has(k)) return dist.get(k);
    dist.set(k, roots.has(k) ? 0 : -1);   // placeholder while its targets are worked out
    let best = roots.has(k) ? 0 : -1;
    for (const t of down.get(k) || []) { if (dropped.has(`${k}\n${t}`)) continue; const d = distOf(t); if (d >= 0) best = Math.max(best, d + 1); }
    dist.set(k, best);
    return best;
  };
  for (const k of nodes.keys()) distOf(k);
  const placed = [...nodes.values()].filter((n) => dist.get(n.key) >= 0);
  const max = placed.reduce((m, n) => Math.max(m, dist.get(n.key)), -1);
  const columns = Array.from({ length: max + 1 }, () => []);
  for (const n of placed) columns[max - dist.get(n.key)].push(n);
  for (const c of columns) c.sort((a, b) => a.name.localeCompare(b.name));
  const edges = [];
  for (const [a, set] of down) for (const b of set) {
    if (dropped.has(`${a}\n${b}`) || !(dist.get(a) > dist.get(b)) || dist.get(b) < 0) continue;
    edges.push({ from: nodes.get(a).name, to: nodes.get(b).name, fromKey: a, toKey: b });
  }
  return { columns, edges, tables: placed.filter((n) => n.kind === 'table').length, layers: columns.length };
}
