# Evgeny Systemic Sandbox Implementation Plan

> **For implementer:** Execute this plan task by task. Keep the operation-specific
> rules behind `level.operation`; existing campaign floors must retain their
> current behavior. Run the named red test before implementation and the full
> regression set after every task.

**Goal:** Make one dense, replayable Technomagic operation the default start: steal
the core and escape, optionally rescue the hostage, while fire, water, electricity,
noise, ice, unconscious bodies, civilians, and four material routes produce visible
and persistent consequences.

**Architecture:** Keep simulation authority in `src/world.js` and add a small
`src/operation.js` policy module for operation objectives and neutral actors. Extend
the backwards-compatible level codec to v5 with one operation bit and use the four
remaining entity IDs for civilian, hostage, core, and candle. Reuse the existing
field/material systems and the existing `enemy.downed` state; operation metadata
only suppresses its wake-up countdown. Rendering and HUD read world state but never
decide outcomes.

**Tech Stack:** Vanilla ES modules, Canvas 2D, Node-based deterministic tests,
`python3 serve.py` for browser acceptance. No dependencies or build step.

---

## Global Constraints

- Work only in `/Users/gst/dev/trash/technomagic-evgeny-sandbox-20260904` on
  branch `technomagic-evgeny-sandbox-20260904`.
- Do not touch `/Users/gst/dev/technomagic/LICENSE`,
  `/Users/gst/dev/aka-gst.ru/technomagic`, deployment, or the portfolio.
- `EVGENY_SANDBOX` becomes `CAMPAIGN[0]`; the old floors and `SYSTEMIC_ROOM`
  remain available and keep their current rules.
- Do not add art or audio assets before the gameplay slice is accepted.
- A cast counts only when a world consequence event occurred. A route counts only
  when a simulated player can reach the core and then the exit.
- Every new check gets a positive case and a meaningful negative control.
- Each task ends with a focused commit and the full regression command:

```sh
for test in tests/*.mjs; do node "$test" || exit 1; done
```

Expected: every file exits 0. If a pre-existing test fails, stop and diagnose; do
not weaken it to make the new level pass.

## Task 1: Add operation metadata and entity types without breaking old codes

**Files:**

- Modify: `src/level.js`
- Modify: `tests/sim.mjs`
- Create: `tests/operation.mjs`

### Step 1: Write the failing codec contract

In `tests/operation.mjs`, import `encode`, `decode`, `fromAscii`, and `ENTITY`.
Use the same `check(name, ok, detail)` reporter as `tests/systemic-room.mjs` and
create this minimum level:

```js
const encodedLevel = fromAscii([
  '#########',
  '#@c.zkiX#',
  '#########',
], {
  title: 'КОНТРОЛЬ ОПЕРАЦИИ',
  elements: ['fire', 'water', 'wind', 'earth', 'bolt'],
  operation: true,
});

const restored = decode(encode(encodedLevel));
check('v5 сохраняет режим операции', restored.operation === true);
check('v5 сохраняет четыре новых сущности',
  [ENTITY.CIVIL, ENTITY.HOSTAGE, ENTITY.CORE, ENTITY.CANDLE]
    .every((type) => restored.entities.some((entity) => entity.type === type)));
```

Also add two negative/backwards controls:

```js
const ordinary = fromAscii(['###', '#@#', '###'], { elements: ['fire'] });
check('обычный новый уровень не становится операцией',
  decode(encode(ordinary)).operation === false);
```

In `tests/sim.mjs`, keep its frozen v1 fixture and assert that decoding it yields
`operation === false`. Add a v4 fixture by encoding one ordinary level with the
old v4 encoder logic already present in the test helper; assert it also yields
`operation === false`.

Run:

```sh
node tests/operation.mjs
```

Expected: FAIL because the new characters/types and operation bit do not exist.

### Step 2: Extend the frozen numbering and codec

In `src/level.js`:

- change `FORMAT_VERSION` from 4 to 5;
- add `operation 1` after the systemic bit in the documented bit layout;
- append entity IDs without renumbering existing IDs:

