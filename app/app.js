// Traffic Light Efficiency Model: user interface (React + htm, no build step).
// All modelling lives in engine.js; this file only drives it and draws results.
import * as E from './engine.js';

const { useState, useEffect, useMemo, useRef, useCallback } = React;
const html = htm.bind(React.createElement);

const TABS = [
  { id: 'capacity', label: 'Capacity' },
  { id: 'simulate', label: 'Simulation' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'method', label: 'Method' },
];

const fmt = (x, d = 1) => (x == null || !isFinite(x) ? '–' : x.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (x, d = 1) => (x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + fmt(Math.abs(x), d));
const clone = o => JSON.parse(JSON.stringify(o));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Yield to the browser about every 40 ms of work. MessageChannel is not throttled in
// background tabs the way setTimeout is.
let lastYield = 0;
function pause() { return new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); }); }
async function breathe(force) {
  if (!force && performance.now() - lastYield < 40) return false;
  await pause(); lastYield = performance.now(); return true;
}

function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

// Re-render on theme changes so canvas colours follow.
function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setK(x => x + 1);
    mq.addEventListener?.('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener?.('change', bump); mo.disconnect(); };
  }, []);
  return k;
}

// ---------------------------------------------------------------------------
// Inputs

function Field({ id, label, value, onChange, min, max, step = 1, unit, slider = true }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = v => {
    const n = Number(v);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  };
  return html`<div class="field">
    <label for=${id}>${label}</label>
    <span class="val">
      <input type="number" id=${id} value=${text} min=${min} max=${max} step=${step}
        onInput=${e => { setText(e.target.value); if (e.target.value !== '') commit(e.target.value); }}
        onBlur=${() => setText(String(value))} />
      ${unit && html`<span class="unit">${unit}</span>`}
    </span>
    ${slider && html`<input type="range" id=${id + '-r'} aria-label=${label} min=${min} max=${max} step=${step} value=${value}
      onInput=${e => commit(e.target.value)} />`}
  </div>`;
}

function Select({ id, label, value, options, onChange }) {
  return html`<div class="field">
    <label for=${id}>${label}</label>
    <select id=${id} value=${value} onChange=${e => onChange(e.target.value)}>
      ${options.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
    </select>
  </div>`;
}

function Check({ id, label, checked, onChange }) {
  return html`<label class="check" for=${id}><input type="checkbox" id=${id} checked=${checked} onChange=${e => onChange(e.target.checked)} />${label}</label>`;
}

