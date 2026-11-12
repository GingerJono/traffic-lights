# Brief

## 2026-11-12 13:59
Build the Traffic Light Efficiency Model prototype described in the user's plan below: a standalone browser app (no backend) that compares two-way and four-way signalling at a four-arm junction, using identical simulated traffic.

How to work:
- Save the plan below as PLAN.md in the repo and treat it as the spec. Its acceptance criteria (section 9) are the definition of done.
- Keep the simulation engine separate from the UI (a plain JS module with no React imports). Unit-test the engine, including the zero-right-turn validation (four-way should generally lose) and seed reproducibility.
- Start with section 5's analytical capacity model as an instant calculator, then the discrete-event simulation, then the animation, the dashboard, the scenarios and the sensitivity heatmap.
- Use UK left-hand traffic: right-turners cross the opposing flow. Say this in the UI.
- Make reasonable modelling choices yourself and note them in JOURNAL.md (for example the gap-acceptance rule, amber handling and the arrival process). Only ask the user about choices that would change the conclusions.
- When there is something usable, publish it as an Artifact so the user can open it from their phone, and republish to the same URL as it improves. Commit and push after each milestone.

---- The user's plan ----

# Traffic Light Efficiency Model â€” Prototype Plan

## 1. Objective

Build an interactive traffic simulation that compares two signalling strategies at the same four-arm junction, using identical traffic demand, road layouts and simulation periods.

Model A â€” Two-way: Northâ€“south or eastâ€“west runs together. Right-turners yield to opposing traffic.

Model B â€” Four-way: One approach runs at a time. Vehicles can travel straight or turn without opposing conflicts.

The central question: Does eliminating right-turn obstruction save more time than is lost by splitting the green signal into four separate phases?

The prototype should calculate this rather than assume either arrangement is superior.

## 2. User-adjustable parameters

| Parameter               | Default               | Purpose                                  |
| ----------------------- | --------------------- | ---------------------------------------- |
| Simulation duration     | 60 minutes            | Compare equal periods                    |
| Signal cycle            | 120 seconds           | Total time for all phases                |
| Vehicles arriving       | 600/hour per approach | Defines demand                           |
| Right-turn percentage   | 20%                   | Creates potential blockage               |
| Left-turn percentage    | 10%                   | Completes turning mix                    |
| Discharge headway       | 2.5 seconds           | Spacing between departing cars           |
| Signal changeover       | 4 seconds per phase   | Amber/all-red lost time                  |
| Right-turn gap required | 5 seconds             | Minimum safe gap to turn                 |
| Lanes per approach      | 1                     | Whether turners obstruct through traffic |
| Pedestrian demand       | Initially excluded    | Add in second version                    |

Advanced controls should allow different inputs for all four approaches, rather than assuming a symmetrical junction.

## 3. What the prototype must measure

- Throughput: vehicles clearing per hour
- Average delay: seconds lost per vehicle
- Queue length: average and maximum queued
- Blocked green: time wasted behind right-turners

Also report total vehicle-hours of delay, vehicles remaining queued at the end of the simulation, and the percentage improvement or deterioration under four-way signalling.

The headline result should be the net change across the entire junction, not an isolated improvement on one approach.

## 4. Simulation engine

Rather than simply dividing green time by the number of vehicles, build a small discrete-event simulation that models individual vehicles arriving, queuing and crossing the junction.

1. Generate traffic. Create a stream of arriving vehicles for each approach, randomly assigning straight, left or right turns according to the parameters.
2. Run Model A. Opposing approaches get green together. Straight and left-turning vehicles proceed when possible; right-turning vehicles need an acceptable gap in conflicting traffic.
3. Model obstruction. When a right-turning vehicle waits in a shared lane, following vehicles cannot pass it.
4. Run Model B. Use exactly the same vehicles and arrival times, but give each approach an exclusive green phase. There are no opposing right-turn conflicts.
5. Measure each vehicle. Record arrival time, departure time, turning direction, waiting time and whether it was obstructed.
6. Repeat the comparison. Run 100 or more simulations with different random traffic patterns, using identical input traffic for A and B in each run.

This avoids building the conclusion into the assumptions. For example, right-turners should not automatically be assigned a 25-second blockage: the model should derive the wait from actual simulated oncoming traffic.

## 5. Demonstration of the break-even point

Before building the full simulation, we can establish a useful theoretical benchmark.

Assume a saturated junction with one lane per approach, a 120-second cycle, four seconds lost per phase changeover and a discharge rate of one vehicle per 2.5 seconds.