```js
CIVIL: 6,
HOSTAGE: 12,
CORE: 13,
CANDLE: 14,
```

- map ASCII characters exactly as follows:

```js
c: ENTITY.CIVIL,
z: ENTITY.HOSTAGE,
k: ENTITY.CORE,
i: ENTITY.CANDLE,
```

- in `encode`, write `level.operation ? 1 : 0` immediately after the systemic
  bit;
- in `decode`, read that bit only when `version >= 5`; return
  `operation: false` for versions 1–4;
- in `fromAscii`, copy `Boolean(meta.operation)` into the returned level.

Do not infer operation mode from the presence of a core: explicit metadata keeps
custom rooms and old codes semantically stable.

### Step 3: Verify green and break the checker once

Run:

```sh
node tests/operation.mjs
node tests/sim.mjs
```

Expected: PASS.

Negative control: temporarily change the v5 decode condition to `version >= 6`,
run `node tests/operation.mjs`, and confirm `v5 сохраняет режим операции` fails.
Restore the condition and rerun both tests.

### Step 4: Commit

```sh
git add src/level.js tests/sim.mjs tests/operation.mjs
git commit -m "Add operation level format"
```

## Task 2: Represent the core, hostage, civilians, and operation outcome in the world

**Files:**

- Create: `src/operation.js`
- Modify: `src/world.js`
- Modify: `tests/operation.mjs`

### Step 1: Write failing state-transition tests

Add helpers to `tests/operation.mjs`:

```js
const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };

function step(world, frames = 1) {
  for (let i = 0; i < frames; i += 1) update(world, DT, idle);
}
```

Create a world from `encodedLevel` and assert:

- `world.operation.required === 'core'`;
- one civilian, one hostage, one core, and one candle exist;
- touching the exit before the core keeps `world.state === 'play'`;
- touching the core sets `core.taken === true` and emits `core-taken` once;
- touching the exit afterward sets `world.state === 'clear'`;
- the result reports hostage `left`, civilian alive, and zero dead guards;
- an ordinary level still clears under its existing exit rule.

Run `node tests/operation.mjs`; expected FAIL because the world has no operation
state or neutral actors.

### Step 2: Add a pure operation policy module

Create `src/operation.js` exporting:

```js
export function createOperation(enabled) {
  return enabled ? {
    required: 'core',
    coreTaken: false,
    hostageReleased: false,
    escaped: false,
    alerts: 0,
  } : null;
}

export function operationResult(world) {
  if (!world.operation) return null;
  const guards = world.enemies;
  return {
    core: world.operation.coreTaken,
    hostage: !world.hostage?.alive ? 'dead'
      : world.hostage.rescued ? 'rescued' : 'left',
    civiliansAlive: world.civilians.filter((body) => body.alive).length,
    civiliansDead: world.civilians.filter((body) => !body.alive).length,
    guardsActive: guards.filter((body) => body.alive && body.downed <= 0).length,
    guardsUnconscious: guards.filter((body) => body.alive && body.downed > 0).length,
    guardsDead: guards.filter((body) => !body.alive).length,
    alerts: world.operation.alerts,
    time: world.time,
  };
}
```

Also export `updateOperation(world, dt)` and keep all objective transitions there:

- core pickup radius: 18 px;
- core pickup emits `{ type: 'core-taken' }` once;
- hostage becomes released when its adjacent force cell is `TILE.FORCE_OFF`;
- a living released hostage within 24 px of the exit after core pickup becomes
  `rescued`;
- the player can clear an operation exit only after `coreTaken`;
- non-operation worlds are a no-op.

### Step 3: Instantiate non-hostile entities in `createWorld`

Add `world.civilians = []`, `world.hostage = null`, `world.core = null`,
`world.props = []`, and `world.operation = createOperation(level.operation)`.

Create neutral body records with the fields used by existing body/field code:
`x`, `y`, `vx`, `vy`, `angle`, `alive`, `downed`, `burning`, `zap`, `wet`,
`kind`, and `radius`. Use kinds `civil` and `hostage`. The candle is a prop with
`kind: 'candle'`, `lit: false`, and `radius: 7`; the core is a prop with
`kind: 'core'`, `taken: false`, and `radius: 11`.

