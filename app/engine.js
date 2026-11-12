// Traffic Light Efficiency Model: simulation engine.
// Plain ES module, no DOM or React. Used by the browser app and by the Node tests.
//
// UK left-hand traffic. Approaches are indexed N=0, E=1, S=2, W=3.
// Right-turners cross the opposing flow; left-turners have no conflict.

export const APPROACHES = ['N', 'E', 'S', 'W'];
export const APPROACH_NAMES = ['North', 'East', 'South', 'West'];
export const TURNS = ['L', 'S', 'R'];
export const OPPOSITE = [2, 3, 0, 1];
export const MODELS = ['A', 'B'];
export const MODEL_NAMES = { A: 'Two-way', B: 'Four-way' };

const EPS = 1e-9;
// A right-turner may not start until this long after an opposing vehicle has crossed the
// stop line, so it turns behind that vehicle rather than into it.
export const OPPOSING_CLEARANCE = 1.5;

// ---------------------------------------------------------------------------
// Configuration

export function defaultApproach(overrides = {}) {
  return { volume: 600, right: 20, left: 10, layout: 'shared', storage: 6, ...overrides };
}

export function defaultConfig() {
  return {
    duration: 60,          // minutes
    cycle: 120,            // seconds, used by both models unless separate timings are on
    cycleB: 120,           // four-way cycle when separateTimings is true
    separateTimings: false,
    split: 'equal',        // 'equal' | 'demand'
    headway: 2.5,          // saturation discharge headway, s/veh
    lostTime: 4,           // intergreen (amber + all-red) lost per phase, s
    gap: 5,                // critical gap for an opposed right turn, s
    amberClear: 1,         // opposed right-turners that clear at the end of green, per lane
    mutualTurns: true,     // facing right-turners at the queue heads turn together (false: one at a time)
    minGreen: 7,           // s, floor for demand-proportional splits
    seed: 1,
    reps: 100,
    approaches: [0, 1, 2, 3].map(() => defaultApproach()),
  };
}

export function normaliseConfig(cfg) {
  const base = defaultConfig();
  const out = { ...base, ...cfg };
  out.approaches = [0, 1, 2, 3].map(i => defaultApproach({ ...(cfg.approaches?.[i] || {}) }));
  return out;
}

// ---------------------------------------------------------------------------
// Random numbers: mulberry32 seeded PRNG, so a seed reproduces a run exactly.

