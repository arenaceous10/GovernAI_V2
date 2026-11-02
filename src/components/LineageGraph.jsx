// Source systems -> datasets -> AI system -> outputs. Dashed links mark lineage that is not documented.
const COLS = ['Source systems', 'Datasets', 'AI system', 'Where outputs go'];
const W = 980; const NODE_W = 196; const NODE_H = 50; const GAP = 16; const TOP = 34;

function col(i) { return 10 + i * ((W - NODE_W - 20) / 3); }

function Node({ x, y, title, sub, tone = 'plain', badges = [] }) {
  const fill = { plain: '#FFFFFF', system: '#3A46C9', out: '#F3F5F7' }[tone];
  const ink = tone === 'system' ? '#FFFFFF' : '#1B2232';
  return (
    <g>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={7} fill={fill} stroke={tone === 'system' ? '#3A46C9' : '#C9D0DA'} />
      <text x={x + 10} y={y + 20} fontSize="12.5" fontWeight="600" fill={ink}>{title.length > 27 ? `${title.slice(0, 26)}…` : title}</text>
      {sub && <text x={x + 10} y={y + 37} fontSize="11" fill={tone === 'system' ? '#DDE1FA' : '#5A6478'}>{sub.length > 32 ? `${sub.slice(0, 31)}…` : sub}</text>}
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

const curve = (x1, y1, x2, y2) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;

export default function LineageGraph({ name, datasets = [], outputs = [] }) {
  const sources = [...new Set(datasets.map((d) => d.sourceSystem || 'Unknown source'))];
  const rows = Math.max(sources.length, datasets.length, outputs.length, 1);
  const H = TOP + rows * (NODE_H + GAP) + 10;
  const yAt = (i, n) => TOP + ((rows - n) * (NODE_H + GAP)) / 2 + i * (NODE_H + GAP);
  const sy = Object.fromEntries(sources.map((s, i) => [s, yAt(i, sources.length)]));
  const sysY = yAt(0, 1);
  return (
    <div className="lineage">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Data lineage for ${name}`}>
        {COLS.map((c, i) => <text key={c} x={col(i)} y={14} fontSize="11.5" fill="#5A6478">{c}</text>)}
        {datasets.map((d, i) => {
          const y = yAt(i, datasets.length) + NODE_H / 2;
          const dash = d.lineage ? undefined : '5 4';
          return (
            <g key={d.id} fill="none" strokeWidth="1.5">
              <path d={curve(col(0) + NODE_W, sy[d.sourceSystem || 'Unknown source'] + NODE_H / 2, col(1), y)} stroke={d.lineage ? '#7C86D9' : '#D68A80'} strokeDasharray={dash} />
              <path d={curve(col(1) + NODE_W, y, col(2), sysY + NODE_H / 2)} stroke={d.lineage ? '#7C86D9' : '#D68A80'} strokeDasharray={dash} />
            </g>
          );
        })}
        {outputs.map((o, i) => (
          <path key={o} d={curve(col(2) + NODE_W, sysY + NODE_H / 2, col(3), yAt(i, outputs.length) + NODE_H / 2)} stroke="#9AA3B2" strokeWidth="1.5" fill="none" />
        ))}
        {sources.map((s) => <Node key={s} x={col(0)} y={sy[s]} title={s} sub="Source system" />)}
        {datasets.map((d, i) => (
          <Node key={d.id} x={col(1)} y={yAt(i, datasets.length)} title={d.name} sub={`${d.role}, ${d.classification.toLowerCase()}`}
            badges={[{ t: 'C', ok: d.catalogued, label: d.catalogued ? 'In the catalog' : 'Not in the catalog' }, { t: 'Q', ok: d.qualityChecked, label: d.qualityChecked ? 'Quality checked' : 'No quality checks' }]} />
        ))}
        <Node x={col(2)} y={sysY} title={name || 'This AI system'} sub="Model or AI system" tone="system" />
        {outputs.map((o, i) => <Node key={o} x={col(3)} y={yAt(i, outputs.length)} title={o} tone="out" />)}
      </svg>
      <div className="row xs mute" style={{ marginTop: 8 }}>
        <span>Solid link: lineage documented</span><span>Dashed link: lineage not documented</span>
        <span>C: in the catalog</span><span>Q: quality rules run</span>
      </div>
    </div>
  );
}
