import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfig, generateTraffic, simulate, summarise, runPair, runBatch, capacityModel,
  buildPlan, repSeed, SCENARIOS, signalState, headline,
} from '../app/engine.js';

const withApproaches = (cfg, patch) => ({ ...cfg, approaches: cfg.approaches.map((ap, a) => ({ ...ap, ...(typeof patch === 'function' ? patch(ap, a) : patch) })) });

test('analytical capacity model matches plan section 5', () => {
  const m = capacityModel({ cycle: 120, lostTime: 4, headway: 2.5, blocked: 25 });
  assert.equal(m.perCycleA.toFixed(1), '49.6');
  assert.equal(m.perCycleB.toFixed(1), '41.6');
  assert.equal(m.net.toFixed(1), '-8.0');
  assert.equal(m.netPct.toFixed(1), '-16.1');
  assert.equal(m.breakEven.toFixed(1), '30.0');
  assert.equal(m.winner, 'A');
  assert.equal(capacityModel({ blocked: 35 }).winner, 'B');
});

test('signal plans fill the cycle', () => {
  const cfg = defaultConfig();
  const A = buildPlan(cfg, 'A'), B = buildPlan(cfg, 'B');
  assert.equal(A.cycle, 120); assert.equal(B.cycle, 120);
  assert.equal(A.phases[0].green, 56); assert.equal(B.phases[0].green, 26);
  assert.equal(signalState(A, 0, 10), 'G');
  assert.equal(signalState(A, 0, 57), 'A');
  assert.equal(signalState(A, 1, 10), 'R');
  const d = buildPlan({ ...withApproaches(cfg, (ap, a) => ({ volume: a % 2 ? 200 : 600 })), split: 'demand' }, 'A');
  assert.ok(d.phases[0].green > d.phases[1].green);
  assert.equal(Math.round(d.cycle), 120);
});

test('same seed reproduces identical traffic and results', () => {
  const cfg = defaultConfig();
  const p1 = runPair(cfg, 42), p2 = runPair(cfg, 42), p3 = runPair(cfg, 43);
  assert.deepEqual(p1.vehicles, p2.vehicles);
  assert.deepEqual(p1.A.series, p2.A.series);
  assert.equal(p1.A.avgDelay, p2.A.avgDelay);
  assert.equal(p1.B.avgDelay, p2.B.avgDelay);
  assert.notEqual(p1.A.avgDelay, p3.A.avgDelay);
  const b1 = runBatch({ ...cfg, reps: 5 }), b2 = runBatch({ ...cfg, reps: 5 });
  assert.deepEqual(b1.agg, b2.agg);
});

test('both models see identical incoming vehicles', () => {
  const cfg = defaultConfig();
  const p = runPair(cfg, 7);
  assert.equal(p.runA.vehicles.length, p.runB.vehicles.length);
  p.runA.vehicles.forEach((v, i) => {
    const w = p.runB.vehicles[i];
    assert.equal(v.arrive, w.arrive); assert.equal(v.turn, w.turn); assert.equal(v.approach, w.approach);
  });
});

test('arrival rate and turning mix follow the parameters', () => {
  const cfg = { ...defaultConfig(), duration: 600 };
  const veh = generateTraffic(cfg, 3);
  const perHour = veh.length / 4 / 10;
  assert.ok(Math.abs(perHour - 600) < 25, `rate ${perHour}`);
  const r = veh.filter(v => v.turn === 'R').length / veh.length;
  const l = veh.filter(v => v.turn === 'L').length / veh.length;
  assert.ok(Math.abs(r - 0.2) < 0.02); assert.ok(Math.abs(l - 0.1) < 0.02);
});

test('departures respect headway, green windows and ordering', () => {
  const cfg = defaultConfig();
  for (const model of ['A', 'B']) {
    const veh = generateTraffic(cfg, 11);
    const run = simulate(cfg, veh, model);
    const plan = run.plan;
    const byLane = new Map();
    for (const v of run.vehicles) {
      if (v.depart == null) continue;
      assert.ok(v.depart >= v.arrive - 1e-9);
      if (!v.amber) assert.equal(signalState(plan, v.approach, v.depart + 1e-6), 'G', `${model} veh ${v.id} departs on red`);
      const k = v.approach * 2 + v.lane;
      if (!byLane.has(k)) byLane.set(k, []);
      byLane.get(k).push(v);
    }
    for (const list of byLane.values()) {
      // FIFO within a lane, at least one headway apart
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].depart - list[i - 1].depart >= cfg.headway - 1e-6 || list[i].amber || list[i - 1].amber);
        assert.ok(list[i].depart >= list[i - 1].depart);
      }
    }
  }
});