function Seg({ value, options, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>
    ${options.map(([v, l]) => html`<button key=${v} aria-pressed=${value === v} onClick=${() => onChange(v)}>${l}</button>`)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Charts (hand-drawn SVG with a hover layer)

function useWidth(ref, fallback = 600) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function niceTicks(lo, hi, target = 5) {
  const span = hi - lo || 1;
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function ticks(max, n = 4) { const out = []; for (let i = 0; i <= n; i++) out.push(max * i / n); return out; }

// Multi-series line chart, optional bands. series: [{name, color, values:[y], band?:[[lo,hi]]}]
function LineChart({ title, xs, series, xLabel, yLabel, height = 230, xFmt = x => x, yFmt = y => fmt(y, 0), markers = [] }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hover, setHover] = useState(null);
  const pad = { l: 46, r: 14, t: 14, b: 34 };
  const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
  const xMax = xs[xs.length - 1] || 1, xMin = xs[0] || 0;
  const yMax = niceMax(Math.max(1, ...series.flatMap(s => [...s.values, ...(s.band ? s.band.map(b => b[1]) : [])])));
  const X = x => pad.l + (x - xMin) / (xMax - xMin || 1) * iw;
  const Y = y => pad.t + ih - y / yMax * ih;
  const path = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const bandPath = b => b.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v[1]).toFixed(1)}`).join('') +
    b.slice().reverse().map((v, j) => `L${X(xs[b.length - 1 - j]).toFixed(1)},${Y(v[0]).toFixed(1)}`).join('') + 'Z';
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    const xv = xMin + (px - pad.l) / iw * (xMax - xMin);
    let i = 0, best = Infinity;
    xs.forEach((x, k) => { const d = Math.abs(x - xv); if (d < best) { best = d; i = k; } });
    setHover({ i, left: X(xs[i]) / W * r.width });
  };
  const xt = niceTicks(xMin, xMax, Math.min(6, Math.max(2, Math.floor(iw / 80))));
  return html`<div class="chart" ref=${ref}>
    ${title && html`<h3 style=${{ marginBottom: '6px' }}>${title}</h3>`}
    <svg viewBox="0 0 ${W} ${height}" onMouseMove=${onMove} onMouseLeave=${() => setHover(null)} role="img" aria-label=${title}>
      <g class="grid">${ticks(yMax).map(t => html`<line key=${t} x1=${pad.l} x2=${W - pad.r} y1=${Y(t)} y2=${Y(t)} />`)}</g>
      ${ticks(yMax).map(t => html`<text key=${'y' + t} x=${pad.l - 6} y=${Y(t) + 4} text-anchor="end">${yFmt(t)}</text>`)}
      ${xt.map(t => html`<text key=${'x' + t} x=${X(t)} y=${height - pad.b + 16} text-anchor="middle">${xFmt(t)}</text>`)}
      <line class="axis" x1=${pad.l} x2=${W - pad.r} y1=${Y(0)} y2=${Y(0)} />
      ${xLabel && html`<text x=${pad.l + iw / 2} y=${height - 2} text-anchor="middle">${xLabel}</text>`}
      ${yLabel && html`<text x=${12} y=${pad.t + ih / 2} text-anchor="middle" transform=${`rotate(-90 12 ${pad.t + ih / 2})`}>${yLabel}</text>`}
      ${markers.map(m => html`<g key=${m.label}>
        <line x1=${X(m.x)} x2=${X(m.x)} y1=${pad.t} y2=${pad.t + ih} stroke=${m.color || 'var(--ink-2)'} stroke-dasharray="4 3" stroke-width="1.5" />
        <text x=${X(m.x) + (m.anchor === 'end' ? -4 : 4)} y=${pad.t + 10} text-anchor=${m.anchor || 'start'} style=${{ fill: 'var(--ink-2)' }}>${m.label}</text>
      </g>`)}
      ${series.map(s => s.band && html`<path key=${s.name + 'b'} d=${bandPath(s.band)} fill=${s.color} opacity="0.16" />`)}
      ${series.map(s => html`<path key=${s.name} d=${path(s.values)} fill="none" stroke=${s.color} stroke-width="2" stroke-dasharray=${s.dash || ''} stroke-linejoin="round" />`)}
      ${series.map(s => !s.dash && html`<circle key=${s.name + 'e'} cx=${X(xs[xs.length - 1])} cy=${Y(s.values[s.values.length - 1])} r="4" fill=${s.color} stroke="var(--surface)" stroke-width="2" />`)}
      ${hover && html`<g>
        <line x1=${X(xs[hover.i])} x2=${X(xs[hover.i])} y1=${pad.t} y2=${pad.t + ih} stroke="var(--ink-2)" stroke-width="1" opacity="0.5" />
        ${series.map(s => html`<circle key=${s.name + 'h'} cx=${X(xs[hover.i])} cy=${Y(s.values[hover.i])} r="4.5" fill=${s.color} stroke="var(--surface)" stroke-width="2" />`)}
      </g>`}
    </svg>
    ${hover && html`<div class="tip" style=${{ left: Math.min(hover.left + 12, W - 190) + 'px', top: '30px' }}>
      <div>${xLabel}: <b>${xFmt(xs[hover.i])}</b></div>
      ${series.map(s => html`<div key=${s.name}><span class="key" style=${{ background: s.color }}></span>${s.name}: <b class="num">${yFmt(s.values[hover.i])}</b>${s.band ? html` <span class="note">(${yFmt(s.band[hover.i][0])}–${yFmt(s.band[hover.i][1])})</span>` : ''}</div>`)}
    </div>`}
  </div>`;
}

// Histogram of per-run differences, coloured by which model won that run.
function DiffHistogram({ values, unit = 's' }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hover, setHover] = useState(null);
  const height = 200, pad = { l: 40, r: 14, t: 10, b: 34 };
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const nb = Math.min(30, Math.max(8, Math.round(Math.sqrt(values.length) * 2)));
  const bw = span / nb;
  const bins = Array.from({ length: nb }, (_, i) => ({ x0: lo + i * bw, x1: lo + (i + 1) * bw, n: 0 }));
  values.forEach(v => { bins[Math.min(nb - 1, Math.floor((v - lo) / bw))].n++; });
  const yMax = niceMax(Math.max(1, ...bins.map(b => b.n)));
  const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = x => pad.l + (x - lo) / span * iw;
  const Y = y => pad.t + ih - y / yMax * ih;
  const xt = ticks(span, 4).map(t => lo + t);
  return html`<div class="chart" ref=${ref}>
    <h3 style=${{ marginBottom: '6px' }}>Change in average delay, each run</h3>
    <svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Histogram of four-way minus two-way average delay per run">
      <g class="grid">${ticks(yMax, 3).map(t => html`<line key=${t} x1=${pad.l} x2=${W - pad.r} y1=${Y(t)} y2=${Y(t)} />`)}</g>
      ${ticks(yMax, 3).map(t => html`<text key=${'y' + t} x=${pad.l - 6} y=${Y(t) + 4} text-anchor="end">${fmt(t, 0)}</text>`)}
      ${bins.map((b, i) => b.n > 0 && html`<rect key=${i} x=${X(b.x0) + 1} width=${Math.max(1, X(b.x1) - X(b.x0) - 2)} y=${Y(b.n)} height=${Y(0) - Y(b.n)} rx="2"
        fill=${(b.x0 + b.x1) / 2 < 0 ? 'var(--series-b)' : 'var(--series-a)'} onMouseEnter=${() => setHover({ b, left: X((b.x0 + b.x1) / 2) })} onMouseLeave=${() => setHover(null)} />`)}
      <line x1=${X(0)} x2=${X(0)} y1=${pad.t} y2=${pad.t + ih} stroke="var(--ink)" stroke-width="1.5" />
      <line class="axis" x1=${pad.l} x2=${W - pad.r} y1=${Y(0)} y2=${Y(0)} />
      ${xt.map(t => html`<text key=${'x' + t} x=${X(t)} y=${height - pad.b + 16} text-anchor="middle">${signed(t, Math.abs(span) < 10 ? 1 : 0)}</text>`)}
      <text x=${pad.l + iw / 2} y=${height - 2} text-anchor="middle">Four-way minus two-way, ${unit} per vehicle</text>
    </svg>
    ${hover && html`<div class="tip" style=${{ left: Math.min(hover.left + 10, W - 200) + 'px', top: '40px' }}>
      <b>${hover.b.n} run${hover.b.n === 1 ? '' : 's'}</b> between ${signed(hover.b.x0)} and ${signed(hover.b.x1)} ${unit}<br />
      ${(hover.b.x0 + hover.b.x1) / 2 < 0 ? 'Four-way better' : 'Two-way better'}
    </div>`}
    <div class="legend"><span><i class="key" style=${{ background: 'var(--series-a)' }}></i>Runs where two-way had less delay</span><span><i class="key" style=${{ background: 'var(--series-b)' }}></i>Runs where four-way had less delay</span></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Capacity tab (plan section 5)

function CapacityTab({ lastSim }) {
  const [p, setP] = useState(() => readStore('tlem-cap', { cycle: 120, lostTime: 4, headway: 2.5, blocked: 25 }));
  useEffect(() => writeStore('tlem-cap', p), [p]);
  const set = k => v => setP(o => ({ ...o, [k]: v }));
  const m = E.capacityModel(p);
  const xs = []; const maxB = Math.max(1, Math.ceil(m.greenA));
  for (let b = 0; b <= maxB; b += maxB / 60) xs.push(b);
  const curve = xs.map(b => E.capacityModel({ ...p, blocked: b }));
  const winner = m.winner === 'A' ? 'Two-way wins' : m.winner === 'B' ? 'Four-way wins' : 'Dead heat';
  const markers = [{ x: Math.min(m.breakEven, maxB), label: `Break-even ${fmt(m.breakEven)} s` }];
  if (p.blocked <= maxB) markers.push({ x: p.blocked, label: 'Your setting', color: 'var(--accent)', anchor: p.blocked < m.breakEven ? 'end' : 'start' });
  if (p.blocked >= m.breakEven) markers[0].anchor = 'end';
  return html`<div class="cap-grid">
    <section class="panel">
      <h2>Inputs</h2>
      <${Field} id="cap-blocked" label="Blocked seconds per approach, per cycle" value=${p.blocked} min=${0} max=${Math.floor(m.greenA)} step=${0.5} unit="s" onChange=${set('blocked')} />
      <${Field} id="cap-lost" label="Lost time per signal phase" value=${p.lostTime} min=${0} max=${10} step=${0.5} unit="s" onChange=${set('lostTime')} />
      <${Field} id="cap-h" label="Seconds between departing vehicles" value=${p.headway} min=${1.5} max=${4} step=${0.1} unit="s" onChange=${set('headway')} />
      <${Field} id="cap-cycle" label="Signal cycle" value=${p.cycle} min=${40} max=${200} step=${5} unit="s" onChange=${set('cycle')} />
      <p class="note">Saturated junction, one lane per approach, equal demand, and the same blocked time on every approach under two-way signalling. Four-way signalling has no right-turn blocking.</p>
      ${lastSim && html`<p class="note">Your last simulation measured <b class="num">${fmt(lastSim, 1)} s</b> of blocked green per approach per cycle under two-way signalling.
        <button class="btn" style=${{ marginTop: '6px' }} onClick=${() => set('blocked')(Math.round(lastSim * 2) / 2)}>Use that figure</button></p>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Vehicles per ${p.cycle}-second cycle, all four approaches</h2><span class="chip ${m.winner === 'B' ? 'bad' : 'good'}"><i></i>${winner}</span></div>
      <div class="big-row">
        <div class="big"><span class="label"><i class="key" style=${{ background: 'var(--series-a)' }}></i>A · Two-way</span><span class="value num">${fmt(m.perCycleA)}</span><span class="sub">${fmt(m.greenA)} s green each · ${fmt(m.perHourA, 0)} veh/h</span></div>
        <div class="big"><span class="label"><i class="key" style=${{ background: 'var(--series-b)' }}></i>B · Four-way</span><span class="value num">${fmt(m.perCycleB)}</span><span class="sub">${fmt(m.greenB)} s green each · ${fmt(m.perHourB, 0)} veh/h</span></div>
        <div class="big"><span class="label">Net effect of four-way</span><span class="value num ${m.net < 0 ? 'worse' : 'better'}">${signed(m.net)}</span><span class="sub">${signed(m.netPct)}% throughput</span></div>
        <div class="big"><span class="label">Break-even blockage</span><span class="value num">${fmt(m.breakEven)} s</span><span class="sub">per approach, per cycle</span></div>
      </div>
      <${LineChart} title="Throughput as right-turn blocking grows" xs=${xs} xLabel="Blocked seconds per approach per cycle" yLabel="Vehicles per cycle"
        xFmt=${x => fmt(x, 0)} yFmt=${y => fmt(y, 0)} markers=${markers}
        series=${[{ name: 'Two-way', color: 'var(--series-a)', values: curve.map(c => c.perCycleA) }, { name: 'Four-way', color: 'var(--series-b)', values: curve.map(c => c.perCycleB) }]} />
      <p class="lede">Four-way signalling gives each approach ${fmt(m.greenB)} s of green against ${fmt(m.greenA)} s under two-way. It only catches up when right-turners waste more than ${fmt(m.breakEven)} s of each two-way green. The simulation measures how much they really waste.</p>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Settings panel

function SettingsPanel({ cfg, setCfg, onOptimise, optimising, optResult }) {
  const set = k => v => setCfg(c => ({ ...c, [k]: v }));
  const sym = cfg.symmetric;
  const setAp = (a, k) => v => setCfg(c => ({ ...c, approaches: c.approaches.map((ap, i) => (sym || i === a ? { ...ap, [k]: v } : ap)) }));
  const ap0 = cfg.approaches[0];
  const apFields = (a, ap, compact) => html`
    <${Field} id=${`v${a}`} label="Vehicles arriving" value=${ap.volume} min=${0} max=${1200} step=${10} unit="veh/h" slider=${!compact} onChange=${setAp(a, 'volume')} />
    <${Field} id=${`r${a}`} label="Turning right" value=${ap.right} min=${0} max=${100 - ap.left} step=${1} unit="%" slider=${!compact} onChange=${setAp(a, 'right')} />
    <${Field} id=${`l${a}`} label="Turning left" value=${ap.left} min=${0} max=${100 - ap.right} step=${1} unit="%" slider=${!compact} onChange=${setAp(a, 'left')} />
    <${Select} id=${`lay${a}`} label="Lanes" value=${ap.layout} options=${[['shared', '1 shared lane'], ['pocket', '+ right-turn lane']]} onChange=${setAp(a, 'layout')} />
    ${ap.layout === 'pocket' && html`<${Field} id=${`st${a}`} label="Right-turn lane holds" value=${ap.storage} min=${1} max=${30} unit="cars" slider=${false} onChange=${setAp(a, 'storage')} />`}`;
  return html`<div class="panel">
    <div class="panel-head"><h2>Junction</h2>
      <select id="scenario-pick" aria-label="Load a scenario" value="" onChange=${e => { const s = E.SCENARIOS.find(x => x.id === e.target.value); if (s) setCfg(c => ({ ...s.apply(c), symmetric: s.apply(c).approaches.every(a => JSON.stringify(a) === JSON.stringify(s.apply(c).approaches[0])) })); }}>
        <option value="">Load scenario…</option>
        ${E.SCENARIOS.map(s => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
      </select>
    </div>
    <div class="group">
      <h3>Traffic</h3>
      <${Check} id="sym" label="Same traffic on all four approaches" checked=${sym} onChange=${v => setCfg(c => ({ ...c, symmetric: v, approaches: v ? c.approaches.map(() => ({ ...c.approaches[0] })) : c.approaches }))} />
      ${sym ? apFields(0, ap0, false) : html`<div class="approach-grid">
        ${cfg.approaches.map((ap, a) => html`<div class="ap" key=${a}><h4>${E.APPROACH_NAMES[a]}</h4>${apFields(a, ap, true)}</div>`)}
      </div>`}
    </div>
    <div class="group">
      <h3>Signals</h3>
      <${Field} id="cycle" label=${cfg.separateTimings ? 'Two-way cycle' : 'Signal cycle'} value=${cfg.cycle} min=${30} max=${200} step=${5} unit="s" onChange=${set('cycle')} />
      <${Select} id="split" label=${cfg.separateTimings ? 'Two-way green split' : 'Green split'} value=${cfg.split} options=${[['equal', 'Equal'], ['demand', 'By demand']]} onChange=${set('split')} />
      <${Check} id="sep" label="Separate timings for four-way" checked=${cfg.separateTimings} onChange=${v => setCfg(c => ({ ...c, separateTimings: v, cycleB: c.cycleB ?? c.cycle, splitB: c.splitB ?? c.split }))} />
      ${cfg.separateTimings && html`
        <${Field} id="cycleB" label="Four-way cycle" value=${cfg.cycleB} min=${30} max=${200} step=${5} unit="s" onChange=${set('cycleB')} />
        <${Select} id="splitB" label="Four-way green split" value=${cfg.splitB} options=${[['equal', 'Equal'], ['demand', 'By demand']]} onChange=${set('splitB')} />`}
      <${Field} id="lost" label="Changeover (amber + all-red) per phase" value=${cfg.lostTime} min=${0} max=${10} step=${0.5} unit="s" onChange=${set('lostTime')} />
      <div class="btn-row">
        <button class="btn" onClick=${onOptimise} disabled=${optimising}>${optimising ? 'Optimising…' : 'Optimise timings for each'}</button>
      </div>
      ${optResult && html`<p class="note">Best found: two-way ${optResult.A.cycle} s, ${optResult.A.split} split; four-way ${optResult.B.cycle} s, ${optResult.B.split} split.</p>`}
    </div>
    <div class="group">
      <h3>Driving</h3>
      <${Field} id="headway" label="Discharge headway" value=${cfg.headway} min=${1.5} max=${4} step=${0.1} unit="s" onChange=${set('headway')} />
      <${Field} id="gap" label="Right-turn gap required" value=${cfg.gap} min=${2} max=${12} step=${0.5} unit="s" onChange=${set('gap')} />
      <${Field} id="amber" label="Right-turners clearing at end of green" value=${cfg.amberClear} min=${0} max=${3} step=${1} unit="per lane" slider=${false} onChange=${set('amberClear')} />
      <${Check} id="mutual" label="Facing right-turners turn together" checked=${cfg.mutualTurns} onChange=${set('mutualTurns')} />
    </div>
    <div class="group">
      <h3>Run</h3>
      <${Field} id="duration" label="Simulation duration" value=${cfg.duration} min=${10} max=${240} step=${5} unit="min" onChange=${set('duration')} />
      <${Field} id="reps" label="Repetitions" value=${cfg.reps} min=${10} max=${500} step=${10} unit="runs" onChange=${set('reps')} />
      <${Field} id="seed" label="Random seed" value=${cfg.seed} min=${1} max=${999999} step=${1} slider=${false} onChange=${set('seed')} />
      <p class="note">The same seed always gives the same traffic and the same results.</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Junction animation (canvas)

const SPEED = 11;            // m/s, free speed for drawing
const SPACING = 6.6;         // m between queued cars
const LANE = 3.6;            // m lane width
const VIEW = 42;             // m from centre to canvas edge
const CROSS_T = 2.6;         // s to cross the junction box
const EXIT_T = 5;            // s drawn after leaving the box
const TURN_COLOURS = { S: '#e9ebee', L: '#1baf7a', R: '#9085e9' };
const SIG = { R: '#e34948', A: '#f2a900', G: '#19b35c' };

const DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];         // inbound travel direction per approach (screen y down)
const leftOf = ([dx, dy]) => [dy, -dx];                    // left normal in screen coordinates
const add = (p, q, k = 1) => [p[0] + q[0] * k, p[1] + q[1] * k];

function junctionGeometry(cfg) {
  const anyPocket = cfg.approaches.some(a => a.layout === 'pocket');
  const S = (anyPocket ? 2 : 1) * LANE + 2.5;   // half-size of the junction box
  const lanes = cfg.approaches.map((ap, a) => {
    const d = DIR[a], n = leftOf(d);
    const offs = ap.layout === 'pocket' ? [1.5 * LANE, 0.5 * LANE] : [0.5 * LANE];
    return offs.map(off => ({ d, n, stop: add(add([0, 0], d, -S), n, off) }));
  });
  return { S, lanes, anyPocket };
}

function exitPoint(S, e) { return add(add([0, 0], e, S), leftOf(e), 0.5 * LANE); }

function vehiclePath(geo, v) {
  const lane = geo.lanes[v.approach][v.lane];
  const d = lane.d;
  const e = v.turn === 'S' ? d : v.turn === 'L' ? leftOf(d) : leftOf(d).map(x => -x);
  const P0 = lane.stop, P2 = exitPoint(geo.S, e);
  let Q;
  if (v.turn === 'S') Q = [(P0[0] + P2[0]) / 2, (P0[1] + P2[1]) / 2];
  else { const k = (P2[0] - P0[0]) * d[0] + (P2[1] - P0[1]) * d[1]; Q = add(P0, d, k); }
  return { P0, Q, P2, e, d };
}

function bezier(P0, Q, P2, s) {
  const u = 1 - s;
  const p = [u * u * P0[0] + 2 * u * s * Q[0] + s * s * P2[0], u * u * P0[1] + 2 * u * s * Q[1] + s * s * P2[1]];
  const t = [2 * u * (Q[0] - P0[0]) + 2 * s * (P2[0] - Q[0]), 2 * u * (Q[1] - P0[1]) + 2 * s * (P2[1] - Q[1])];
  return { p, ang: Math.atan2(t[1], t[0]) };
}

// Index vehicles per lane once per run.
function indexRun(run) {
  const lanes = new Map();
  for (const v of run.vehicles) {
    const k = v.approach * 2 + v.lane;
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(v);
  }
  return lanes;
}

function drawJunction(ctx, size, cfg, run, idx, t, theme, smooth) {
  const geo = junctionGeometry(cfg);
  const sc = size / (2 * VIEW);
  const W = p => [size / 2 + p[0] * sc, size / 2 + p[1] * sc];
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = theme.verge; ctx.fillRect(0, 0, size, size);
  // Roads
  ctx.fillStyle = theme.road;
  for (let a = 0; a < 4; a++) {
    const d = DIR[a], n = leftOf(d);
    const inW = cfg.approaches[a].layout === 'pocket' ? 2 * LANE : LANE;
    const c1 = add(add([0, 0], d, -VIEW), n, inW), c2 = add(add([0, 0], d, -VIEW), n, -LANE);
    const c3 = add(add([0, 0], d, -geo.S), n, -LANE), c4 = add(add([0, 0], d, -geo.S), n, inW);
    ctx.beginPath(); [c1, c2, c3, c4].map(W).forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.fill();
  }
  const b0 = W([-geo.S, -geo.S]);
  ctx.fillRect(b0[0], b0[1], 2 * geo.S * sc, 2 * geo.S * sc);
  // Markings: centre lines, lane dividers, stop lines
  ctx.strokeStyle = theme.marking; ctx.lineWidth = Math.max(1, 0.15 * sc);
  for (let a = 0; a < 4; a++) {
    const d = DIR[a], n = leftOf(d);
    const from = add([0, 0], d, -VIEW), to = add([0, 0], d, -geo.S);
    ctx.setLineDash([2.5 * sc, 2.5 * sc]);
    ctx.beginPath(); ctx.moveTo(...W(from)); ctx.lineTo(...W(to)); ctx.stroke();
    if (cfg.approaches[a].layout === 'pocket') {
      const p1 = add(add([0, 0], d, -(geo.S + 6.6 * Math.min(cfg.approaches[a].storage, 8))), n, LANE);
      ctx.setLineDash([1.2 * sc, 1.2 * sc]);
      ctx.beginPath(); ctx.moveTo(...W(p1)); ctx.lineTo(...W(add(to, n, LANE))); ctx.stroke();
    }
    ctx.setLineDash([]);
    const inW = cfg.approaches[a].layout === 'pocket' ? 2 * LANE : LANE;
    ctx.lineWidth = Math.max(1.5, 0.35 * sc);
    ctx.beginPath(); ctx.moveTo(...W(add(to, n, 0.1))); ctx.lineTo(...W(add(to, n, inW))); ctx.stroke();
    ctx.lineWidth = Math.max(1, 0.15 * sc);
  }
  // Signal heads, one per approach on the nearside
  for (let a = 0; a < 4; a++) {
    const d = DIR[a], n = leftOf(d);
    const inW = cfg.approaches[a].layout === 'pocket' ? 2 * LANE : LANE;
    const st = E.signalState(run.plan, a, t);
    const base = add(add([0, 0], d, -geo.S + 0.6), n, inW + 1.6);
    const p = W(base);
    const r = Math.max(2.5, 0.75 * sc);
    ctx.fillStyle = '#16181b';
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.atan2(d[1], d[0]) + Math.PI / 2);
    ctx.beginPath(); ctx.roundRect(-r * 1.4, -r * 4.2, r * 2.8, r * 8.4, r * 0.8); ctx.fill();
    const lit = { R: st === 'R' || st === 'RA', A: st === 'A' || st === 'RA', G: st === 'G' };
    [['R', -2.6], ['A', 0], ['G', 2.6]].forEach(([k, off]) => {
      ctx.fillStyle = lit[k] ? SIG[k] : '#33373d';
      ctx.beginPath(); ctx.arc(0, off * r, r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  // Vehicles
  const carL = 4.4 * sc, carW = 1.9 * sc;
  const overflow = [];
  const lookahead = VIEW / SPEED;
  for (const [key, list] of idx) {
    const a = Math.floor(key / 2), ln = key % 2;
    const lane = geo.lanes[a][ln];
    if (!lane) continue;
    let waitingAhead = 0, hidden = 0;
    for (const v of list) {
      if (v.arrive > t + lookahead) break;
      const dep = v.depart;
      if (dep != null && dep + CROSS_T + EXIT_T < t) continue;
      let pos, ang;
      if (dep == null || dep > t) {
        // Queued, or still driving up to the back of the queue
        const target = Math.max(waitingAhead * SPACING, (v.arrive - t) * SPEED);
        waitingAhead++;
        let dist = target;
        const prev = smooth.get(v.id);
        if (prev != null && prev > dist) dist = Math.max(dist, prev - smooth.step);
        smooth.set(v.id, dist);
        if (dist > VIEW - geo.S - 2) { hidden++; continue; }
        pos = add(lane.stop, lane.d, -(dist + 2.2));
        ang = Math.atan2(lane.d[1], lane.d[0]);
      } else {
        smooth.delete(v.id);
        const pth = vehiclePath(geo, v);
        const el = t - dep;
        if (el < CROSS_T) {
          const s = el / CROSS_T;
          const b = bezier(pth.P0, pth.Q, pth.P2, s * s * (1.6 - 0.6 * s));
          pos = b.p; ang = b.ang;
        } else {
          pos = add(pth.P2, pth.e, (el - CROSS_T) * SPEED);
          ang = Math.atan2(pth.e[1], pth.e[0]);
        }
      }
      const p = W(pos);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
      ctx.fillStyle = TURN_COLOURS[v.turn];
      ctx.beginPath(); ctx.roundRect(-carL / 2, -carW / 2, carL, carW, Math.min(3, carW / 3)); ctx.fill();
      // Right-turner held at the stop line waiting for a gap
      if (v.turn === 'R' && run.model === 'A' && v.waitedForGap && (dep == null || dep > t) && waitingAhead === 1 && t >= v.arrive && E.signalState(run.plan, a, t) === 'G') {
        ctx.strokeStyle = SIG.A; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }
    if (hidden > 0) overflow.push({ a, ln, hidden, waiting: waitingAhead });
  }
  // Queue counts beyond the edge
  ctx.font = `600 ${Math.max(11, Math.round(size / 34))}px Barlow, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const o of overflow) {
    const lane = geo.lanes[o.a][o.ln];
    const p = W(add(lane.stop, lane.d, -(VIEW - geo.S - 6)));
    const label = `+${o.hidden}`;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect(p[0] - w / 2, p[1] - 10, w, 20, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, p[0], p[1] + 1);
  }
}

function JunctionCanvas({ cfg, run, idx, t, title, colour, stats }) {
  const ref = useRef(null);
  const smooth = useRef(new Map());
  const lastT = useRef(t);
  const themeKey = useThemeKey();
  useEffect(() => { smooth.current = new Map(); }, [run]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const size = cv.clientWidth || 400;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dt = t - lastT.current;
    lastT.current = t;
    if (dt < 0 || dt > 20) smooth.current = new Map();
    smooth.current.step = Math.max(0.2, Math.abs(dt) * 9);
    drawJunction(ctx, size, cfg, run, idx, t, { verge: cssVar('--verge'), road: cssVar('--road'), marking: cssVar('--marking') }, smooth.current);
  });
  return html`<figure>
    <figcaption><b style=${{ color: colour }}>${title}</b><span class="num note">${stats}</span></figcaption>
    <canvas ref=${ref} role="img" aria-label=${`${title} junction animation`} data-theme-key=${themeKey}></canvas>
  </figure>`;
}

function queueAt(run, t) {
  let n = 0;
  for (const v of run.vehicles) { if (v.arrive > t) break; if (v.depart == null || v.depart > t) n++; }
  return n;
}

function Animation({ cfg, pair }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => readStore('tlem-speed', 4));
  const [view, setView] = useState('both');
  const T = cfg.duration * 60;
  const idxA = useMemo(() => indexRun(pair.runA), [pair]);
  const idxB = useMemo(() => indexRun(pair.runB), [pair]);
  useEffect(() => writeStore('tlem-speed', speed), [speed]);
  useEffect(() => { if (t > T) setT(0); }, [T]);
  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      setT(x => { const nx = x + dt * speed; if (nx >= T) { setPlaying(false); return T; } return nx; });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, T]);
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const cleared = run => run.vehicles.filter(v => v.depart != null && v.depart <= t).length;
  const show = view === 'both' ? ['A', 'B'] : [view];
  return html`<section class="panel">
    <div class="panel-head"><h2>Live junction</h2>
      <${Seg} label="Which arrangement" value=${view} onChange=${setView} options=${[['both', 'Side by side'], ['A', 'Two-way'], ['B', 'Four-way']]} />
    </div>
    <p class="note">Same vehicles, same arrival times, both arrangements. UK left-hand traffic: right-turners cross the oncoming flow. A ringed car is a right-turner waiting for a gap and blocking the lane behind it.</p>
    <div class="anim-wrap" style=${{ '--cols': show.length }}>
      ${show.map(m => {
        const run = m === 'A' ? pair.runA : pair.runB;
        return html`<${JunctionCanvas} key=${m} cfg=${cfg} run=${run} idx=${m === 'A' ? idxA : idxB} t=${t}
          title=${m === 'A' ? 'A · Two-way' : 'B · Four-way'} colour=${m === 'A' ? 'var(--series-a)' : 'var(--series-b)'}
          stats=${`${queueAt(run, t)} queued · ${cleared(run)} cleared`} />`;
      })}
    </div>
    <div class="anim-controls">
      <button class="btn primary" onClick=${() => { if (t >= T) setT(0); setPlaying(p => !p); }}>${playing ? 'Pause' : 'Play'}</button>
      <span class="num" style=${{ minWidth: '86px' }}>${clock(t)} / ${clock(T)}</span>
      <input type="range" id="anim-t" aria-label="Simulation time" min="0" max=${T} step="1" value=${t} onInput=${e => setT(Number(e.target.value))} />
      <label class="note" for="anim-speed">Speed</label>
      <select id="anim-speed" value=${speed} onChange=${e => setSpeed(Number(e.target.value))}>
        ${[1, 2, 4, 8, 16, 32, 60].map(s => html`<option key=${s} value=${s}>${s}×</option>`)}
      </select>
    </div>
    <div class="legend">
      <span><i class="key" style=${{ background: TURN_COLOURS.S, outline: '1px solid var(--line)' }}></i>Straight on</span>
      <span><i class="key" style=${{ background: TURN_COLOURS.L }}></i>Turning left</span>
      <span><i class="key" style=${{ background: TURN_COLOURS.R }}></i>Turning right</span>
      <span><i class="key" style=${{ background: 'transparent', outline: `2px solid ${SIG.A}` }}></i>Waiting for a gap</span>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Results

const METRICS = [
  { k: 'throughput', label: 'Throughput', unit: 'veh/h', d: 0, higherBetter: true },
  { k: 'avgDelay', label: 'Average delay', unit: 's/veh', d: 1 },
  { k: 'vehHoursDelay', label: 'Total delay', unit: 'veh·h', d: 1 },
  { k: 'avgQueue', label: 'Average queue', unit: 'veh', d: 1 },
  { k: 'maxQueue', label: 'Longest queue on one approach', unit: 'veh', d: 0 },
  { k: 'remaining', label: 'Still queued at the end', unit: 'veh', d: 0 },
  { k: 'blockedGreen', label: 'Green blocked by right-turners', unit: 's', d: 0 },
];

function verdictOf(agg) {
  const d = agg.diff.avgDelay;
  if (d.p90 < 0) return { who: 'B', text: 'Four-way wins', cls: 'bad' };
  if (d.p10 > 0) return { who: 'A', text: 'Two-way wins', cls: 'good' };
  return { who: '', text: d.median < 0 ? 'Leans four-way, too close to call' : 'Leans two-way, too close to call', cls: '' };
}

function Headline({ result, running, progress }) {
  if (!result) return html`<section class="panel"><p class="note">Running…</p></section>`;
  const { agg } = result;
  const v = verdictOf(agg);
  const colour = v.who === 'A' ? 'var(--series-a)' : v.who === 'B' ? 'var(--series-b)' : 'var(--muted)';
  const stableChip = (m, name) => {
    const frac = m === 'A' ? agg.unstableA : agg.unstableB;
    const slope = agg[m].remaining.median;
    return frac > 0.5
      ? html`<span class="chip bad"><i></i>${name}: demand exceeds capacity, queues keep growing (${fmt(slope, 0)} vehicles left at the end)</span>`
      : html`<span class="chip"><i style=${{ background: 'var(--good)' }}></i>${name}: queues stable</span>`;
  };
  return html`<section class="panel headline" style=${{ '--verdict': colour }}>
    <div class="panel-head"><h2>${v.text}</h2><span class="note num">${agg.n} runs${running ? ` · updating ${Math.round(progress * 100)}%` : ''}</span></div>
    ${running && html`<div class="progress"><div style=${{ width: `${progress * 100}%` }}></div></div>`}
    <p class="statement">${E.headline(agg)}</p>
    <div class="chips">
      <span class="chip">Four-way had less delay in <b class="num">${fmt(agg.bWinsDelay * 100, 0)}%</b> of runs</span>
      ${stableChip('A', 'Two-way')}
      ${stableChip('B', 'Four-way')}
    </div>
    <p class="note">Medians across runs. Every run feeds identical vehicles to both arrangements. Delay includes time already spent waiting by vehicles still queued at the end.</p>
  </section>`;
}

function ComparisonTable({ agg }) {
  return html`<section class="panel">
    <h2>A against B, whole junction</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Measure</th><th><span class="key" style=${{ background: 'var(--series-a)' }}></span>Two-way</th><th><span class="key" style=${{ background: 'var(--series-b)' }}></span>Four-way</th><th>Change with four-way</th></tr></thead>
      <tbody>
        ${METRICS.map(m => {
          const a = agg.A[m.k], b = agg.B[m.k], d = agg.diff[m.k];
          const good = m.higherBetter ? d.median > 1e-9 : d.median < -1e-9;
          const bad = m.higherBetter ? d.median < -1e-9 : d.median > 1e-9;
          const pctTxt = m.k === 'throughput' ? ` (${signed(agg.diff.throughputPct.median)}%)` : m.k === 'vehHoursDelay' && isFinite(agg.diff.delayPct.median) ? ` (${signed(agg.diff.delayPct.median, 0)}%)` : '';
          return html`<tr key=${m.k}>
            <td>${m.label} <span class="note">${m.unit}</span></td>
            <td>${fmt(a.median, m.d)}<span class="range">${fmt(a.p10, m.d)}–${fmt(a.p90, m.d)}</span></td>
            <td>${fmt(b.median, m.d)}<span class="range">${fmt(b.p10, m.d)}–${fmt(b.p90, m.d)}</span></td>
            <td class=${good ? 'better' : bad ? 'worse' : ''}>${signed(d.median, m.d)}${pctTxt}<span class="range">${signed(d.p10, m.d)} to ${signed(d.p90, m.d)}</span></td>
          </tr>`;
        })}
      </tbody>
    </table></div>
    <p class="note">Small figures are the 10th–90th percentile range across runs. Green means four-way is better on that measure, red means worse.</p>
  </section>`;
}

function seriesStats(reps, m, key) {
  const n = reps[0][m][key].length;
  const med = [], band = [];
  for (let i = 0; i < n; i++) {
    const vals = reps.map(r => r[m][key][i]).sort((x, y) => x - y);
    med.push(E.quantile(vals, 0.5));
    band.push([E.quantile(vals, 0.1), E.quantile(vals, 0.9)]);
  }
  return { med, band };
}

function Charts({ result }) {
  const { reps } = result;
  const n = reps[0].A.series.length;
  const xs = Array.from({ length: n }, (_, i) => i * reps[0].A.seriesStep / 60);
  const qa = seriesStats(reps, 'A', 'series'), qb = seriesStats(reps, 'B', 'series');
  const ca = seriesStats(reps, 'A', 'cumDeparted'), cb = seriesStats(reps, 'B', 'cumDeparted');
  return html`<section class="panel">
    <h2>Over time</h2>
    <div class="charts">
      <${LineChart} title="Vehicles queued at the junction" xs=${xs} xLabel="Minutes" yLabel="Vehicles queued" xFmt=${x => fmt(x, 0)}
        series=${[{ name: 'Two-way', color: 'var(--series-a)', values: qa.med, band: qa.band }, { name: 'Four-way', color: 'var(--series-b)', values: qb.med, band: qb.band }]} />
      <${LineChart} title="Vehicles cleared, cumulative" xs=${xs} xLabel="Minutes" yLabel="Vehicles cleared" xFmt=${x => fmt(x, 0)}
        series=${[{ name: 'Two-way', color: 'var(--series-a)', values: ca.med }, { name: 'Four-way', color: 'var(--series-b)', values: cb.med }]} />
    </div>
    <p class="note">Lines are medians across runs; shading spans the 10th to 90th percentile. A queue line that keeps climbing means demand exceeds capacity.</p>
    <${DiffHistogram} values=${reps.map(r => r.B.avgDelay - r.A.avgDelay)} />
  </section>`;
}

function ApproachTable({ cfg, pair, result }) {
  const plans = { A: E.buildPlan(cfg, 'A'), B: E.buildPlan(cfg, 'B') };
  const greenOf = (plan, a) => plan.phases.find(p => p.approaches.includes(a)).green;
  const medianPer = (m, a, k) => E.quantile(result.reps.map(r => r[m].perApproach[a][k]).sort((x, y) => x - y), 0.5);
  return html`<section class="panel">
    <h2>By approach</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Approach</th><th>Demand</th><th>Green A / B</th><th>Load A / B</th><th>Delay A / B</th><th>Longest queue A / B</th><th>Blocked green A</th></tr></thead>
      <tbody>
        ${cfg.approaches.map((ap, a) => {
          const s = 3600 / cfg.headway;
          const load = m => ap.volume / (s * greenOf(plans[m], a) / plans[m].cycle) * (ap.layout === 'pocket' ? 1 - ap.right / 100 : 1);
          const lA = load('A'), lB = load('B');
          return html`<tr key=${a}>
            <td>${E.APPROACH_NAMES[a]} <span class="note">${ap.right}% R · ${ap.left}% L${ap.layout === 'pocket' ? ' · RT lane' : ''}</span></td>
            <td>${fmt(ap.volume, 0)}</td>
            <td>${fmt(greenOf(plans.A, a), 0)} / ${fmt(greenOf(plans.B, a), 0)} s</td>
            <td><span class=${lA > 1 ? 'worse' : ''}>${fmt(lA * 100, 0)}%</span> / <span class=${lB > 1 ? 'worse' : ''}>${fmt(lB * 100, 0)}%</span></td>
            <td>${fmt(medianPer('A', a, 'avgDelay'), 0)} / ${fmt(medianPer('B', a, 'avgDelay'), 0)} s</td>
            <td>${fmt(medianPer('A', a, 'maxQueue'), 0)} / ${fmt(medianPer('B', a, 'maxQueue'), 0)}</td>
            <td>${fmt(medianPer('A', a, 'blockedGreen'), 0)} s</td>
          </tr>`;
        })}
      </tbody>
    </table></div>
    <p class="note">Load is demand over the lane's discharge capacity in its green, before any right-turn blocking. Over 100% means queues must grow. Cycle: two-way ${fmt(plans.A.cycle, 0)} s, four-way ${fmt(plans.B.cycle, 0)} s.</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// Import / export (downloads are blocked in the viewer, so text is shown to copy)

