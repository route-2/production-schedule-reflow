# Production Schedule Reflow Engine

This project implements a **production schedule reflow engine** for a manufacturing facility.  
When disruptions occur (delays, machine maintenance, shift boundaries), the system recomputes a valid production schedule while respecting operational constraints.

The system is written in **TypeScript** and focuses on correctness, clarity of scheduling logic, and explainability of scheduling decisions.

---

# Problem

Manufacturing plants run multiple production lines (work centers) where **work orders** must be executed.

In real-world operations, schedules frequently need to be recomputed due to:

- production delays  
- machine maintenance  
- shift boundaries  
- dependencies between work orders  

The goal of the scheduler is to **reflow the schedule** while ensuring all operational constraints remain valid.

---

# Core Constraints

The scheduler enforces the following rules.

## Dependency constraints

- A work order may depend on one or more parent work orders.
- **All parents must complete before the child can start.**

Example:

```
WO-A → WO-B → WO-C
```

or

```
WO-A
   \
    → WO-C
   /
WO-B
```

---

## Work center constraints

- Each work center can execute **only one work order at a time**
- Work orders are **non-preemptive relative to other production jobs**
- A job cannot be interrupted by another production job on the same machine

---

## Shift constraints

Work centers operate only during configured shift hours.

Example:

```
Shift: 08:00 – 17:00
```

If work crosses the shift boundary:

```
16:00 → 17:00  (work)
17:00 → next day 08:00 (pause)
08:00 → 09:00 (resume)
```

---

## Maintenance windows

Maintenance windows block machine time.

Example:

```
09:00 → 10:00  work
10:00 → 12:00  maintenance
12:00 → 15:00  resume work
```

---

## Fixed maintenance work orders

Maintenance work orders cannot be rescheduled.

---

# Algorithm Overview

The scheduler follows a **constraint-aware greedy scheduling approach**.

---

## Step 1 — Build dependency graph

Work orders are converted into a **Directed Acyclic Graph (DAG)**.

A **topological sort** ensures:

```
parents scheduled before children
```

Cycle detection ensures invalid dependency graphs are rejected.

---

## Step 2 — Maintain work center calendars

Each work center maintains a calendar of blocked intervals:

- maintenance windows  
- fixed maintenance work orders  
- already scheduled production work orders  

---

## Step 3 — Earliest feasible scheduling

Each work order is scheduled at the earliest valid time that satisfies:

```
dependency constraints
shift constraints
maintenance constraints
work center availability
```

---

## Step 4 — Non-preemptive production scheduling

Production work orders are **non-preemptive with respect to other production jobs**.

Allowed pauses:

- shift boundaries  
- maintenance windows  
- fixed maintenance work orders  

Not allowed:

```
WO-A
WO-B
WO-A
```

If a candidate schedule overlaps another production job, the scheduler pushes the work order start to the end of that job and retries.

---

## Step 5 — Execution segments

Each work order records **actual execution segments**.

Example:

```
ACTIVE  09:00 → 10:00
PAUSED  10:00 → 12:00 (maintenance)
ACTIVE  12:00 → 15:00
```

Execution segments allow:

- accurate validation  
- timeline visualization  
- realistic pause/resume behavior  

---

# Project Structure

```
src/
│
├── reflow/
│   ├── reflow.service.ts
│   │   Main scheduling engine
│   │
│   ├── calendar.ts
│   │   Work center calendar logic
│   │   Shift handling
│   │   Maintenance blocking
│   │
│   ├── graph.ts
│   │   Dependency graph
│   │   Topological sort
│   │   Cycle detection
│   │
│   ├── constraint-checker.ts
│   │   Validates schedule correctness
│   │
│   ├── optimizer.ts
│   │   Metrics and utilization calculations
│   │
│   └── types.ts
│       Domain models
│
├── utils/
│   ├── date-utils.ts
│   │   Luxon helpers
│   │
│   └── logging.ts
│       CLI output formatting
│
├── index.ts
│   CLI runner
│
└── run-large-scenario.ts
    Large dataset benchmark
```

