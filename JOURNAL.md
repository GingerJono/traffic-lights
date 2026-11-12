# Journal

Append-only history of this project. Newest entries at the bottom.

## 2026-11-12 13:59
Project created by ClaudeControl. The request is in `BRIEF.md`.

## 2026-11-12 14:40
Plan saved; simulation engine built and unit-tested.
- Saved the user's plan as `PLAN.md` (fixed the garbled dashes from the brief's encoding). It is the spec; section 9 is the definition of done.
- `app/engine.js`: plain ES module (no React, no DOM). Traffic generation, signal plans, discrete-event simulation, metrics, multi-rep comparison, analytical capacity model, timing optimiser, sensitivity cell, scenarios.
- `test/engine.test.js` (run `npm test`, Node's built-in runner, no dependencies): 14 tests including the plan's section 5 numbers, seed reproducibility, identical vehicles for A and B, gap acceptance, the zero-right-turn validation (four-way loses at 150–600 veh/h, every rep), instability flag, right-turn lane benefit, and a case where four-way wins.

Modelling choices (all adjustable in the UI unless noted):
- **UK left-hand traffic.** Right-turners cross the opposing stream. Opposing straight and left-turners conflict with them; opposing right-turners do not.
- **Arrivals:** Poisson process per approach (exponential headways), turn drawn independently per vehicle. Seeded mulberry32 PRNG; rep r uses a seed hashed from (seed, r). Same vehicle list is fed to A and B.
- **Queues:** point (vertical) queues at the stop line. Delay = stop-line departure time − arrival time, so free-flow travel time is excluded and a vehicle arriving on green to an empty lane has zero delay.
- **Discharge:** a lane's head vehicle starts no earlier than the previous start + headway, and only if a full headway of green remains (so a phase of g seconds passes floor(g/h) vehicles from a standing queue). Same headway for all turns.
- **Signal changeover:** the per-phase changeover is treated as pure lost time (no starts during amber/all-red), and displayed green = effective green. Animation shows 3 s amber and 2 s red+amber for looks only.
- **Gap acceptance (Model A):** the head right-turner starts at time c only if (1) the last opposing straight/left vehicle crossed the stop line at least 1.5 s earlier (fixed constant `OPPOSING_CLEARANCE`), and (2) the next opposing straight/left crossing, projected from the opposing queue and its known future arrivals, is at least the critical gap (default 5 s) away. A rejected turner re-checks when the projected conflict has passed.
- **Facing right-turners** at the heads of both queues turn together (UK practice). Toggle: "one at a time", where one goes and the other waits for its own gap. Checked: the two give near-identical results below ~350 veh/h per approach, so the conclusions don't hinge on it. (A naive "both wait for each other's follower" rule deadlocked lanes until amber; rejected as unrealistic.)
- **End-of-green clearance:** at the end of each green, up to `amberClear` (default 1) right-turners per lane that were already waiting in the junction clear during the intergreen. Conservative versus the UK's usual 1–2.
- **Lanes:** "shared" (one lane: a waiting right-turner blocks everyone behind it) or "right-turn lane" (ahead/left lane + a right-turn pocket holding `storage` cars; when full, right-turners wait in the ahead lane and block it).
- **Blocked green** = green time during which the head right-turner is waiting for a gap while at least one vehicle is queued behind it in the same lane. Vehicles behind it are flagged "obstructed".
- **End of period:** the simulation stops at the duration. Vehicles still queued count as remaining, and their wait so far counts towards total and average delay (so the model that leaves a longer queue isn't flattered). Average queue = total delay / duration (Little's law).
- **Instability:** flagged when the junction queue grows by more than 0.25 veh/min over the second half and more than 10 vehicles remain at the end.
- **Signal timing:** equal splits or demand-proportional splits (busiest lane's flow ratio, minimum green 7 s). Separate cycles for A and B are allowed. The optimiser searches cycle 40–180 s and both split modes per model, minimising mean delay over 12 common traffic samples. Webster's cycle is also available.

Findings so far:
- Four-way's handicap is capacity: with one approach per phase, an approach gets at most ~(C − 16)/4 of the cycle, so about 300–360 veh/h per lane at h = 2.5 s. At the plan defaults (600 veh/h per approach), four-way is badly oversaturated whatever the turning mix.
- Simulated blocking in two-way rarely reaches the analytical break-even (30 s per approach per cycle at the defaults). Opposing queues clear and leave random gaps, facing turners go together, and one turner clears each amber.
- Four-way only won when an approach with very heavy right turns (≈80%) faces a strong opposing flow (≈600 veh/h straight) and right-turners need a long gap (≥ 10 s). That case is the "Four-way's best case" scenario and a unit test. With a 5 s gap, two-way won in every case tried (about 100 configurations with timings tuned per model).

## 2026-11-12 15:40
Browser app built and published as an Artifact.
- Published at https://claude.ai/artifact/BY5mhMaM5WxTqE5RnxD4H3 from `app/index.html` with `app/engine.js` and `app/app.js` alongside. Republish the same file path to keep the URL.
- `app/app.js`: React 18.3.1 (UMD from cdnjs) + htm 3.1.1 (jsDelivr), no build step. Tabs: Capacity (section 5 calculator with throughput-vs-blocking chart and a button to use the simulated blocking), Simulation (settings, headline sentence, live side-by-side canvas animation, A-vs-B table with 10–90% ranges, queue and cumulative charts with bands, per-run difference histogram, per-approach table with load %, JSON/CSV export and JSON import), Scenarios (plan section 7, 100 runs each, +200 runs when the range spans zero, timings tuned per model by default), Sensitivity (right-turn % against volume / cycle / gap / opposing flow, Webster-tuned or as configured), Method.
- Exports are shown as text with a Copy button because the artifact viewer blocks downloads. Import accepts pasted JSON or a .json file.
- `tools/serve.mjs` (`npm run serve`): local static server that wraps index.html the way the Artifact host does.
- Fixes found while testing in Chrome: string `style` attributes crash React (must be objects in htm); `setTimeout(0)` yields are throttled in background tabs, so batch runs now yield on a MessageChannel every ~40 ms.
- Changed scenario volumes to quiet 200, typical 350, busy/heavy/turning-lane 500, uneven 560/240 veh/h. The earlier 450–650 left even two-way over capacity on a single lane (the plan's own section 5 sums give ~370 veh/h per approach at 25 s blocking).
- Instability now also needs ≥ 5% of the period's vehicles left queued, which stops false flags from random queues near capacity.
- Scenario results (tuned timings, 100 runs, seed 1): four-way loses every plan scenario. Quiet +30 s/veh; typical +207 s (four-way unstable); busy +483 s (both unstable); heavy right +519 s; uneven +381 s; right-turn lane +214 s. "Four-way's best case" (10 s gap, 80% right against 600 veh/h): four-way −45 s/veh, better in 91% of runs.

## 2026-11-12 16:05
Public hosting on GitHub Pages, for people without Claude.
- User chose to make the repo public (the free plan doesn't allow Pages on private repos; the alternative was a separate public site repo). Scanned the full history for secrets first: none found.
- `tools/page.mjs`: wraps `app/index.html` in a full HTML document (the Artifact host normally adds the skeleton). Shared by `tools/serve.mjs` and the new `tools/build.mjs` (`npm run build` → `dist/`, git-ignored).
- `.github/workflows/pages.yml`: on every push to main, runs `npm test`, builds and deploys `dist/` to Pages. A failing test blocks the deploy.
- The Artifact stays the same; both are built from the same `app/` files.