export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distinct seed per repetition, derived from the base seed.
export function repSeed(seed, rep) {
  let h = (Math.imul(seed >>> 0, 0x85ebca6b) ^ Math.imul(rep + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Traffic generation: Poisson arrivals per approach, turn drawn per vehicle.

export function generateTraffic(cfg, seed) {
  const r = rng(seed);
  const T = cfg.duration * 60;
  const vehicles = [];
  cfg.approaches.forEach((ap, a) => {
    const rate = ap.volume / 3600;
    if (rate <= 0) return;
    const pR = ap.right / 100, pL = ap.left / 100;
    let t = 0;
    for (;;) {
      t += -Math.log(1 - r()) / rate;
      if (t >= T) break;
      const u = r();
      const turn = u < pR ? 'R' : u < pR + pL ? 'L' : 'S';
      vehicles.push({ approach: a, arrive: t, turn });
    }
  });
  vehicles.sort((x, y) => x.arrive - y.arrive || x.approach - y.approach);
  vehicles.forEach((v, i) => { v.id = i; });
  return vehicles;
}

// ---------------------------------------------------------------------------
// Signal plans

// Webster's optimum cycle, clamped to a practical range.
export function websterCycle(totalLost, Y) {
  if (Y >= 0.95) return 180;
  return Math.max(40, Math.min(180, Math.round((1.5 * totalLost + 5) / (1 - Y))));
}

// Flow ratio of an approach: demand over saturation flow of its busiest lane.
function flowRatio(ap, headway) {
  const s = 3600 / headway;
  const ahead = ap.layout === 'pocket' ? ap.volume * (1 - ap.right / 100) : ap.volume;
  return ahead / s;
}

// Build the phase list for a model: [{ approaches, green }], plus cycle and lost time.
export function buildPlan(cfg, model) {
  const groups = model === 'A' ? [[0, 2], [1, 3]] : [[0], [1], [2], [3]];
  const cycle = model === 'B' && cfg.separateTimings ? cfg.cycleB : cfg.cycle;
  const L = cfg.lostTime;
  const available = Math.max(groups.length, cycle - groups.length * L);
  let weights = groups.map(() => 1);
  if (cfg.split === 'demand') {
    weights = groups.map(g => Math.max(...g.map(a => flowRatio(cfg.approaches[a], cfg.headway)), 1e-3));
  }
  const wsum = weights.reduce((s, w) => s + w, 0);
  let greens = weights.map(w => available * w / wsum);
  if (cfg.split === 'demand') {
    const minG = Math.min(cfg.minGreen, available / groups.length);
    // Raise any phase below the minimum and take the time from the others pro rata.
    for (let k = 0; k < 3; k++) {
      const short = greens.map(g => g < minG);
      const deficit = greens.reduce((s, g, i) => s + (short[i] ? minG - g : 0), 0);
      const spare = greens.reduce((s, g, i) => s + (short[i] ? 0 : g - minG), 0);
      if (deficit <= 0 || spare <= 0) break;
      greens = greens.map((g, i) => short[i] ? minG : g - (g - minG) * deficit / spare);
    }
  }
  let off = 0;
  const phases = groups.map((g, i) => {
    const p = { approaches: g, green: greens[i], start: off };
    off += greens[i] + L;
    return p;
  });
  return { model, cycle: off, lostTime: L, phases };
}

// Webster-tuned timings for both models: optimum cycle per model and demand-proportional splits.
export function websterConfig(cfg) {
  const y = cfg.approaches.map(ap => flowRatio(ap, cfg.headway));
  const YA = Math.max(y[0], y[2]) + Math.max(y[1], y[3]);
  const YB = y.reduce((s, v) => s + v, 0);
  return { ...cfg, split: 'demand', separateTimings: true,
    cycle: websterCycle(2 * cfg.lostTime, YA), cycleB: websterCycle(4 * cfg.lostTime, YB) };
}

// Per-approach signal timing lookup.
function approachTiming(plan) {
  const t = [];
  plan.phases.forEach(p => p.approaches.forEach(a => { t[a] = { off: p.start, green: p.green }; }));
  return t;
}

// Earliest time >= x at which approach a can start a departure needing h seconds of green.
function earliestStart(tm, C, x, h) {
  const { off, green } = tm;
  if (green < h - EPS) return Infinity;
  const k = Math.floor((x - off) / C);
  const gs = off + k * C;
  if (x <= gs + green - h + EPS) return Math.max(x, gs);
  return gs + C;
}

// Green time of approach (timing tm) that falls inside [t0, t1].
export function greenOverlap(tm, C, t0, t1) {
  if (t1 <= t0) return 0;
  let k = Math.floor((t0 - tm.off) / C);
  let total = 0;
  for (;;) {
    const gs = tm.off + k * C, ge = gs + tm.green;
    if (gs >= t1) break;
    total += Math.max(0, Math.min(ge, t1) - Math.max(gs, t0));
    k++;
  }
  return total;
}

// Signal aspect for an approach at time t: 'G', 'A' (amber), 'RA' (red+amber) or 'R'.
export function signalState(plan, a, t) {
  const tm = approachTiming(plan)[a];
  const C = plan.cycle;
  const ph = ((t - tm.off) % C + C) % C;
  if (ph < tm.green) return 'G';
  if (ph < tm.green + Math.min(3, plan.lostTime)) return 'A';
  if (ph > C - Math.min(2, plan.lostTime / 2)) return 'RA';
  return 'R';
}

// ---------------------------------------------------------------------------
// Discrete-event simulation of one model over one set of vehicles.
//
// Point queues at each stop line. A lane discharges its head vehicle no earlier than
// (previous start + headway) and only if a full headway of green remains. Arrivals,
// departure candidates and end-of-green events are processed in time order.
//
// Opposed right turns (Model A only): the head right-turner may start at time c only
// if no conflicting opposing vehicle (straight or left) will cross within `gap` seconds.
// The opposing stream's next crossing is projected from its queue and its known future
// arrivals. Facing right-turners turn together. At the end of each green, up to
// `amberClear` right-turners already waiting in the junction clear during the intergreen.

export function simulate(cfg, vehicles, model) {
  const plan = buildPlan(cfg, model);
  const C = plan.cycle;
  const h = cfg.headway;
  const T = cfg.duration * 60;
  const timing = approachTiming(plan);
  const opposed = model === 'A';
  // partner[a] = opposing approach running in the same phase, or -1
  const partner = [0, 1, 2, 3].map(a => {
    if (!opposed) return -1;
    const ph = plan.phases.find(p => p.approaches.includes(a));
    return ph.approaches.find(b => b !== a) ?? -1;
  });

  const recs = vehicles.map(v => ({
    id: v.id, approach: v.approach, turn: v.turn, arrive: v.arrive,
    depart: null, lane: 0, obstructed: false, waitedForGap: false, amber: false,
  }));

  // Lanes: lane 0 = main (left/ahead, or everything when shared); lane 1 = right-turn pocket.
  const lanes = cfg.approaches.map((ap, a) => {
    const ls = [{ a, idx: 0, q: [], head: 0, readyAt: -Infinity, recheck: -Infinity }];
    if (ap.layout === 'pocket') ls.push({ a, idx: 1, q: [], head: 0, readyAt: -Infinity, recheck: -Infinity, storage: ap.storage });
    return ls;
  });
  const allLanes = lanes.flat();
  const blocked = [0, 0, 0, 0];      // seconds of green lost behind a waiting right-turner
  const futureByApproach = [[], [], [], []];
  recs.forEach(v => futureByApproach[v.approach].push(v));
  const futurePtr = [0, 0, 0, 0];
  const lastConflict = [-Infinity, -Infinity, -Infinity, -Infinity]; // latest straight/left start per approach

  // End-of-green events (only matter for opposed right turns)
  const phaseEnds = plan.phases.map(p => p.start + p.green);

  const isConflicting = v => v.turn !== 'R';

  function laneSize(l) { return l.q.length - l.head; }

  function assign(v) {
    const ls = lanes[v.approach];
    let lane = ls[0];
    if (ls.length > 1 && v.turn === 'R') {
      // Join the pocket if it has room, otherwise wait in the main lane and block it.
      if (laneSize(ls[1]) < ls[1].storage) lane = ls[1];
    }
    v.lane = lane.idx;
    lane.q.push(v);
    futurePtr[v.approach]++;
  }

  function candidate(l) {
    if (l.head >= l.q.length) return Infinity;
    const v = l.q[l.head];
    const x = Math.max(v.arrive, l.readyAt, l.recheck);
    return earliestStart(timing[l.a], C, x, h);
  }

  // Projected earliest start of the next conflicting vehicle from approach o at or after c.
  // Also reports which ready right-turners at the head would turn alongside.
  function nextConflict(o, c, mutual) {
    let best = Infinity;
    for (const l of lanes[o]) {
      if (l.idx === 1) continue;            // pocket holds only right-turners: never conflicts
      let p = Math.max(l.readyAt, -Infinity);
      let i = l.head;
      let fp = futurePtr[o];
      const fut = futureByApproach[o];
      const pocketMode = lanes[o].length > 1;
      let first = true;
      for (;;) {
        let v;
        if (i < l.q.length) v = l.q[i++];
        else {
          // future arrivals that will join this lane (pocket-bound right-turners skipped)
          while (fp < fut.length && pocketMode && fut[fp].turn === 'R') fp++;
          if (fp >= fut.length) break;
          v = fut[fp++];
        }
        p = Math.max(p, v.arrive, c);
        if (p >= c + cfg.gap) break;
        if (isConflicting(v)) { best = Math.min(best, p); break; }
        if (first && p <= c + EPS) {
          // A right-turner already waiting at the head of the opposing lane holds the
          // vehicles behind it, so that lane offers no conflict now. With mutual turns
          // both go together; otherwise this one goes first and the other waits for a gap.
          if (cfg.mutualTurns !== false) mutual.push(l);
          break;
        }
        first = false;
        p += h;
      }
    }
    return best;
  }

  function depart(l, v, t) {
    v.depart = t;
    l.head++;
    l.readyAt = t + h;
    l.recheck = -Infinity;
    if (v.turn !== 'R') lastConflict[l.a] = t;
    if (v.blockFrom != null) {
      endBlock(l, v, t);
    }
  }

  // Close an obstruction interval for right-turner v that waited at the head of lane l.
  function endBlock(l, v, t) {
    const next = l.q[l.head];   // vehicle behind it (head already advanced)
    if (next && next.arrive < t) {
      const from = Math.max(v.blockFrom, next.arrive);
      blocked[l.a] += greenOverlap(timing[l.a], C, from, Math.min(t, T));
      for (let i = l.head; i < l.q.length && l.q[i].arrive < t; i++) l.q[i].obstructed = true;
    }
    v.blockFrom = null;
  }

  let arrPtr = 0;
  const N = recs.length;
  let guard = 0;
  for (;;) {
    if (++guard > 5e6) throw new Error('simulation did not terminate');
    // Next departure candidate
    let bestT = Infinity, bestLane = null, bestPrio = 2;
    for (const l of allLanes) {
      const ct = candidate(l);
      if (ct === Infinity) continue;
      const v = l.q[l.head];
      const prio = opposed && v.turn === 'R' && partner[l.a] >= 0 ? 1 : 0;
      if (ct < bestT - EPS || (Math.abs(ct - bestT) <= EPS && prio < bestPrio)) {
        bestT = ct; bestLane = l; bestPrio = prio;
      }
    }
    const nextArr = arrPtr < N ? recs[arrPtr].arrive : Infinity;
    let endIdx = -1, endT = Infinity;
    if (opposed && cfg.amberClear > 0) {
      phaseEnds.forEach((e, i) => { if (e < endT) { endT = e; endIdx = i; } });
    }
    const tNext = Math.min(bestT, nextArr, endT);
    if (tNext >= T) break;

    if (nextArr <= bestT + EPS && nextArr <= endT) {
      assign(recs[arrPtr++]);
      continue;
    }
    if (endT < bestT) {
      // End of green for this phase: waiting opposed right-turners clear in the intergreen.
      const ph = plan.phases[endIdx];
      for (const a of ph.approaches) {
        if (partner[a] < 0) continue;
        for (const l of lanes[a]) {
          let n = 0;
          while (n < cfg.amberClear && l.head < l.q.length) {
            const v = l.q[l.head];
            if (v.turn !== 'R' || v.arrive > endT - h + EPS) break;
            if (n === 0 && !v.waitedForGap) break;
            v.amber = true;
            depart(l, v, endT + n * Math.min(h, cfg.lostTime / Math.max(1, cfg.amberClear)));
            n++;
          }
        }
      }
      phaseEnds[endIdx] += C;
      continue;
    }

    // Departure candidate at bestT
    const l = bestLane, v = l.q[l.head], c = bestT;
    const o = partner[l.a];
    if (bestPrio === 0 || o < 0) {
      depart(l, v, c);
      continue;
    }
    // Opposed right turn: wait for the last oncoming vehicle to pass, then test the gap.
    const mutual = [];
    const behind = lastConflict[o] + OPPOSING_CLEARANCE;
    const nc = c < behind - EPS ? behind : nextConflict(o, c, mutual);
    if (c >= behind - EPS && nc - c >= cfg.gap - EPS) {
      depart(l, v, c);
      for (const ml of mutual) {
        const mv = ml.q[ml.head];
        if (mv && mv.turn === 'R' && mv.depart == null) depart(ml, mv, c);
      }
    } else {
      v.waitedForGap = true;
      if (v.blockFrom == null) v.blockFrom = c;
      l.recheck = Math.max(nc, c + 0.01);
    }
  }

  // Obstruction still in progress at the end of the period
  for (const l of allLanes) {
    const v = l.q[l.head];
    if (v && v.blockFrom != null) {
      const next = l.q[l.head + 1];
      if (next && next.arrive < T) {
        blocked[l.a] += greenOverlap(timing[l.a], C, Math.max(v.blockFrom, next.arrive), T);
        for (let i = l.head + 1; i < l.q.length; i++) l.q[i].obstructed = true;
      }
    }
  }
  // Departures recorded at or after T (amber clearances near the end) count as not cleared.
  for (const v of recs) if (v.depart != null && v.depart >= T) v.depart = null;

  return { model, plan, vehicles: recs, blocked, duration: T };
}

// ---------------------------------------------------------------------------
// Metrics

export function summarise(run, opts = {}) {
  const T = run.duration;
  const step = opts.seriesStep ?? 60;
  const per = [0, 1, 2, 3].map(() => ({ arrived: 0, departed: 0, delay: 0, maxQueue: 0, obstructed: 0 }));
  let delaySum = 0, departed = 0, departedDelay = 0, obstructed = 0;
  const events = [];
  for (const v of run.vehicles) {
    const p = per[v.approach];
    p.arrived++;
    const end = v.depart ?? T;
    const d = end - v.arrive;
    p.delay += d; delaySum += d;
    if (v.depart != null) { p.departed++; departed++; departedDelay += d; }
    if (v.obstructed) { p.obstructed++; obstructed++; }
    events.push([v.arrive, 1, v.approach]);
    if (v.depart != null) events.push([v.depart, -1, v.approach]);
  }
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  // Sweep for max queues and the queue time series.
  const q = [0, 0, 0, 0];
  let total = 0, maxTotal = 0;
  const nPts = Math.floor(T / step) + 1;
  const series = new Array(nPts).fill(0);
  const cumDeparted = new Array(nPts).fill(0);
  let ei = 0, deps = 0;
  for (let k = 0; k < nPts; k++) {
    const t = k * step;
    while (ei < events.length && events[ei][0] <= t) {
      const [, dlt, a] = events[ei++];
      q[a] += dlt; total += dlt;
      if (dlt < 0) deps++;
      if (q[a] > per[a].maxQueue) per[a].maxQueue = q[a];
      if (total > maxTotal) maxTotal = total;
    }
    series[k] = total;
    cumDeparted[k] = deps;
  }
  while (ei < events.length) {
    const [, dlt, a] = events[ei++];
    q[a] += dlt; total += dlt;
    if (q[a] > per[a].maxQueue) per[a].maxQueue = q[a];
    if (total > maxTotal) maxTotal = total;
  }
  const arrived = run.vehicles.length;
  const blockedTotal = run.blocked.reduce((s, b) => s + b, 0);
  const cycles = T / run.plan.cycle;
  const trend = queueTrend(series, step);
  const remaining = arrived - departed;
  return {
    model: run.model,
    arrived, departed, remaining,
    throughput: departed / (T / 3600),
    avgDelay: arrived ? delaySum / arrived : 0,          // includes time waited so far by uncleared vehicles
    avgDelayCleared: departed ? departedDelay / departed : 0,
    vehHoursDelay: delaySum / 3600,
    avgQueue: delaySum / T,                                // Little's law on point queues
    maxQueue: Math.max(...per.map(p => p.maxQueue)),
    maxQueueJunction: maxTotal,
    blockedGreen: blockedTotal,
    blockedPerApproachCycle: blockedTotal / 4 / cycles,
    obstructed,
    queueSlope: trend,                                     // veh/min over the second half
    unstable: trend > 0.25 && remaining > 10,
    perApproach: per.map((p, a) => ({
      ...p,
      avgDelay: p.arrived ? p.delay / p.arrived : 0,
      avgQueue: p.delay / T,
      blockedGreen: run.blocked[a],
    })),
    series, cumDeparted, seriesStep: step,
    cycle: run.plan.cycle,
  };
}

// Least-squares slope of the junction queue over the second half, in vehicles per minute.
function queueTrend(series, step) {
  const start = Math.floor(series.length / 2);
  const pts = series.slice(start);
  const n = pts.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  pts.forEach((y, i) => { sx += i; sy += y; sxx += i * i; sxy += i * y; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return slope * (60 / step);
}

// ---------------------------------------------------------------------------
// Comparison of A and B on identical traffic

export function runPair(cfg, seed, opts) {
  const vehicles = generateTraffic(cfg, seed);
  const runA = simulate(cfg, vehicles, 'A');
  const runB = simulate(cfg, vehicles, 'B');
  return { seed, vehicles, A: summarise(runA, opts), B: summarise(runB, opts), runA, runB };
}

export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function stats(arr) {
  const s = [...arr].sort((x, y) => x - y);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { median: quantile(s, 0.5), p10: quantile(s, 0.1), p90: quantile(s, 0.9), min: s[0], max: s[s.length - 1], mean };
}

const pct = (b, a) => (a === 0 ? (b === 0 ? 0 : Infinity) : (b - a) / a * 100);

export const COMPARE_KEYS = ['throughput', 'avgDelay', 'vehHoursDelay', 'avgQueue', 'maxQueue', 'remaining', 'blockedGreen'];

// Aggregate a list of per-rep {A, B} summaries.
export function aggregate(reps) {
  const out = { n: reps.length, A: {}, B: {}, diff: {} };
  for (const k of COMPARE_KEYS) {
    out.A[k] = stats(reps.map(r => r.A[k]));
    out.B[k] = stats(reps.map(r => r.B[k]));
    out.diff[k] = stats(reps.map(r => r.B[k] - r.A[k]));
  }
  out.diff.throughputPct = stats(reps.map(r => pct(r.B.throughput, r.A.throughput)));
  out.diff.delayPct = stats(reps.map(r => pct(r.B.vehHoursDelay, r.A.vehHoursDelay)));
  out.bWinsDelay = reps.filter(r => r.B.avgDelay < r.A.avgDelay).length / (reps.length || 1);
  out.unstableA = reps.filter(r => r.A.unstable).length / (reps.length || 1);
  out.unstableB = reps.filter(r => r.B.unstable).length / (reps.length || 1);
  return out;
}

// Run `reps` repetitions. Synchronous; for UI use, runBatchAsync yields between chunks.
export function runBatch(cfg, reps = cfg.reps, opts) {
  const list = [];
  for (let r = 0; r < reps; r++) {
    const { A, B } = runPair(cfg, repSeed(cfg.seed, r), opts);
    list.push({ rep: r, A, B });
  }
  return { reps: list, agg: aggregate(list) };
}

export async function runBatchAsync(cfg, reps = cfg.reps, onProgress, opts) {
  const list = [];
  for (let r = 0; r < reps; r++) {
    const { A, B } = runPair(cfg, repSeed(cfg.seed, r), opts);
    list.push({ rep: r, A, B });
    if (r % 5 === 4) { onProgress?.((r + 1) / reps); await new Promise(res => setTimeout(res, 0)); }
  }
  return { reps: list, agg: aggregate(list) };
}

// The headline sentence of plan section 10.
export function headline(agg) {
  const tp = agg.diff.throughputPct.median;
  const dl = agg.diff.avgDelay.median;
  const vh = agg.diff.delayPct.median;
  const f = (x, d = 1) => Math.abs(x).toFixed(d);
  const tpTxt = Math.abs(tp) < 0.05 ? 'the same number of vehicles' : `${f(tp)}% ${tp > 0 ? 'more' : 'fewer'} vehicles`;
  const dlTxt = Math.abs(dl) < 0.05 ? 'leaves average delay unchanged' : `${dl > 0 ? 'adds' : 'saves'} ${f(dl)} s of average delay per vehicle`;
  const vhTxt = !isFinite(vh) ? 'changes total queueing time from zero' : `${vh > 0 ? 'increases' : 'decreases'} total queueing time by ${f(vh, 0)}%`;
  return `Under the selected traffic conditions, four-way signalling processes ${tpTxt}, ${dlTxt}, and ${vhTxt}.`;
}

// ---------------------------------------------------------------------------
// Analytical capacity model (plan section 5): saturated, equal approaches.

export function capacityModel({ cycle = 120, lostTime = 4, headway = 2.5, blocked = 25 } = {}) {
  const gA = (cycle - 2 * lostTime) / 2;
  const gB = (cycle - 4 * lostTime) / 4;
  const perCycleA = 4 * Math.max(0, gA - blocked) / headway;
  const perCycleB = 4 * Math.max(0, gB) / headway;
  const net = perCycleB - perCycleA;
  return {
    greenA: gA, greenB: gB,
    perCycleA, perCycleB,
    perHourA: perCycleA * 3600 / cycle, perHourB: perCycleB * 3600 / cycle,
    net, netPct: perCycleA > 0 ? net / perCycleA * 100 : Infinity,
    breakEven: gA - gB,     // = 2 x lost time + cycle/4
    winner: Math.abs(net) < 1e-9 ? 'tie' : net > 0 ? 'B' : 'A',
  };
}

// ---------------------------------------------------------------------------
// Timing optimisation: search the cycle (and split) for each model separately,
// minimising mean average delay over a few repetitions of common traffic.

export function optimiseTimings(cfg, { reps = 12, cycles = [40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180], splits = ['equal', 'demand'] } = {}) {
  const traffic = [];
  for (let r = 0; r < reps; r++) traffic.push(generateTraffic(cfg, repSeed(cfg.seed + 7919, r)));
  const result = {};
  for (const model of MODELS) {
    let best = null;
    for (const split of splits) for (const C of cycles) {
      const c2 = { ...cfg, split, separateTimings: true, cycle: model === 'A' ? C : cfg.cycle, cycleB: model === 'B' ? C : cfg.cycleB };
      let sum = 0;
      for (const veh of traffic) sum += summarise(simulate(c2, veh, model), { seriesStep: 600 }).avgDelay;
      const d = sum / reps;
      if (!best || d < best.avgDelay - 1e-9) best = { cycle: C, split, avgDelay: d };
    }
    result[model] = best;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sensitivity: right-turn percentage x volume grid

export function sensitivityCell(cfg, volume, right, reps) {
  const c2 = {
    ...cfg,
    approaches: cfg.approaches.map(ap => ({ ...ap, volume, right, left: Math.min(ap.left, 100 - right) })),
  };
  const list = [];
  for (let r = 0; r < reps; r++) {
    const { A, B } = runPair(c2, repSeed(cfg.seed, r), { seriesStep: 600 });
    list.push({ A, B });
  }
  const dd = list.map(x => x.B.avgDelay - x.A.avgDelay).sort((a, b) => a - b);
  return {
    volume, right,
    delayA: list.reduce((s, x) => s + x.A.avgDelay, 0) / reps,
    delayB: list.reduce((s, x) => s + x.B.avgDelay, 0) / reps,
    diffMedian: quantile(dd, 0.5),
    bWins: list.filter(x => x.B.avgDelay < x.A.avgDelay).length / reps,
  };
}

// ---------------------------------------------------------------------------
// Scenarios (plan section 7)

export const SCENARIOS = [
  { id: 'quiet', name: 'Quiet junction', note: 'Low demand, 10% right turns. Tests the value of simultaneous green.',
    apply: c => ({ ...c, approaches: c.approaches.map(ap => ({ ...ap, volume: 250, right: 10, left: 10, layout: 'shared' })) }) },
  { id: 'typical', name: 'Typical junction', note: 'Medium demand, 20% right turns.',
    apply: c => ({ ...c, approaches: c.approaches.map(ap => ({ ...ap, volume: 450, right: 20, left: 10, layout: 'shared' })) }) },
  { id: 'busy', name: 'Busy junction', note: 'High demand, 20% right turns. Tests how often right-turners block.',
    apply: c => ({ ...c, approaches: c.approaches.map(ap => ({ ...ap, volume: 650, right: 20, left: 10, layout: 'shared' })) }) },
  { id: 'heavyRight', name: 'Heavy right turns', note: 'High demand, 40% right turns. Can four-way win?',
    apply: c => ({ ...c, approaches: c.approaches.map(ap => ({ ...ap, volume: 650, right: 40, left: 10, layout: 'shared' })) }) },
  { id: 'uneven', name: 'Uneven traffic', note: '70/30 split: north–south carries 70% of the traffic, east–west 30%.',
    apply: c => ({ ...c, approaches: c.approaches.map((ap, a) => ({ ...ap, volume: a % 2 === 0 ? 630 : 270, right: 20, left: 10, layout: 'shared' })) }) },
  { id: 'pocket', name: 'Dedicated turning lane', note: 'High demand, 30% right turns, with a right-turn lane holding 6 cars.',
    apply: c => ({ ...c, approaches: c.approaches.map(ap => ({ ...ap, volume: 650, right: 30, left: 10, layout: 'pocket', storage: 6 })) }) },
  { id: 'fourWayBest', name: 'Four-way’s best case', note: 'North: 250 veh/h, 80% turning right across 600 veh/h from the South; side roads quiet; right-turners need a 10 s gap (wide junction or poor sightlines); timings tuned for each model.',
    apply: c => ({ ...c, gap: 10, split: 'demand', separateTimings: true, cycle: 120, cycleB: 120,
      approaches: c.approaches.map((ap, a) => ({ ...ap, layout: 'shared', ...[
        { volume: 250, right: 80, left: 0 }, { volume: 30, right: 0, left: 0 }, { volume: 600, right: 0, left: 0 }, { volume: 30, right: 0, left: 0 }][a] })) }) },
];