---

# Features Implemented

## Core scheduling engine

- Dependency-aware scheduling  
- Multiple parent dependencies  
- Topological scheduling  
- Shift-aware execution  
- Maintenance-aware execution  
- Non-preemptive machine scheduling  

---

## Validation engine

The schedule validator checks:

- dependency violations  
- cyclic dependencies  
- work center overlaps  
- maintenance violations  
- shift violations  
- invalid execution segments  

---

## Execution timeline logging

Example output:

```
EXECUTION TIMELINES

WO-4
ACTIVE  16:00 → 17:00
PAUSED  17:00 → 08:00
ACTIVE  08:00 → 09:00
```

---

## Optimization metrics

The system reports:

- total delay minutes  
- moved work orders  
- unchanged work orders  

Per work center metrics:

- scheduled working minutes  
- available shift minutes  
- maintenance minutes  
- idle minutes  
- utilization ratio  
- makespan  

---

# Example Scenario

Example delay cascade:

Original schedule:

```
WO-1: 08:00 → 10:00
WO-2: 10:00 → 12:00
WO-3: 12:00 → 14:00
```

If `WO-1` overruns by 60 minutes:

```
WO-1: 08:00 → 11:00
WO-2: 11:00 → 13:00
WO-3: 13:00 → 15:00
```

---

# Running the Project

Install dependencies

```
npm install
```

Run a scenario

```
npm run dev -- scenario-1-delay-cascade.json
```

Run tests

```
npm test
```

Run large-scale benchmark

```
npm run run:large
```

---

# Test Scenarios

The project includes multiple scenarios demonstrating scheduler behavior.

### Delay Cascade

A work order delay pushes downstream dependencies.

### Shift Boundary

Work pauses outside shift hours.

### Maintenance Conflict

Work pauses during maintenance windows.

### Multiple Parents

Child waits for all parents to complete.

### Cycle Detection

Circular dependencies are rejected.

---

# Automated Tests

Test coverage includes:

- dependency graph correctness  
- cycle detection  
- calendar scheduling logic  
- shift handling  
- maintenance blocking  
- integration scheduling scenarios  

Run:

```
npm test
```

---

# Large Dataset Benchmark

A synthetic dataset generator was used to test scheduler scalability.

Configuration:

```
work centers: 50
manufacturing orders: 250
work orders: 5000
```

Example run:

```
Runtime: 118 ms
Work orders processed: 1000
Moved work orders: 958
```

This demonstrates the scheduler operates efficiently even with large workloads.

---

# Design Tradeoffs

## Greedy scheduling vs global optimization

The scheduler uses **earliest-feasible scheduling** rather than global optimization.

Advantages:

- simple  
- deterministic  
- explainable  
- fast  

More advanced systems may implement:

- MILP optimization  
- simulated annealing  
- heuristic scheduling  
-  constraint dynamic

These were intentionally out of scope for the timebox.

---

# Known Limitations

- Optimization objective is not globally minimized  
- No setup time sequencing optimization  
- No batching or grouping heuristics  
- Calendar fragmentation can increase delay propagation  

These would be natural next improvements.

---

# Future Improvements

Possible extensions:

- multi-objective optimization  
- machine setup minimization  
- smarter job ordering heuristics  
- slack-aware scheduling  
- dynamic rescheduling under live disruptions  

---

# Tech Stack

- **TypeScript**
- **Node.js**
- **Luxon** for time handling
- **Vitest** for testing

---


---

# Summary

This project implements a **constraint-aware production scheduling engine** capable of reflowing schedules under disruptions while respecting:

- dependencies  
- work center capacity  
- shift schedules  
- maintenance windows  
- non-preemptive machine execution  

The solution emphasizes **correctness, explainability, and extensibility** while remaining performant on large workloads.