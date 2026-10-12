# Tables — multiplication mastery

A local-first, keyboard-first trainer for instant recall of multiplication facts, from 1×1 to 20×20 and then up to 30×30, 40×40 and 50×50. It is adaptive and deterministic: no accounts, no external APIs, no AI.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
# or a production build (enables the offline service worker)
npm run build && npm start
```

Checks: `npm run check` runs lint, type-check and the Vitest suite. `npm test` runs only the tests.

Progress lives in this browser's `localStorage` (key `tables.progress.v1`). Use Settings → Export JSON to make backups.

## Keyboard

| Where | Keys |
|---|---|
| Dashboard | `Enter` starts mixed recall |
| Train | `1`–`5` choose a mode, `Enter` starts |
| Question | type the answer, `Enter` submits; after a miss, retype the answer and press `Enter`; `Esc` ends the session |
| Heatmap | arrow keys move (`Shift` moves 5), `Enter` shows the fact's details |

## Architecture

```
src/lib/engine/        pure TypeScript, no React, no storage — all learning logic
  config.ts            stages (a table of limits) + settings, defaults, validation
  facts.ts             fact generation, canonical keys (7x12 == 12x7), bands, learning order
  evaluation.ts        answer parsing, slip-vs-gap classification, idle cap
  scheduler.ts         spaced-repetition intervals
  attempt.ts           one answer → new FactRecord (pure)
  mastery.ts           weak / mastered / developing status and the reasons behind it
  selection.ts         next-question choice; MODE_WEIGHTS is the whole policy, in one table
  session.ts           session state machine (start → submit → advance → summary)
  assessment.ts        stratified assessment builder + evaluator
  advancement.ts       stage readiness checklist
  analytics.ts         dashboard aggregates
src/lib/persistence/   AppState schema, validation, migrations, Repository interface,
                       LocalStorageRepository / MemoryRepository
src/lib/store/         AppStore (immutable updates, debounced saves, only when changed) + React hooks
src/components, src/app  UI: dashboard (/), trainer (/train), settings (/settings)
tests/                 Vitest suite for the engine, persistence and store
```

Stages are configuration only (`STAGES` in `config.ts`). Each stage's fact set is every unordered pair with both factors in 1..max, so Stage 2 contains Stage 1.

**Moving to PostgreSQL later.** The engine never touches storage. Implement `ProgressRepository` (`load`/`save`/`clear`) against an API. `AppState` maps directly onto tables: `fact_records` (PK `key`), `sessions`, `assessments` and a one-row profile for settings and progress.

## Algorithms

**Facts.** Facts are tracked per unordered pair (`7x12`). Both orientations are asked, and the less-practised one is preferred. Bands: *easy* means a trick factor (1, 2, multiples of 10, 11×single digit) or both factors ≤ 10. *Hard* means both factors ≥ 13 with no trick factor. Everything else is *medium*.

**Per-fact record.** Each fact stores: attempts, correct/incorrect counts, the last 20 answers (correctness, time, session), review level, next due time, last practised time, distinct sessions with a correct answer, spaced recalls, lapses, slips and gaps, and how often each orientation was asked. Answers slower than 60 s count as idle, not slow. Untimed modes never mark an answer wrong for being slow.

**Spaced repetition** uses Leitner levels with intervals `0, 10 min, 1 d, 3 d, 7 d, 16 d, 35 d, 75 d`:
- correct and within the speed target → level +1. A fast, correct first answer jumps to level 2, because you already knew it.
- correct but slow → level +1, but never above level 3, so slow facts keep coming back.
- slip or timeout → level −1 (minimum 1), review in 10 minutes.
- gap → level 0, due now. The fact is also asked again 3 questions later in the same session.

**Slip vs gap.** A fact needs at least 4 earlier answers before a miss is classified. A miss is a *slip* when the fact had ≥ 90% accuracy over its last answers and no other miss in the last 5. It is also a slip when accuracy was ≥ 80% and the wrong answer looks like a typo (one digit off or digits transposed). Any other miss is a *gap*. A gap resets the fact's spaced-recall evidence.

**Mastered** requires all of these (each one can be changed in Settings):
- ≥ 6 attempts
- ≥ 95% accuracy over the last 20 answers
- the last answer was correct
- correct answers in ≥ 3 distinct sessions
- ≥ 2 correct recalls ≥ 20 h after the previous attempt
- median correct-answer time within the target: 3 s / 4 s / 5 s / 6 s, depending on which stage the fact first appears in

Speed is measured only on correct answers, so guessing cannot help.

**Weak** (this overrides mastered) means any of: ≥ 2 misses in the last 6 answers; a fact forgotten after a delay that has not been answered correctly since; or a median time above 2× the target.

**Next question.** In order:
1. A missed fact whose relearn slot has arrived.
2. Otherwise, a weighted random draw from `MODE_WEIGHTS`. In Mixed mode the weights are: weak 8; due 4 plus an overdue bonus; new 3 (only the next 5 unpractised facts in easiest-first order, at most 12 per session, and facts you already knew don't count toward the 12); developing 0.6; mastered 0.1.

Facts asked in the last 4 questions are skipped. The random source is injected, so tests are deterministic.

**Assessment** (60 questions by default) contains every weak fact (up to 25% of the test). In Stage 2 and later, about 10% of questions come from earlier stages. The rest are split 20/35/45 across easy/medium/hard, and at least half are facts new to the stage. To pass you need ≥ 95% overall, ≥ 90% in every band, and a median time within the stage target.

**Unlocking the next stage** requires all of these:
- ≥ 90% of the stage's facts mastered
- ≥ 85% mastered in every band
- ≥ 90% of the facts new to this stage mastered
- no weak facts
- ≤ 10 overdue reviews
- a passed assessment that was *taken while all of the above held*

An assessment passed earlier is only a practice run and does not count.

## Limitations

- Single browser and device. There is no sync; use export/import to move data. Two tabs open at once will each save their own state, and the most recent save wins.
- Offline support comes from a hand-written service worker that runs only in production builds. A page you have never opened online is not cached.
- The weak-fact rules, band definitions and speed targets are reasoned defaults, not calibrated on real data. All of them can be changed in Settings except the band rules.
- Changing settings re-evaluates all statuses immediately, so a stricter setting can move facts from mastered back to developing.
- No dedicated "practise just the facts I missed" button. Weakness elimination covers them, because misses are scheduled right away.
