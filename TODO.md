# To-do

## Now
- [ ] Browser app: analytical calculator, configuration panels, run comparison
- [ ] Live junction animation (side by side, speed control)
- [ ] Results dashboard: comparison table, queue time series, rep distribution, headline sentence

## Next
- [ ] Scenarios panel (plan section 7) with 100+ reps each, median and range
- [ ] Sensitivity heatmap: right-turn % × volume
- [ ] Timing optimiser button (separate per model)
- [ ] JSON import/export of scenarios; CSV export (vehicle-level and per-rep aggregate)
- [ ] Publish as Artifact; republish as it improves

## Later
- [ ] Pedestrian demand (plan says second version)
- [ ] Three-phase signals, right-turn filter arrows, adaptive timings (engine is ready to extend: phases are data)
- [ ] Platooned arrivals (from upstream signals) as an alternative to Poisson
- [ ] Turn-specific saturation headways (slower turning vehicles)

## Done
- [x] Read BRIEF.md and break it into tasks
- [x] Save plan as PLAN.md
- [x] Simulation engine (`app/engine.js`), separate from UI
- [x] Engine unit tests incl. zero-right-turn validation and seed reproducibility (`npm test`)