Call `updateOperation(world, dt)` after field updates and actor movement but before
checking the exit. Move the exit-clear decision out of `updatePlayer` into a small
exported `tryExit(world)` so tests can prove both blocked and successful outcomes.

### Step 4: Verify, negative-control, commit

Run `node tests/operation.mjs`; expected PASS.

Negative control: temporarily remove the `coreTaken` guard from `tryExit`, confirm
`выход до ядра не завершает операцию` fails, restore, and rerun.

```sh
git add src/operation.js src/world.js tests/operation.mjs
git commit -m "Add systemic operation objectives"
```

## Task 3: Make unconscious guards persistent only in the Evgeny operation

**Files:**

- Modify: `src/world.js`
- Modify: `tests/operation.mjs`

### Step 1: Write the two-sided regression test

Build two otherwise identical one-guard levels, one with `operation: true` and one
without it. Import `knockDown`, call it with `0.1`, then advance both for one second.
Assert:

```js
check('в операции оглушённый не поднимается',
  operationGuard.alive && operationGuard.downed > 0
  && operationGuard.state === 'down');
check('в старом уровне оглушённый поднимается по таймеру',
  campaignGuard.alive && campaignGuard.downed <= 0
  && campaignGuard.state === 'alert');
```

Also assert that a downed operation guard can still die from fire by placing the
body in an active fire field and advancing until `alive === false`.

Run `node tests/operation.mjs`; expected FAIL on persistent unconsciousness.

### Step 2: Reuse `downed`; do not create a second knockout system

In `knockDown`, set:

```js
enemy.unconscious = Boolean(world.operation);
enemy.downed = enemy.unconscious ? Number.POSITIVE_INFINITY : срок;
```

In `updateEnemy`, keep `scorch`, velocity decay, body movement, discovery by other
guards, and downstream damage for both kinds. Decrement and wake only when
`!enemy.unconscious`. Clear `unconscious` when the enemy dies.

This is intentionally operation-scoped. Do not change `DOWN_TIME`, `SLEEP_TIME`,
or old floor metadata.

### Step 3: Verify, break, restore, commit

Run `node tests/operation.mjs`; expected PASS.

Negative control: temporarily remove the `!enemy.unconscious` guard, confirm the
operation assertion fails, restore, rerun, then run the full regression command.

```sh
git add src/world.js tests/operation.mjs
git commit -m "Keep operation knockouts down"
```

## Task 4: Give collision, fire, and electricity non-hostile consequences

**Files:**

- Modify: `src/world.js`
- Modify: `src/field.js`
- Modify: `tests/operation.mjs`

### Step 1: Write consequence tests before thresholds

Add deterministic tests for these outcomes:

1. A guard sliding into a wall at 140 px/s remains alive and unconscious.
2. The same impact at 260 px/s kills.
3. Standing on ice without a wall impact does neither.
4. A downed guard in fire dies and is counted as dead, not unconscious.
5. Electricity in connected water affects a guard, a civilian, and the hostage;
   dry actors at the same distance are untouched.
6. A civilian never becomes a combat target and never increases `world.total`.

Export a narrow test seam `resolveBodyImpact(world, body, speed)` rather than
reproducing physics in the test. Run `node tests/operation.mjs`; expected FAIL.

### Step 2: Centralize affected bodies and impact thresholds

Add:

```js
function livingBodies(world) {
  return [world.player, ...world.enemies, ...world.civilians,
    ...(world.hostage ? [world.hostage] : [])].filter((body) => body.alive);
}

const IMPACT_KNOCKOUT = 105;
const IMPACT_LETHAL = 220;
```

Use `livingBodies(world)` anywhere fire or water discharge currently iterates only
the player and enemies. For neutral actors, route lethal damage through a new
`killNeutral(world, body, cause)` that sets `alive = false`, emits
`neutral-death`, and leaves a corpse; it must not increase player score.

`resolveBodyImpact` behavior:

- speed below 105: no consequence;
- 105–219: guards are knocked down; civilians and hostage are knocked down but
  do not become hostile;
