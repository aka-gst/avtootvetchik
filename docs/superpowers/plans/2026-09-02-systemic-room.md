# Systemic Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в Техномагию одну собственную комнату, в которой один глагол — выпуск собранного заклинания — открывает путь к выходу минимум четырьмя материально разными способами.

**Architecture:** Комната остаётся обычным ASCII-уровнем и работает через существующие `shatter()`, `setPower()` и поиск пути. Четыре прохода отделяют вход от выхода одной вертикальной стеной: деревянная створка, металлическая створка, кристалл и силовая завеса с доступным щитком. Только реальные изменения клеток дают системный счётчик и событие обратной связи; клики, пустая очередь и попадание в стену его не меняют.

**Tech Stack:** ES modules, Node.js, существующие `src/world.js`, `src/level.js`, `src/levels.js`, `tests/*.mjs`.

**Spec:** Одобренная Сергеем через задачу Мозга от 2026-09-02: не копировать чужие уровни или оформление; одна комната, не менее четырёх материальных путей, последствия мира вместо скриптов победы, счётчик последствий, сохранённый телефонный ввод, без выкладки.

## Global Constraints

- Не добавлять специальных кнопок, отдельных скриптов победы или механик, которых нет у обычных уровней.
- Не менять принятый пилот `art/pilots/props-v2/` и не заменять боевой `prop-neon`.
- Каждый путь проверяется настоящим `createWorld()` и `update()`, а не подменой тайла в тесте.
- Счётчик растёт только после необратимой перемены мира: створка/кристалл разрушены или силовые клетки обесточены.
- Телефонный ввод не меняется; игра использует уже существующие экранные кнопки стихий и «ПУСК».
- Формат уровня версии 4 несёт один бит `systemic`; версии 1–3 декодируются с `systemic: false`, без сдвига старых полей.
- Не делать `push` или внешнюю выкладку.

---

### Task 1: Контракт системной комнаты

**Files:**
- Create: `tests/systemic-room.mjs`
- Create: `src/systemic-room.js`

**Interfaces:**
- Consumes: `fromAscii()` из `src/level.js`, `createWorld()`/`update()`/`TILE_SIZE` из `src/world.js`.
- Produces: `SYSTEMIC_ROOM`, обычный объект уровня с `systemic: true`, пятью стихиями и проходами на `DOOR`, `METAL`, `CRYSTAL`, `FORCE`.

- [ ] **Step 1: Write the failing test**

```js
import { SYSTEMIC_ROOM } from '../src/systemic-room.js';
import { createWorld } from '../src/world.js';

const world = createWorld(SYSTEMIC_ROOM);
check('комната помечена как системная', world.systemic?.actions === 0);
check('в комнате ровно четыре материальных прохода',
  [TILE.DOOR, TILE.METAL, TILE.CRYSTAL, TILE.FORCE]
    .every((tile) => [...world.tiles].filter((value) => value === tile).length === 1));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/systemic-room.mjs`

Expected: FAIL because `src/systemic-room.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `SYSTEMIC_ROOM` with `fromAscii()` and this 25×15 geometry. `@` starts left of divider, `X` is right of it; each one-cell gap is a real material already known to `level.js`.

```text
#########################
#...........#...........#
#...........#...........#
#...........+...........#
#...........#...........#
#...........#...........#
#...........M...........#
#...@.......#.......X...#
#...........#...........#
#...........*...........#
#...........#...........#
#...........#...........#
#.........E.F...........#
#...........#...........#
#########################
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/systemic-room.mjs`

Expected: green shape checks; material route tests remain red until Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/systemic-room.js tests/systemic-room.mjs
git commit -m "Add systemic room contract"
```

### Task 2: Последствия и четыре настоящих пути

**Files:**
- Modify: `src/level.js` (carry `meta.systemic` into a decoded ASCII level)
- Modify: `src/world.js` (initialise system counter, credit actual material changes, open empty-room exits)
- Modify: `src/systemic-room.js`
- Modify: `tests/systemic-room.mjs`

**Interfaces:**
- Consumes: `world.events`, `shatter(world, at, substance)`, `setPower(world, on)`.
- Produces: `world.systemic = { actions: number, last: string } | null`; each credited outcome emits `{ type: 'consequence', kind, actions, x, y }`.

- [ ] **Step 1: Write the failing path tests**

Add a real `cast(world, stack, angle)` helper copied only in behaviour from `tests/sim.mjs`: it charges with `update()` then releases through `attack: true`. For every route, place the player two cells left of its target, cast its existing matching element, and assert both a changed real tile and a reachable exit flow field:

```js
expectRoute('огонь сжигает деревянную створку', 'door', ['fire']);
expectRoute('земля мнёт металлическую створку', 'metal', ['earth']);
expectRoute('молния разбивает кристалл', 'crystal', ['bolt']);
expectRoute('молния в щиток гасит силовую завесу', 'force', ['bolt']);
```

`expectRoute` must also assert `world.systemic.actions === 1`, a `consequence` event with the named `kind`, and that a manually pressed empty attack leaves `actions === 0`. Do not assert source text or call `shatter()` directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/systemic-room.mjs`

Expected: route/counter checks fail because the new world counter and level metadata do not exist.

- [ ] **Step 3: Write minimal implementation**

1. Return `systemic: Boolean(meta.systemic)` from `fromAscii()`.
2. Bump `FORMAT_VERSION` to 4, write one `systemic` bit after `track`, and decode it only for version 4; old level codes retain their old bit layout and decode to `false`.
3. In `createWorld()`, initialise `systemic` only for such a level: `{ actions: 0, last: '' }`.
4. Add a private `creditConsequence(world, kind, x, y)` that no-ops outside system levels and otherwise increments `actions`, sets `last`, and emits the `consequence` event.
5. Call it only after a `shatter()` changed a door, metal cell, or crystal; call it from `setPower()` only when it actually changed at least one `FORCE` cell.
6. After world entities are built, call existing `openExit(world)` when `world.total === 0`, so a zero-enemy puzzle room never looks locked.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/systemic-room.mjs`

Expected: all four routes are green; empty release and broken material-link negative controls are red when deliberately mutated.

- [ ] **Step 5: Commit**

```bash
git add src/level.js src/world.js src/systemic-room.js tests/systemic-room.mjs
git commit -m "Add consequence-driven systemic routes"
```

### Task 3: Игровая обратная связь и доступность комнаты

**Files:**
- Modify: `src/levels.js` (append `SYSTEMIC_ROOM` to `CAMPAIGN`)
- Modify: `index.html` (one optional HUD slot)
- Modify: `src/main.js` (show current counter and consequence toast)
- Modify: `tests/systemic-room.mjs`

**Interfaces:**
- Consumes: `world.systemic`, `world.events` and ordinary campaign-level loading.
- Produces: an optional `#systemicActions` HUD value, hidden on all ordinary combat floors; toast text names the credited material result.

- [ ] **Step 1: Write the failing integration checks**

Extend the Node test to assert `CAMPAIGN.includes(SYSTEMIC_ROOM)` and `SYSTEMIC_ROOM.elements` contains `fire`, `water`, `wind`, `earth`, `bolt`. Add a browser-free interface contract by exporting `systemicLabel(kind)` from `src/systemic-room.js` and asserting literal, player-readable labels for `wood`, `metal`, `crystal`, and `power`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/systemic-room.mjs`

Expected: FAIL because the level is not in campaign and the label function is missing.

- [ ] **Step 3: Write minimal implementation**

Append the room to the normal `CAMPAIGN` map. Add a HUD slot with `hidden` by default; in `updateHud()` show `СВЯЗЕЙ` and `world.systemic.actions` only on the new room. In `drainEvents()`, map a `consequence` event via `systemicLabel()` and show `СВЯЗЬ N · <label>`; existing specific fire/crystal/power feedback remains untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/systemic-room.mjs && node tests/input.mjs`

Expected: systemic room contract and existing touch/keyboard input are green.

- [ ] **Step 5: Commit**

```bash
git add src/levels.js src/systemic-room.js src/main.js index.html tests/systemic-room.mjs
git commit -m "Expose systemic room feedback"
```

### Task 4: Targeted verification

**Files:**
- Verify only: `tests/systemic-room.mjs`, `tests/input.mjs`, `tests/sim.mjs`

- [ ] **Step 1: Run targeted tests**

Run: `node tests/systemic-room.mjs && node tests/input.mjs && node tests/sim.mjs`

Expected: all green; the existing campaign still passes its simulation.

- [ ] **Step 2: Prove the route test is not decorative**

Temporarily mutate the crystal route's test cast from `['bolt']` to `['fire']`; run `node tests/systemic-room.mjs` and confirm only the crystal route fails. Revert the temporary test mutation before committing.

- [ ] **Step 3: Commit final test-clean state**

```bash
git status --short
git log -1 --oneline
```

Expected: clean worktree; no push and no deploy.
