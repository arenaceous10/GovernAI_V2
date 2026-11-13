import { useMemo, useState } from 'react';
import { lineageLayers } from '../engine/lineage.js';

// Lineage drawn in layers, left to right: the furthest sources, every table in between, the model's own inputs, the
// AI system, and where its outputs go. The layers come from the lineage read from Databricks when there is one;
// otherwise from the registered datasets and their source systems. Click a node to trace what feeds it and what it
// feeds. A dashed link marks a dataset whose lineage is not documented.
const NODE_W = 212; const NODE_H = 50; const GAP_Y = 14; const GAP_X = 64; const TOP = 34;
const colX = (i) => 10 + i * (NODE_W + GAP_X);
const curve = (x1, y1, x2, y2) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function label(n) {
  const d = n.dataset;
  if (n.kind === 'table') {
    const [cat, ...rest] = n.name.split('.');
    return { title: rest.join('.'), sub: d ? `${d.role || 'Dataset'}, ${String(d.classification || '').toLowerCase()}` : `${cat} · ${(n.type || 'table').toLowerCase().replace(/_/g, ' ')}` };
  }
  if (n.kind === 'path') {
    const m = n.name.match(/^([a-z0-9+.-]+):\/\/([^/]+)(\/.*)?$/i);
    return { title: m?.[3] ? m[3].replace(/^\//, '') : (m?.[2] || n.name), sub: m ? `Files: ${m[1]}://${m[2]}` : 'Files' };
  }
  if (n.kind === 'system') return { title: n.name, sub: 'Source system' };
  return { title: n.name, sub: d ? `${d.role || 'Dataset'}, ${String(d.classification || '').toLowerCase()}` : 'Dataset' };
}

function Node({ x, y, n, tone = 'plain', dim, sel, onPick }) {
  const { title, sub } = n.title ? n : label(n);
  const fill = { plain: '#FFFFFF', system: 'var(--accent)', out: 'var(--paper)', src: '#F4F6FA' }[tone];
  const ink = tone === 'system' ? '#FFFFFF' : 'var(--ink)';
  const d = n.dataset;
  const badges = d ? [{ t: 'C', ok: d.catalogued, label: d.catalogued ? 'In the catalog' : 'Not in the catalog' }, { t: 'Q', ok: d.qualityChecked, label: d.qualityChecked ? 'Quality checked' : 'No quality checks' }] : [];
  return (
    <g opacity={dim ? 0.25 : 1} style={onPick ? { cursor: 'pointer' } : undefined} onClick={onPick} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? `Trace ${n.name}` : undefined} onKeyDown={onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } : undefined}>
      <title>{n.name}</title>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={7} fill={fill} stroke={sel ? 'var(--blue, #2B59C3)' : tone === 'system' ? 'var(--accent)' : 'var(--line)'} strokeWidth={sel ? 2 : 1} />
      <text x={x + 10} y={y + 20} fontSize="12.5" fontWeight="600" fill={ink}>{cut(title, 29)}</text>
      {sub && <text x={x + 10} y={y + 37} fontSize="11" fill={tone === 'system' ? '#D8F3E9' : 'var(--mute)'}>{cut(sub, 34)}</text>}
      {badges.map((b, i) => (
        <g key={b.t}>
          <rect x={x + NODE_W - 8 - (i + 1) * 20} y={y - 7} width={16} height={14} rx={3} fill={b.ok ? '#E8F3EC' : '#FBE7E4'} stroke={b.ok ? '#2F7D4F' : '#B83A2E'} strokeWidth=".8" />
          <text x={x + NODE_W - (i + 1) * 20} y={y + 3.5} fontSize="9" fontWeight="700" textAnchor="middle" fill={b.ok ? '#2F7D4F' : '#B83A2E'}>{b.t}</text>
          <title>{b.label}</title>
        </g>
      ))}
    </g>
  );
}

