# To-do

## Now
- [ ] User review of the published prototype; answer the open questions in HANDOVER.md

## Next
- [ ] Check layout at phone width in the live artifact
- [ ] Optional platooned arrivals (from upstream signals) alongside Poisson
- [ ] Turn-specific saturation headways (slower turning vehicles)
- [ ] Sensitivity: optional per-cell optimiser instead of Webster
- [ ] Heatmap: mark cells where a model is unstable

## Later
- [ ] Pedestrian demand (plan says second version)
- [ ] Three-phase signals, right-turn filter arrows, adaptive timings (engine phases are data, so this extends buildPlan)
- [ ] Two general lanes per approach with lane choice

## Done
- [x] Read BRIEF.md and break it into tasks
- [x] Save plan as PLAN.md
- [x] Simulation engine (`app/engine.js`), separate from UI
- [x] Engine unit tests incl. zero-right-turn validation and seed reproducibility (`npm test`)
- [x] Analytical capacity calculator (section 5)
- [x] Settings panel incl. per-approach asymmetry, lanes, timings, gap, amber clearance
- [x] Live junction animation, side by side, speed control, scrubbing
- [x] Results dashboard: headline sentence, A-vs-B table with ranges, time series, run histogram, per-approach table
- [x] Timing optimiser (separate per model)
- [x] Scenarios (section 7) with 100+ runs, extra runs when close
- [x] Sensitivity heatmap (right-turn % × volume / cycle / gap / opposing flow)
- [x] JSON import/export; CSV of vehicles and per-run results (copy-to-clipboard)
- [x] Published as Artifact
