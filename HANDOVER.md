# Handover

_Rewritten at the end of each chunk of work._

**State (2026-11-12 15:40):** Working prototype, published. All of plan section 9 can be shown in the app: identical vehicles for both models, gap acceptance and blocking, changeover lost time, live recalculation, junction-wide measures with net change, fixed seed, cases where each model wins, and instability flags. Engine tests: 14 passing.

**Open it:** https://claude.ai/artifact/BY5mhMaM5WxTqE5RnxD4H3 (private to the owner).

**Run locally:** `npm run serve` then open http://localhost:8765/. Tests: `npm test` (Node 18+, no dependencies to install).

**Where things are:**
- `PLAN.md`: the spec (user's plan). Section 9 = definition of done.
- `app/engine.js`: simulation engine, plain ES module, no UI. Start here for modelling changes.
- `app/app.js`: React UI (htm templates, no build). `app/index.html`: page shell and CSS tokens.
- `test/engine.test.js`: engine tests.
- `JOURNAL.md`: every modelling choice and finding, with reasons.

**Key finding so far:** with a standard 5 s critical gap, two-way wins in every plan scenario and across the heatmap. Four-way's capacity ceiling (~300–360 veh/h per lane) dominates. Four-way only wins when a heavy right-turn flow faces a strong opposing flow and turners need ≥ ~10 s gaps.

**Open questions for the user:**
- Do the defaults favour two-way unfairly? The choices that help two-way most are facing right-turners turning together (tested: little effect below ~350 veh/h), one right-turner clearing per amber, and Poisson arrivals (random gaps). The critical gap is the lever that changes the answer.
- The plan's defaults (600 veh/h per approach, single lane) oversaturate both arrangements. Is 600 meant as a total, or two lanes?

**Next step:** user review on phone. Then TODO "Next" items: phone-width polish check, platooned arrivals option, turn-specific headways, pedestrian phase (v2).