export default function LineageGraph({ name, datasets = [], outputs = [], lineage = null }) {
  const g = useMemo(() => lineageLayers(lineage, datasets), [lineage, datasets]);
  const [sel, setSel] = useState(null);
  const k = g.columns.length;
  const sysCol = k; const outCol = k + 1;
  const rows = Math.max(1, outputs.length, ...g.columns.map((c) => c.length));
  const H = TOP + rows * (NODE_H + GAP_Y) + 10;
  const W = colX(outCol) + NODE_W + 10;
  const yAt = (i, n) => TOP + ((rows - n) * (NODE_H + GAP_Y)) / 2 + i * (NODE_H + GAP_Y);
  const pos = new Map();
  g.columns.forEach((c, ci) => c.forEach((n, i) => pos.set(n.key, { x: colX(ci), y: yAt(i, c.length) })));
  const sysY = yAt(0, 1);
  const inputs = g.columns[k - 1] || [];
  // Everything upstream and downstream of the selected node.
  const lit = useMemo(() => {
    if (!sel) return null;
    const set = new Set([sel]);
    const walk = (key, dir) => { for (const e of g.edges) { const [a, b] = dir === 'up' ? [e.toKey, e.fromKey] : [e.fromKey, e.toKey]; if (a === key && !set.has(b)) { set.add(b); walk(b, dir); } } };
    walk(sel, 'up'); walk(sel, 'down');
    return set;
  }, [sel, g]);
  const reachesModel = !lit || inputs.some((n) => lit.has(n.key));
  const documented = (n) => !n.dataset || n.dataset.lineage || g.edges.some((e) => e.toKey === n.key && n.kind === 'table');
  const heads = g.columns.map((_, i) => (i === k - 1 ? 'Model inputs' : i === 0 ? 'Original sources' : `${k - 1 - i} step${k - 1 - i === 1 ? '' : 's'} before the inputs`));
  return (
    <div className="lineage">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ minWidth: Math.min(W, 760) }} role="img" aria-label={`Data lineage for ${name}`}>
        {[...heads, 'AI system', 'Where outputs go'].map((c, i) => <text key={`${c}-${i}`} x={colX(i)} y={14} fontSize="11.5" fill="var(--mute)">{c}</text>)}
        {g.edges.map((e) => {
          const a = pos.get(e.fromKey); const b = pos.get(e.toKey);
          if (!a || !b) return null;
          const tn = g.columns.flat().find((n) => n.key === e.toKey);
          const ok = e.fromKey.startsWith('sys:') ? !!tn?.dataset?.lineage : true;
          return <path key={`${e.fromKey}>${e.toKey}`} d={curve(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2)} fill="none" strokeWidth="1.5"
            stroke={ok ? '#45A894' : '#D68A80'} strokeDasharray={ok ? undefined : '5 4'} opacity={lit && !(lit.has(e.fromKey) && lit.has(e.toKey)) ? 0.12 : 1} />;
        })}
        {inputs.map((n) => {
          const p = pos.get(n.key); const ok = documented(n);
          return <path key={`in-${n.key}`} d={curve(p.x + NODE_W, p.y + NODE_H / 2, colX(sysCol), sysY + NODE_H / 2)} fill="none" strokeWidth="1.5"
            stroke={ok ? '#45A894' : '#D68A80'} strokeDasharray={ok ? undefined : '5 4'} opacity={lit && !lit.has(n.key) ? 0.12 : 1} />;
        })}
        {outputs.map((o, i) => (
          <path key={o} d={curve(colX(sysCol) + NODE_W, sysY + NODE_H / 2, colX(outCol), yAt(i, outputs.length) + NODE_H / 2)} stroke="#9AA3B2" strokeWidth="1.5" fill="none" opacity={reachesModel ? 1 : 0.12} />
        ))}
        {g.columns.flatMap((c, ci) => c.map((n) => {
          const p = pos.get(n.key);
          return <Node key={n.key} x={p.x} y={p.y} n={n} tone={ci === 0 && k > 1 ? 'src' : 'plain'} dim={lit && !lit.has(n.key)} sel={sel === n.key}
            onPick={() => setSel(sel === n.key ? null : n.key)} />;
        }))}
        <Node x={colX(sysCol)} y={sysY} n={{ name: name || 'This AI system', title: name || 'This AI system', sub: 'Model or AI system' }} tone="system" dim={!reachesModel} />
        {outputs.map((o, i) => <Node key={o} x={colX(outCol)} y={yAt(i, outputs.length)} n={{ name: o, title: o }} tone="out" dim={!reachesModel} />)}
      </svg>
      <div className="row xs mute" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <span>Solid link: lineage recorded or documented</span><span>Dashed link: lineage not documented</span>
        <span>C: in the catalog</span><span>Q: quality rules run</span>{g.tables > 0 && <span>Click a table to trace it{sel ? ' (click again to clear)' : ''}</span>}
      </div>
    </div>
  );
}
