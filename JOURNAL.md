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