test('right turns accept only gaps of at least the critical gap (Model A)', () => {
  const cfg = withApproaches(defaultConfig(), { volume: 500, right: 25 });
  const run = simulate(cfg, generateTraffic(cfg, 5), 'A');
  const opp = [2, 3, 0, 1];
  let checked = 0;
  for (const v of run.vehicles) {
    if (v.turn !== 'R' || v.depart == null || v.amber) continue;
    // opposing turners going at the same moment are mutual turns: the vehicles behind them wait
    const mutual = run.vehicles.some(w => w.approach === opp[v.approach] && w.turn === 'R' && w.depart === v.depart);
    if (mutual) continue;
    const prev = run.vehicles.filter(w => w.approach === opp[v.approach] && w.turn !== 'R' && w.depart != null && w.depart <= v.depart + 1e-9 && w.depart > v.depart - 1.5 + 1e-6);
    assert.equal(prev.length, 0, `right-turner ${v.id} turns into a passing vehicle`);
    const conflicts = run.vehicles.filter(w => w.approach === opp[v.approach] && w.turn !== 'R' && w.depart != null && w.depart > v.depart + 1e-9 && w.depart < v.depart + cfg.gap - 1e-6);
    assert.equal(conflicts.length, 0, `right-turner ${v.id} at ${v.depart} has conflicts`);
    checked++;
  }
  assert.ok(checked > 50);
});

test('Model B has no right-turn blocking; Model A does', () => {
  const cfg = withApproaches(defaultConfig(), { volume: 400 });
  const p = runPair(cfg, 9);
  assert.equal(p.B.blockedGreen, 0);
  assert.ok(p.A.blockedGreen > 0);
  assert.ok(p.A.obstructed > 0);
});

test('validation: with no right turns four-way loses', () => {
  for (const volume of [150, 300, 450, 600]) {
    const cfg = { ...withApproaches(defaultConfig(), { volume, right: 0, left: 10 }), reps: 20 };
    const { agg } = runBatch(cfg);
    assert.equal(agg.A.blockedGreen.max, 0);
    assert.ok(agg.diff.avgDelay.median > 0, `volume ${volume}: B should add delay`);
    assert.equal(agg.bWinsDelay, 0, `volume ${volume}: B never wins`);
  }
});

test('four-way can win: heavy right turns, strong opposing flow, long critical gap', () => {
  // North: 250 veh/h, 80% turning right across 600 veh/h coming from the South.
  // A 10 s gap stands for a wide junction or poor sightlines. Timings tuned per model.
  const cfg = {
    ...withApproaches(defaultConfig(), (ap, a) => [
      { volume: 250, right: 80, left: 0 }, { volume: 30, right: 0, left: 0 }, { volume: 600, right: 0, left: 0 }, { volume: 30, right: 0, left: 0 },
    ][a]),
    gap: 10, split: 'demand', splitB: 'demand', separateTimings: true, cycle: 120, cycleB: 120, reps: 20,
  };
  const { agg } = runBatch(cfg);
  assert.ok(agg.diff.avgDelay.median < 0, `median diff ${agg.diff.avgDelay.median}`);
  assert.ok(agg.bWinsDelay > 0.7);
  // ...and with a normal 5 s gap two-way wins again
  assert.ok(runBatch({ ...cfg, gap: 5 }).agg.diff.avgDelay.median > 0);
});

test('oversaturation is flagged as unstable', () => {
  const cfg = defaultConfig(); // 600 veh/h per approach: four-way capacity is ~312 veh/h
  const p = runPair(cfg, 1);
  assert.equal(p.B.unstable, true);
  assert.ok(p.B.remaining > 100);
  const light = runPair(withApproaches(cfg, { volume: 200 }), 1);
  assert.equal(light.A.unstable, false);
});

test('dedicated right-turn lane reduces blocking', () => {
  const base = { ...withApproaches(defaultConfig(), { volume: 550, right: 30 }), reps: 10 };
  const shared = runBatch(base).agg;
  const pocket = runBatch(withApproaches(base, { layout: 'pocket', storage: 6 })).agg;
  assert.ok(pocket.A.avgDelay.median < shared.A.avgDelay.median);
});

test('scenarios apply and run', () => {
  for (const s of SCENARIOS) {
    const cfg = { ...s.apply(defaultConfig()), reps: 3, duration: 20 };
    const { agg } = runBatch(cfg);
    assert.ok(Number.isFinite(agg.A.avgDelay.median));
    assert.match(headline(agg), /four-way signalling processes/);
  }
});

test('repSeed gives distinct seeds', () => {
  const s = new Set(Array.from({ length: 1000 }, (_, i) => repSeed(1, i)));
  assert.equal(s.size, 1000);
});