- 220 or above: lethal;
- a body already downed is lethal at 180 or above;
- operation and non-operation worlds share physics; only wake-up differs.

Call it only after a real blocking collision in `moveBody`. Do not infer an impact
from ice alone.

### Step 3: Verify and negative-control the environment

Run `node tests/operation.mjs`; expected PASS.

Negative controls:

- disconnect one water cell and confirm only the near side is shocked;
- change the weak impact to 90 px/s and confirm it does not knock out;
- remove the wall and confirm the 140 px/s body remains active.

Restore fixtures and run the full regression command.

```sh
git add src/world.js src/field.js tests/operation.mjs
git commit -m "Apply systemic hazards to every actor"
```

## Task 5: Add candle precision, hostage following, and civilian avoidance

**Files:**

- Modify: `src/operation.js`
- Modify: `src/world.js`
- Modify: `src/ai.js`
- Modify: `tests/operation.mjs`

### Step 1: Specify visible behavior with failing tests

Add tests asserting:

- a direct fire hit within 7 px lights the candle and emits `candle-lit`;
- the same precise hit does not ignite a wooden tile 32 px away;
- an area fire hit overlapping candle and hay lights the candle and creates fire
  on the hay, demonstrating the cost of imprecision;
- non-fire spells do not light the candle;
- a released hostage closes toward a player on safe floor but refuses the next
  step into fire or electrically charged water;
- civilians choose a neighboring cell farther from the nearest active fire/noise,
  and do not move through blocking tiles.

Run `node tests/operation.mjs`; expected FAIL.

### Step 2: Let props receive the same spell result as tiles

When a projectile or area form resolves, inspect `world.props` inside its actual
shape. For a candle and a substance with `traits.burn`, set `lit = true` and emit
one `candle-lit` event. Do not add a candle-only spell name or button.

The nearby hay must still be handled by the existing tile/field reaction. The
candle is the explicitly taught target; collateral ignition is the existing world
rule revealing itself.

### Step 3: Add simple hazard-aware neutral movement

In `src/operation.js`, add `updateNeutralActors(world, dt)`:

- hostage follows only after release, targeting a point 28 px behind the player;
- civilians move only when fire, charged water, a bullet, or combat noise is within
  160 px;
- score candidate cardinal steps using movement blocking plus field hazard;
- fire and charged water are forbidden, not merely expensive;
- ties prefer the current heading so actors do not jitter;
- downed or dead neutral actors do not move.

Reuse `blocksMove`, `tileIndex`, and field state. Do not teach civilians enemy
combat AI and do not add pathfinding state to `src/ai.js` unless the existing flow
field can be consumed without changing guard behavior.

### Step 4: Verify, break one rule, commit

Run `node tests/operation.mjs`; expected PASS.

Negative control: temporarily make charged water score as safe, confirm the
hostage safety test fails, restore, rerun the full regression command.

```sh
git add src/operation.js src/world.js src/ai.js tests/operation.mjs
git commit -m "Add precise candle and neutral behavior"
```

## Task 6: Build the dense nonlinear operation and prove four real routes

**Files:**

- Create: `src/evgeny-sandbox.js`
- Modify: `src/levels.js`
- Create: `tests/evgeny-sandbox.mjs`

### Step 1: Encode the level contract in tests

In `tests/evgeny-sandbox.mjs`, import `EVGENY_SANDBOX`, `CAMPAIGN`, `TILE`,
`createWorld`, `update`, `tileIndex`, and `buildFlowField`. Copy the real `cast`
and `settle` helpers from `tests/systemic-room.mjs` rather than mocking spells.

Assert the static contract:

- `CAMPAIGN[0] === EVGENY_SANDBOX`;
- `operation === true`, `systemic === true`, all five elements;
- exactly one core, hostage, candle, and civilian; 6–8 guards;
- exactly one wooden, metal, force, and crystal barrier guarding distinct entrances
  to the core ring;
- the candle is visible from spawn and hay/wood lies within one area-form radius;
- the hostage cell has a powered force barrier and a separately reachable panel;
- from spawn, at least two routes are visible through sight lines, while no direct
  floor path reaches the core before changing the world.