Interactive capacity model (illustrative), with sliders for:
- Blocked seconds per approach, per cycle: 25s
- Lost time per signal phase: 4s
- Seconds between departing vehicles: 2.5s

Vehicles per 120-second cycle, all four approaches:
- A â€” Two-way: 49.6
- B â€” Four-way: 41.6
- Net effect of four-way signalling: -8.0 vehicles per cycle, -16.1% throughput change
- Break-even: 30.0 seconds of blockage per approach. Two-way wins in this simplified model.

Capacity-only approximation under continuous queues, equal approach demand and identical blocking time on each approach. The full simulation will calculate blocking dynamically, as well as delays and queues.

The important observation is that four-way lights have a substantial disadvantage: each approach gets much less green time. A working simulation needs to test whether avoiding right-turn blockage overcomes that disadvantage under realistic demand.

## 6. Full prototype interface

The finished prototype should have three sections:

A. Junction configuration: Four approach panels with traffic volume, turn proportions, lane layout and optional asymmetry. Controls for cycle length, phase timings, headway and clearance intervals.

B. Live junction animation: A top-down junction showing moving cars, red/amber/green lights and waiting queues. Switch between the two arrangements or play the same traffic demand side by side, with an adjustable animation speed.

C. Results dashboard: Display cumulative vehicles processed, average waiting time, maximum queues and obstruction time, with an A-versus-B comparison. Include a time-series chart to reveal whether queues stabilise or continue growing.

A particularly useful additional visual would be a heatmap of right-turn percentage versus total traffic volume, highlighting where two-way or four-way signalling performs better.

## 7. Testing scenarios

| Scenario               | Traffic demand | Right turns | What we're testing                      |
| ---------------------- | -------------- | ----------- | --------------------------------------- |
| Quiet junction         | Low            | 10%         | Advantage of simultaneous green         |
| Typical junction       | Medium         | 20%         | Normal mixed conditions                 |
| Busy junction          | High           | 20%         | Frequency of blocking                   |
| Heavy right turns      | High           | 40%         | Whether four-way can win                |
| Uneven traffic         | 70/30 split    | 20%         | Impact of direction imbalance           |
| Dedicated turning lane | High           | 30%         | Whether road design removes the problem |

For each, run at least 100 repetitions and report the median difference plus a range of outcomes. Use more repetitions if results are close.

## 8. Implementation approach

Build it as a standalone browser application, with no backend required.

| Component          | Implementation                             |
| ------------------ | ------------------------------------------ |
| Simulation         | JavaScript event-based engine              |
| Interface          | React                                      |
| Junction animation | SVG or Canvas                              |
| Parameters         | Sliders and numeric inputs                 |
| Results            | Interactive charts                         |
| Scenario storage   | JSON import/export                         |
| Export             | CSV of vehicle-level and aggregate results |

The engine and interface should remain separate so that future versions can test three-phase signals, dedicated right-turn filters and adaptive timings without rebuilding the simulation.

## 9. Acceptance criteria

The prototype is complete when it can:

- Run both configurations against identical incoming vehicles.
- Correctly model right-turn yield conflicts, queue blocking and signal changeovers.
- Change parameters and recalculate results.
- Show junction-wide throughput, delay, queue length and net improvement.
- Reproduce results using a fixed random seed.
- Demonstrate cases where each configuration wins.
- Show when demand exceeds capacity and queues become unstable.

An important validation test is setting right turns to zero: four-way signalling should generally perform worse, because it sacrifices simultaneous green time without eliminating any right-turn conflict.

## 10. Final deliverable

A single interactive web application with three levels of evidence:

1. Analytical capacity comparison: The instant calculation above, showing the theoretical break-even point.
2. Traffic simulation: Individual vehicles, real queues and randomly occurring gaps in oncoming traffic.
3. Sensitivity analysis: Automatically varying volumes, turning proportions and signal timings to identify when each approach is preferable.

The ultimate output should be a statement such as:

> Under the selected traffic conditions, four-way signalling processes X% more/fewer vehicles, changes average delays by Y seconds, and increases/decreases total queueing time by Z%.

Crucially, the model should also allow optimisation of signal timings separately for each configuration. Comparing a well-tuned four-way junction with a badly timed two-way junction would not be a fair test.

The strongest outcome isn't necessarily proving four-way signalling is better. It's establishing precisely the traffic conditions under which it becomes better, and quantifying the net benefit.
