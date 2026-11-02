import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

// Searchable multi-select dropdown. options: [{ value, label, group? }]
export default function Combobox({ options, value = [], onChange, placeholder = 'Search…', label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const input = useRef(null);
  const list = useMemo(() => options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 80), [options, q]);
  useEffect(() => {
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  useEffect(() => setActive(0), [q]);
  const toggle = (v) => { onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]); setQ(''); input.current?.focus(); };
  const name = (v) => options.find((o) => o.value === v)?.label || v;
  return (
    <div className="combo" ref={box}>
      <div className="combo-field" onClick={() => { setOpen(true); input.current?.focus(); }}>
        {value.map((v) => (
          <span key={v} className="combo-chip">{name(v)}
            <button type="button" aria-label={`Remove ${name(v)}`} onClick={(e) => { e.stopPropagation(); toggle(v); }}><X size={12} /></button>
          </span>
        ))}
        <input ref={input} value={q} aria-label={label} placeholder={value.length ? '' : placeholder} onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && list[active]) { e.preventDefault(); toggle(list[active].value); }
            if (e.key === 'Backspace' && !q && value.length) toggle(value[value.length - 1]);
            if (e.key === 'Escape') setOpen(false);
          }} />
        <ChevronDown size={16} className="mute" />
      </div>
      {open && (
        <div className="combo-list" role="listbox" aria-multiselectable="true">
          {list.length === 0 && <div className="combo-empty">No match</div>}
          {list.map((o, i) => (
            <div key={o.value} role="option" aria-selected={value.includes(o.value)} className={`combo-opt${i === active ? ' active' : ''}${o.group ? ' grouped' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); toggle(o.value); }} onMouseEnter={() => setActive(i)}>
              <span className="combo-box">{value.includes(o.value) ? '✓' : ''}</span>{o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