### Step 2: Draw one 40×24 connected facility

Create `src/evgeny-sandbox.js` with `fromAscii`. Use these named spatial bands and
coordinates so layout and tests agree:

- spawn/tutorial yard: x 1–9, y 17–22; candle at (5, 19), hay at (6, 19);
- civilian quarters: x 1–11, y 2–9;
- west service route: wooden door at (12, 15);
- north loading route: metal barrier at (19, 7);
- east power route: panel at (33, 16), force barrier at (29, 13);
- south crystal route: crystal at (20, 18);
- core ring: x 14–28, y 9–17, core at (21, 13);
- hostage cell: x 31–37, y 3–9, hostage at (35, 6), force at (30, 6);
- exit at (2, 20), so extraction crosses the changed facility rather than ending at
  the core;
- guards: two patrol the outer ring, one watches each noisy route, one watches the
  hostage wing, and one faces away from the tutorial yard.

Every barrier must block movement before interaction and become traversable only
through its existing material consequence. Do not use hay as a door: hay blocks
sight but not movement.

Set:

```js
title: 'ОПЕРАЦИЯ «ЯДРО»',
call: 'Укради ядро и вернись к выходу. На объекте удерживают человека.',
tutorial: 'candle',
operation: true,
systemic: true,
elements: ['fire', 'water', 'wind', 'earth', 'bolt'],
theme: 1,
track: 0,
```

### Step 3: Prove routes by outcomes, not tile counts

For each route, start from a named staging coordinate, cast the actual stack, settle
the world, then use `buildFlowField` to assert the core is reachable:

- wood: `['fire']` removes the wooden door;
- metal: `['earth']` removes the metal barrier;
- power: `['bolt']` on the panel changes force to `FORCE_OFF`;
- crystal: `['bolt']` destroys the crystal and opens the south path.

For every route, also run the wrong substance and assert the barrier remains and
the core stays unreachable. Then take the core and assert a path back to the exit.
Report `attempts reached/total` before route diversity so a stuck harness cannot
masquerade as a level result.

Run:

```sh
node tests/evgeny-sandbox.mjs
```

Expected before implementation: module-not-found. Expected after: all four real
routes and all four negative controls PASS.

### Step 4: Commit

```sh
git add src/evgeny-sandbox.js src/levels.js tests/evgeny-sandbox.mjs
git commit -m "Build Evgeny systemic operation"
```

## Task 7: Make objectives and consequences readable on desktop and phone

**Files:**

- Modify: `src/render.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `tests/operation.mjs`

### Step 1: Add source-level UI contracts first

Extend `tests/operation.mjs` to read `index.html` and `src/main.js` as text and
assert unique declarations/usages for:

- `#operationGoal` and `#operationOptional`;
- `window.technomagic.state`;
- result labels for core, hostage, civilians, active guards, unconscious guards,
  dead guards, alarms, and time;
- the candle instruction appears only for a level whose tutorial is `candle`.

Also assert every touch action selector has `min-height: 44px` or greater. Run the
test; expected FAIL.

### Step 2: Render distinct readable world states

In `src/render.js`:

- core: bright cyan rotating inner square, no text label;
- unlit candle: small pale stem with dark wick; lit candle: warm flame and light;
- civilian: neutral coat silhouette, no weapon color;
- hostage: neutral silhouette plus a visible restraint ring before release;
- unconscious actors: breathing animation and one stable prone pose;
- dead actors: current corpse rendering, no breathing.

Keep silhouettes readable at the current gameplay scale. Do not add downloaded art.

### Step 3: Add objective HUD, one contextual lesson, and factual result

In `index.html`, add two compact HUD lines. In `main.js`:

- show `УКРАСТЬ ЯДРО` until pickup, then `ВЕРНУТЬСЯ К ВЫХОДУ`;
- show `ЗАЛОЖНИК: НЕОБЯЗАТЕЛЬНО` until resolved;
- the only explicit lesson is `ЗАЖГИ СВЕЧУ. ТОЧНОЕ ПОПАДАНИЕ НЕ ЗАДЕНЕТ ДЕРЕВО`;
- hide that lesson after `candle-lit`;
- do not explain the four core routes;
- replace the normal clear panel only for operation levels with factual result rows
  from `operationResult(world)`;