function toCSV(rows) {
  return rows.map(r => r.map(x => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n');
}

function ExportPanel({ cfg, setCfg, pair, result }) {
  const [mode, setMode] = useState('config');
  const [msg, setMsg] = useState('');
  const [importText, setImportText] = useState('');
  const text = useMemo(() => {
    if (mode === 'config') return JSON.stringify(cfg, null, 2);
    if (mode === 'vehicles') {
      const rows = [['model', 'vehicle_id', 'approach', 'lane', 'turn', 'arrival_s', 'departure_s', 'wait_s', 'obstructed', 'waited_for_gap', 'cleared_in_amber']];
      for (const run of [pair.runA, pair.runB]) for (const v of run.vehicles) {
        rows.push([run.model === 'A' ? 'two-way' : 'four-way', v.id, E.APPROACHES[v.approach], v.lane ? 'right-turn' : 'main', v.turn, v.arrive.toFixed(2),
          v.depart == null ? '' : v.depart.toFixed(2), ((v.depart ?? run.duration) - v.arrive).toFixed(2), v.obstructed ? 1 : 0, v.waitedForGap ? 1 : 0, v.amber ? 1 : 0]);
      }
      return toCSV(rows);
    }
    const keys = E.COMPARE_KEYS;
    const rows = [['run', 'seed', ...keys.flatMap(k => [`two_way_${k}`, `four_way_${k}`])]];
    result.reps.forEach(r => rows.push([r.rep, E.repSeed(cfg.seed, r.rep), ...keys.flatMap(k => [r.A[k].toFixed(3), r.B[k].toFixed(3)])]));
    return toCSV(rows);
  }, [mode, cfg, pair, result]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Copied.'); }
    catch { const el = document.getElementById('export-text'); el.focus(); el.select(); setMsg('Selected. Press Ctrl+C (or Copy) to copy.'); }
  };
  const load = src => {
    try {
      const obj = JSON.parse(src);
      const c = E.normaliseConfig(obj);
      c.symmetric = obj.symmetric ?? c.approaches.every(a => JSON.stringify(a) === JSON.stringify(c.approaches[0]));
      setCfg(c); setMsg('Scenario loaded.');
    } catch (e) { setMsg('That is not valid scenario JSON: ' + e.message); }
  };
  return html`<section class="panel">
    <div class="panel-head"><h2>Export and import</h2>
      <${Seg} label="What to export" value=${mode} onChange=${m => { setMode(m); setMsg(''); }} options=${[['config', 'Scenario JSON'], ['vehicles', 'Vehicles CSV'], ['runs', 'Runs CSV']]} />
    </div>
    <p class="note">${mode === 'config' ? 'Current settings as JSON. Save it to reload the scenario later.' : mode === 'vehicles' ? `Every vehicle in the first run (seed ${E.repSeed(cfg.seed, 0)}) under both arrangements.` : `Junction-wide results for each of the ${result.reps.length} runs.`}</p>
    <textarea class="io" id="export-text" readonly value=${text} aria-label="Export text"></textarea>
    <div class="btn-row"><button class="btn primary" onClick=${copy}>Copy</button><span class="note">${msg}</span></div>
    <h3>Import a scenario</h3>
    <textarea class="io" id="import-text" style=${{ minHeight: '70px' }} placeholder="Paste scenario JSON here" value=${importText} onInput=${e => setImportText(e.target.value)} aria-label="Scenario JSON to import"></textarea>
    <div class="btn-row">
      <button class="btn" onClick=${() => load(importText)} disabled=${!importText.trim()}>Load pasted JSON</button>
      <label class="btn" for="import-file">Open a .json file</label>
      <input type="file" id="import-file" accept=".json,application/json" hidden onChange=${e => { const f = e.target.files[0]; if (f) f.text().then(load); e.target.value = ''; }} />
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Simulation tab

function useBatch(cfg) {
  const [pair, setPair] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(1);
  const token = useRef(0);
  useEffect(() => {
    const my = ++token.current;
    const timer = setTimeout(async () => {
      const p0 = E.runPair(cfg, E.repSeed(cfg.seed, 0));
      if (my !== token.current) return;
      setPair(p0);
      const reps = [{ rep: 0, A: p0.A, B: p0.B }];
      let shown = false;
      setProgress(1 / cfg.reps);
      for (let r = 1; r < cfg.reps; r++) {
        const { A, B } = E.runPair(cfg, E.repSeed(cfg.seed, r));
        reps.push({ rep: r, A, B });
        if (await breathe(r === cfg.reps - 1)) {
          if (my !== token.current) return;
          setProgress((r + 1) / cfg.reps);
          if ((r >= 15 && !shown) || r === cfg.reps - 1) { shown = true; setResult({ reps: reps.slice(), agg: E.aggregate(reps) }); }
        }
      }
      if (cfg.reps < 16) setResult({ reps, agg: E.aggregate(reps) });
      setProgress(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [cfg]);
  return { pair, result, progress, running: progress < 1 };
}

function SimulateTab({ cfg, setCfg, batch }) {
  const [optimising, setOptimising] = useState(false);
  const [optResult, setOptResult] = useState(null);
  const onOptimise = () => {
    setOptimising(true);
    setTimeout(() => {
      const o = E.optimiseTimings(cfg);
      setOptResult(o);
      setCfg(c => E.withTimings(c, o));
      setOptimising(false);
    }, 30);
  };
  const { pair, result, progress, running } = batch;
  return html`<div class="sim-grid">
    <aside class="sim-side"><${SettingsPanel} cfg=${cfg} setCfg=${setCfg} onOptimise=${onOptimise} optimising=${optimising} optResult=${optResult} /></aside>
    <div class="sim-main">
      <${Headline} result=${result} running=${running} progress=${progress} />
      ${pair && html`<${Animation} cfg=${cfg} pair=${pair} />`}
      ${result && html`<${ComparisonTable} agg=${result.agg} />`}
      ${result && html`<${Charts} result=${result} />`}
      ${result && pair && html`<${ApproachTable} cfg=${cfg} pair=${pair} result=${result} />`}
      ${result && pair && html`<${ExportPanel} cfg=${cfg} setCfg=${setCfg} pair=${pair} result=${result} />`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Scenarios tab (plan section 7)

function ScenariosTab({ cfg, setCfg, goSimulate }) {
  const [timing, setTiming] = useState('tuned');
  const [reps, setReps] = useState(100);
  const [rows, setRows] = useState(() => readStore('tlem-scen', null));
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const cancel = useRef(false);
  useEffect(() => () => { cancel.current = true; }, []);
  const prepare = (s) => {
    let c = { ...s.apply(E.normaliseConfig(cfg)), reps };
    if (timing === 'tuned') c = E.withTimings(c, E.optimiseTimings(c));
    return c;
  };
  const runAll = async () => {
    setRunning(true); cancel.current = false;
    const out = [];
    for (const s of E.SCENARIOS) {
      setStatus(`${s.name}: ${timing === 'tuned' ? 'tuning signal timings…' : 'running…'}`);
      await breathe(true);
      const c = prepare(s);
      let list = [];
      for (let r = 0; r < reps; r++) {
        const { A, B } = E.runPair(c, E.repSeed(c.seed, r), { seriesStep: 300 });
        list.push({ rep: r, A, B });
        if (await breathe()) { setStatus(`${s.name}: run ${r + 1} of ${reps}`); if (cancel.current) { setRunning(false); return; } }
      }
      let agg = E.aggregate(list);
      // Close call: run 200 more repetitions before reporting.
      if (agg.diff.avgDelay.p10 < 0 && agg.diff.avgDelay.p90 > 0) {
        for (let r = reps; r < reps + 200; r++) {
          const { A, B } = E.runPair(c, E.repSeed(c.seed, r), { seriesStep: 300 });
          list.push({ rep: r, A, B });
          if (await breathe()) { setStatus(`${s.name}: close result, extra run ${r + 1 - reps} of 200`); if (cancel.current) { setRunning(false); return; } }
        }
        agg = E.aggregate(list);
      }
      const { reps: _r, ...cfgOut } = c;
      out.push({ id: s.id, name: s.name, note: s.note, cfg: { ...cfgOut, reps }, agg: slimAgg(agg) });
      setRows(out.slice());
    }
    writeStore('tlem-scen', out);
    setStatus(''); setRunning(false);
  };
  return html`<section class="panel">
    <div class="panel-head"><h2>Test scenarios</h2>
      <div class="btn-row">
        <${Seg} label="Signal timings" value=${timing} onChange=${setTiming} options=${[['tuned', 'Tuned for each'], ['asset', 'As configured']]} />
        <select id="scen-reps" aria-label="Runs per scenario" value=${reps} onChange=${e => setReps(Number(e.target.value))}>
          ${[50, 100, 200, 300].map(n => html`<option key=${n} value=${n}>${n} runs each</option>`)}
        </select>
        <button class="btn primary" onClick=${runAll} disabled=${running}>${running ? 'Running…' : rows ? 'Run again' : 'Run all scenarios'}</button>
      </div>
    </div>
    <p class="lede">Each scenario runs ${reps} times with fresh random traffic, identical for both arrangements. If the 10th–90th percentile range of the delay difference spans zero, 200 more runs are added. "Tuned for each" first searches the cycle length and green split separately for two-way and four-way, so neither is handicapped by poor timing. Other settings (headway, gap, changeover) come from the Simulation tab.</p>
    ${status && html`<p class="note">${status}</p>`}
    ${rows && html`<div class="table-wrap"><table>
      <thead><tr><th>Scenario</th><th>Runs</th><th>Cycle A / B</th><th>Delay A / B</th><th>Change in delay</th><th>Throughput change</th><th>Four-way better in</th><th>Unstable A / B</th><th></th></tr></thead>
      <tbody>
        ${rows.map(r => {
          const d = r.agg.diff.avgDelay;
          return html`<tr key=${r.id}>
            <td><b>${r.name}</b><br /><span class="note">${r.note}</span></td>
            <td>${r.agg.n}</td>
            <td>${fmt(r.cfg.cycle, 0)} / ${fmt(r.cfg.separateTimings ? r.cfg.cycleB : r.cfg.cycle, 0)} s</td>
            <td>${fmt(r.agg.A.avgDelay.median, 0)} / ${fmt(r.agg.B.avgDelay.median, 0)} s</td>
            <td class=${d.p90 < 0 ? 'better' : d.p10 > 0 ? 'worse' : ''}>${signed(d.median, 1)} s<span class="range">${signed(d.p10, 1)} to ${signed(d.p90, 1)}</span></td>
            <td>${signed(r.agg.diff.throughputPct.median)}%<span class="range">${signed(r.agg.diff.throughputPct.p10)} to ${signed(r.agg.diff.throughputPct.p90)}%</span></td>
            <td>${fmt(r.agg.bWinsDelay * 100, 0)}%</td>
            <td>${fmt(r.agg.unstableA * 100, 0)}% / <span class=${r.agg.unstableB > 0.5 ? 'worse' : ''}>${fmt(r.agg.unstableB * 100, 0)}%</span></td>
            <td><button class="btn" onClick=${() => { setCfg({ ...E.normaliseConfig(r.cfg), symmetric: r.cfg.approaches.every(a => JSON.stringify(a) === JSON.stringify(r.cfg.approaches[0])) }); goSimulate(); }}>Open</button></td>
          </tr>`;
        })}
      </tbody>
    </table></div>
    <p class="note">Change in delay is four-way minus two-way, seconds per vehicle: median, then the 10th–90th percentile range. Unstable is the share of runs where queues kept growing.</p>`}
    ${!rows && !running && html`<p class="note">Nothing run yet. Tuned runs take roughly half a minute in total.</p>`}
  </section>`;
}

function slimAgg(agg) {
  const pick = s => ({ median: s.median, p10: s.p10, p90: s.p90 });
  const out = { n: agg.n, bWinsDelay: agg.bWinsDelay, unstableA: agg.unstableA, unstableB: agg.unstableB, A: {}, B: {}, diff: {} };
  for (const k of Object.keys(agg.A)) { out.A[k] = pick(agg.A[k]); out.B[k] = pick(agg.B[k]); }
  for (const k of Object.keys(agg.diff)) out.diff[k] = pick(agg.diff[k]);
  return out;
}

// ---------------------------------------------------------------------------
// Sensitivity tab

const X_AXES = {
  volume: { label: 'Vehicles per approach (veh/h)', values: [100, 200, 300, 400, 500, 600, 700, 800], apply: (c, v) => ({ ...c, approaches: c.approaches.map(a => ({ ...a, volume: v })) }), fmt: v => v },
  cycle: { label: 'Signal cycle (s)', values: [40, 60, 80, 100, 120, 140, 160, 180], apply: (c, v) => ({ ...c, cycle: v, cycleB: v }), fmt: v => v },
  gap: { label: 'Right-turn gap required (s)', values: [3, 4, 5, 6, 7, 8, 10, 12], apply: (c, v) => ({ ...c, gap: v }), fmt: v => v },
  oppose: { label: 'Opposing flow, north–south (veh/h)', values: [100, 200, 300, 400, 500, 600, 700, 800], apply: (c, v) => ({ ...c, approaches: c.approaches.map((a, i) => (i === 2 ? { ...a, volume: v } : a)) }), fmt: v => v },
};

function divergingColour(v, lim) {
  // blue = two-way better (v > 0), red = four-way better (v < 0), grey midpoint
  const mid = cssVar('--div-mid') || '#f0efec';
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const m = hex(mid), blue = hex('#2a78d6'), red = hex('#e34948');
  const k = Math.min(1, Math.sqrt(Math.abs(v) / lim));
  const end = v > 0 ? blue : red;
  const c = m.map((x, i) => Math.round(x + (end[i] - x) * k));
  return `rgb(${c.join(',')})`;
}

function SensitivityTab({ cfg }) {
  const [xKey, setXKey] = useState('volume');
  const [reps, setReps] = useState(20);
  const [timing, setTiming] = useState('webster');
  const [grid, setGrid] = useState(null);
  const [prog, setProg] = useState(0);
  const [running, setRunning] = useState(false);
  const [hover, setHover] = useState(null);
  const cancel = useRef(false);
  useEffect(() => () => { cancel.current = true; }, []);
  const ys = [0, 10, 20, 30, 40, 50, 60];
  const xa = X_AXES[xKey];
  const run = async () => {
    setRunning(true); cancel.current = false;
    const cells = [];
    const total = xa.values.length * ys.length;
    for (const y of ys) for (const x of xa.values) {
      let c = xa.apply({ ...cfg, approaches: cfg.approaches.map(a => ({ ...a, right: y, left: Math.min(a.left, 100 - y) })) }, x);
      if (xKey === 'oppose') c = { ...c, approaches: c.approaches.map((a, i) => (i === 2 ? { ...a, right: 0 } : a)) };
      if (timing === 'webster' && xKey !== 'cycle') c = E.websterConfig(c);
      const cell = E.compareCell(c, reps);
      cells.push({ x, y, ...cell });
      if (await breathe()) { setProg(cells.length / total); if (cancel.current) return; }
    }
    setGrid({ xKey, cells, reps, timing });
    setRunning(false); setProg(1);
  };
  const ref = useRef(null);
  const W = useWidth(ref, 640);
  const g = grid;
  const gx = g ? X_AXES[g.xKey] : xa;
  const pad = { l: 56, r: 10, t: 10, b: 44 };
  const cw = Math.max(34, (W - pad.l - pad.r) / gx.values.length), ch = 34;
  const svgW = pad.l + cw * gx.values.length + pad.r, svgH = pad.t + ch * ys.length + pad.b;
  const lim = g ? Math.max(5, ...g.cells.map(c => Math.min(120, Math.abs(c.diffMedian)))) : 1;
  return html`<section class="panel">
    <div class="panel-head"><h2>Where each arrangement wins</h2>
      <div class="btn-row">
        <select id="sens-x" aria-label="Vary across" value=${xKey} onChange=${e => setXKey(e.target.value)}>
          ${Object.entries(X_AXES).map(([k, a]) => html`<option key=${k} value=${k}>${a.label}</option>`)}
        </select>
        <${Seg} label="Timings" value=${timing} onChange=${setTiming} options=${[['webster', 'Tuned (Webster)'], ['asset', 'As configured']]} />
        <select id="sens-reps" aria-label="Runs per cell" value=${reps} onChange=${e => setReps(Number(e.target.value))}>
          ${[10, 20, 50, 100].map(n => html`<option key=${n} value=${n}>${n} runs per cell</option>`)}
        </select>
        <button class="btn primary" onClick=${run} disabled=${running}>${running ? `Running ${Math.round(prog * 100)}%` : 'Run'}</button>
      </div>
    </div>
    <p class="lede">Right-turn percentage against ${xa.label.toLowerCase()}. Each cell is the median change in average delay from switching to four-way, over ${reps} runs. Everything else comes from the Simulation tab${xKey === 'oppose' ? '; the South approach carries the varied opposing flow with no right-turners, the other approaches keep their volumes' : ', with the same values on all four approaches'}. "Tuned (Webster)" gives each arrangement its own Webster cycle and demand-based green split.</p>
    ${running && html`<div class="progress"><div style=${{ width: `${prog * 100}%` }}></div></div>`}
    <div class="heat-wrap chart" ref=${ref}>
      ${g ? html`<svg viewBox="0 0 ${svgW} ${svgH}" style=${{ width: svgW + 'px', maxWidth: 'none' }} role="img" aria-label="Heatmap of delay change">
        ${ys.map((y, j) => html`<text key=${'y' + y} x=${pad.l - 8} y=${pad.t + (ys.length - 1 - j) * ch + ch / 2 + 4} text-anchor="end">${y}%</text>`)}
        ${gx.values.map((x, i) => html`<text key=${'x' + x} x=${pad.l + i * cw + cw / 2} y=${pad.t + ys.length * ch + 16} text-anchor="middle">${gx.fmt(x)}</text>`)}
        <text x=${pad.l + cw * gx.values.length / 2} y=${svgH - 4} text-anchor="middle">${gx.label}</text>
        <text x=${12} y=${pad.t + ch * ys.length / 2} text-anchor="middle" transform=${`rotate(-90 12 ${pad.t + ch * ys.length / 2})`}>Turning right</text>
        ${g.cells.map(c => {
          const i = gx.values.indexOf(c.x), j = ys.indexOf(c.y);
          const x = pad.l + i * cw, y = pad.t + (ys.length - 1 - j) * ch;
          const fill = divergingColour(c.diffMedian, lim);
          const strong = Math.abs(c.diffMedian) / lim > 0.35;
          return html`<g key=${c.x + '-' + c.y} onMouseEnter=${() => setHover({ c, left: x + cw / 2, top: y })} onMouseLeave=${() => setHover(null)}>
            <rect x=${x + 1} y=${y + 1} width=${cw - 2} height=${ch - 2} rx="3" fill=${fill} />
            <text x=${x + cw / 2} y=${y + ch / 2 + 4} text-anchor="middle" style=${{ fill: strong ? '#fff' : 'var(--ink)', fontWeight: 600 }}>${Math.abs(c.diffMedian) >= 100 ? (c.diffMedian > 0 ? '+' : '−') + Math.round(Math.abs(c.diffMedian)) : signed(c.diffMedian, 0)}</text>
          </g>`;
        })}
      </svg>` : html`<p class="note">Choose what to vary, then Run. 56 cells at 20 runs each takes a few seconds.</p>`}
      ${hover && html`<div class="tip" style=${{ left: Math.min(hover.left + 10, W - 230) + 'px', top: hover.top + 'px' }}>
        <b>${hover.c.y}% right</b>, ${gx.label.toLowerCase()} ${gx.fmt(hover.c.x)}<br />
        Delay: two-way ${fmt(hover.c.delayA, 1)} s, four-way ${fmt(hover.c.delayB, 1)} s<br />
        Four-way better in ${fmt(hover.c.bWins * 100, 0)}% of runs
      </div>`}
    </div>
    ${g && html`<div class="heat-legend">
      <span>Four-way better</span>
      <span class="bar" style=${{ background: `linear-gradient(90deg, ${divergingColour(-lim, lim)}, ${divergingColour(0, lim)}, ${divergingColour(lim, lim)})` }}></span>
      <span>Two-way better</span>
      <span class="note">Seconds per vehicle, four-way minus two-way. Colour saturates at ±${fmt(lim, 0)} s.</span>
    </div>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Method tab

function MethodTab() {
  return html`<section class="panel method">
    <h2>How the model works</h2>
    <p class="lede">The model follows individual vehicles rather than averaging green time, so right-turn blocking comes from the simulated oncoming traffic instead of being assumed.</p>
    <dl>
      <dt>Traffic</dt><dd>Vehicles arrive at random (a Poisson process) on each approach at the set hourly rate. Each one is assigned straight on, left or right at random using the set percentages. Both arrangements receive exactly the same vehicles at exactly the same times. A fixed seed reproduces every run.</dd>
      <dt>UK left-hand traffic</dt><dd>Vehicles drive on the left. Right-turners cross the oncoming flow and give way to oncoming straight-on and left-turning vehicles. Oncoming right-turners do not conflict with them.</dd>
      <dt>Queues and discharge</dt><dd>Each lane queues at its stop line. On green, the front vehicle leaves no sooner than one discharge headway after the previous one, and only if a full headway of green remains. Delay is the time from reaching the stop line to crossing it.</dd>
      <dt>Signal changeover</dt><dd>The changeover time (amber plus all-red) after each phase is lost time: nobody starts during it. Two-way has two changeovers per cycle, four-way has four.</dd>
      <dt>Right turns under two-way</dt><dd>The front right-turner goes only when the last oncoming vehicle passed at least 1.5 s ago and the next oncoming vehicle is at least the required gap away. That next vehicle is projected from the oncoming queue and its upcoming arrivals. With one shared lane, everyone behind a waiting right-turner is stuck. That lost green is reported as blocked green.</dd>
      <dt>End of green</dt><dd>Right-turners already waiting in the junction clear during the changeover, up to the set number per lane. The default is 1, at the cautious end of UK practice.</dd>
      <dt>Facing right-turners</dt><dd>When both oncoming queues have a right-turner at the front, they turn together. Untick the setting to make them go one at a time. Below about 350 vehicles per hour per approach, the two settings give similar results.</dd>
      <dt>Right-turn lane</dt><dd>With a right-turn lane, right-turners queue separately and only block the ahead lane when their lane is full.</dd>
      <dt>Four-way</dt><dd>Each approach runs alone, so no turn ever waits for a gap. The cost is that each approach gets roughly a quarter of the cycle, less four changeovers.</dd>
      <dt>Measures</dt><dd>Throughput counts vehicles that crossed within the period. Average delay includes time already waited by vehicles still queued at the end, so the arrangement that leaves a longer queue is not flattered. Average queue is total delay divided by the period. Queues are flagged unstable when they grow by more than 0.25 vehicles a minute over the second half of the period and more than 5% of the period's vehicles (at least 10) are left waiting at the end.</dd>
      <dt>Fair timings</dt><dd>"Optimise timings for each" searches cycle lengths from 40 to 180 s and both split rules separately for each arrangement. It minimises average delay on a common set of traffic samples.</dd>
      <dt>Not yet modelled</dt><dd>Pedestrians, right-turn filter arrows, slower turning vehicles, platoons arriving from upstream signals, and drivers' lane choice on two-lane approaches.</dd>
    </dl>
  </section>`;
}

// ---------------------------------------------------------------------------
// App

function initialConfig() {
  const saved = readStore('tlem-cfg', null);
  const c = saved ? E.normaliseConfig(saved) : E.defaultConfig();
  c.symmetric = saved?.symmetric ?? true;
  return c;
}

function App() {
  const [tab, setTab] = useState(() => {
    const h = location.hash.slice(1);
    return TABS.some(t => t.id === h) ? h : readStore('tlem-tab', 'simulate');
  });
  const [cfg, setCfg] = useState(initialConfig);
  useEffect(() => writeStore('tlem-cfg', cfg), [cfg]);
  useEffect(() => writeStore('tlem-tab', tab), [tab]);
  const batch = useBatch(cfg);
  const lastBlocked = batch.result ? batch.result.agg.A.blockedGreen.median / 4 / (cfg.duration * 60 / E.buildPlan(cfg, 'A').cycle) : null;
  const tabs = html`${TABS.map(t => html`<button key=${t.id} role="tab" aria-selected=${tab === t.id} onClick=${() => setTab(t.id)}>${t.label}</button>`)}`;
  return html`<${React.Fragment}>
    ${ReactDOM.createPortal(tabs, document.getElementById('tabs'))}
    <div class="btn-row" style=${{ justifyContent: 'space-between' }}>
      <span class="uk">UK left-hand traffic · right-turners cross the oncoming flow</span>
      <span class="note">A = two-way (north–south, then east–west) · B = four-way (one approach at a time)</span>
    </div>
    ${tab === 'capacity' && html`<${CapacityTab} lastSim=${lastBlocked} />`}
    ${tab === 'simulate' && html`<${SimulateTab} cfg=${cfg} setCfg=${setCfg} batch=${batch} />`}
    ${tab === 'scenarios' && html`<${ScenariosTab} cfg=${cfg} setCfg=${setCfg} goSimulate=${() => setTab('simulate')} />`}
    ${tab === 'sensitivity' && html`<${SensitivityTab} cfg=${cfg} />`}
    ${tab === 'method' && html`<${MethodTab} />`}
  </${React.Fragment}>`;
}

const root = document.getElementById('root');
root.innerHTML = '';
ReactDOM.createRoot(root).render(html`<${App} />`);