- restarting resets every operation field by constructing a fresh world.

Expose a read-only hook:

```js
state() {
  return {
    scene,
    worldState: world?.state ?? null,
    operation: world ? operationResult(world) : null,
    coreTaken: Boolean(world?.core?.taken),
    candleLit: Boolean(world?.props.find((prop) => prop.kind === 'candle')?.lit),
  };
}
```

Return copies/counts only; do not expose mutation helpers.

In `style.css`, make every touch action at least 44×44 CSS px. Increment the query
versions for changed `style.css` and `src/main.js` in `index.html`.

### Step 4: Verify source contracts and commit

Run `node tests/operation.mjs` and the full regression command. Negative control:
temporarily remove the unconscious result row and confirm its assertion fails;
restore and rerun.

```sh
git add src/render.js src/main.js index.html style.css tests/operation.mjs
git commit -m "Present operation objectives and outcomes"
```

## Task 8: Perform human-reachable local acceptance and prepare the handoff

**Files:**

- Modify: `ФИНИШ.md`
- Modify: `docs/superpowers/specs/2026-09-04-evgeny-sandbox-design.md` only if
  observed behavior requires an explicit factual correction

### Step 1: Static and simulation gates

Run:

```sh
git diff --check
for file in src/*.js; do node --check "$file" || exit 1; done
for test in tests/*.mjs; do node "$test" || exit 1; done
```

Expected: all exit 0. Record total checks, four route outcomes, and negative-control
evidence in `ФИНИШ.md`.

### Step 2: Start the correct local server

Run `python3 serve.py` from this worktree. Confirm the terminal identifies port
4190 and the served cwd is this worktree, not `/Users/gst/dev/technomagic` or the
site mirror.

Open `http://localhost:4190/` in a clean browser profile with sound muted before
interaction. Measure `requestAnimationFrame` for one second; if below 50 fps,
record the environment as loaded and do not trust absolute animation timings.

### Step 3: Run the visible acceptance matrix

Desktop and 390×844 mobile viewport must each prove:

1. the operation, core goal, optional hostage line, candle, and player are visible;
2. precise fire lights the candle without burning the adjacent wood;
3. an imprecise area fire lights it and burns nearby wood/hay;
4. water plus electricity affects every body on connected water and no dry body;
5. a weak ice/wall collision leaves a breathing unconscious guard who stays down
   for at least 12 seconds;
6. a strong collision leaves a dead, non-breathing guard;
7. the hostage follows after release but refuses active fire/charged water;
8. one non-lethal route reaches the core and exits;
9. one loud route raises an alarm but remains completable;
10. the result screen reports the exact observed body counts and hostage outcome;
11. restart returns core, candle, actors, alert count, and objective to their initial
    states;
12. all touch controls are at least 44×44 and the first gameplay screen fits.

Count consequences, not clicks. Use `window.technomagic.state()` to corroborate
what is visible, never as a substitute for looking at the canvas.

### Step 4: Stage a showcase frame as a bug-finding check

Capture one local frame containing the visible core, at least two apparent routes,
one environmental hazard, a conscious guard, an unconscious guard, and the hostage
wing. If this cannot be composed without debug mutation, record the missing
readability as FAIL; do not fabricate a promotional image.

### Step 5: Update finish status and commit

Mark each `ФИНИШ.md` item PASS or FAIL with the exact check. Separate:

- `проверил сам`: browser-visible desktop/mobile behavior;
- `проверил код`: simulation and source contracts;
- `не проверял`: real iPhone, Evgeny’s first play, live site, analytics delivery.

```sh
git add ФИНИШ.md docs/superpowers/specs/2026-09-04-evgeny-sandbox-design.md
git commit -m "Record Evgeny operation acceptance"
git status --short --branch
```

Expected: clean branch. Do not push, deploy, or modify the site mirror until Sergey
explicitly chooses publication after seeing the local result.

