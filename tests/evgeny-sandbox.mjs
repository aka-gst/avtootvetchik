/* Реальные материальные маршруты стартовой операции. */
import { EVGENY_SANDBOX } from '../src/evgeny-sandbox.js';
import { CAMPAIGN } from '../src/levels.js';
import { ENTITY, TILE } from '../src/level.js';
import { buildFlowField } from '../src/ai.js';
import { createWorld, tileIndex, TILE_SIZE, update } from '../src/world.js';

const report = [];
let failures = 0;
const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
function at(world, tile) {
  const index = world.tiles.findIndex((value) => value === tile);
  return { index, x: ((index % world.w) + 0.5) * TILE_SIZE,
    y: (((index / world.w) | 0) + 0.5) * TILE_SIZE };
}
function cast(world, stack, angle, settleFrames = 120) {
  for (const element of stack) {
    update(world, DT, { ...idle, aimAngle: angle, charge: element });
    for (let guard = 0; world.player.chargeLeft > 0 && guard < 120; guard += 1) {
      update(world, DT, { ...idle, aimAngle: angle });
    }
  }
  update(world, DT, { ...idle, aimAngle: angle, attack: true });
  for (let i = 0; i < settleFrames; i += 1) update(world, DT, idle);
}
function coreReachable(world) {
  const flow = buildFlowField(world, world.core.x, world.core.y);
  return flow[tileIndex(world, world.player.x, world.player.y)] >= 0;
}
let reached = 0;
let attempted = 0;
function route(name, tile, stack, wrongStack, start, angle, changed, settleFrames = 120) {
  attempted += 1;
  const world = createWorld(EVGENY_SANDBOX);
  world.player.x = (start[0] + 0.5) * TILE_SIZE;
  world.player.y = (start[1] + 0.5) * TILE_SIZE;
  check(`${name}: до воздействия ядро недостижимо`, !coreReachable(world));
  const target = at(world, tile);
  cast(world, stack, angle, settleFrames);
  check(`${name}: вещество изменило преграду`, changed(world, target),
    `клетка=${world.tiles[target.index]} питание=${world.powered}`);
  check(`${name}: после последствия ядро достижимо`, coreReachable(world));
  if (coreReachable(world)) reached += 1;
  check(`${name}: до маршрута дошёл живой игрок`, world.player.alive);

  world.player.x = world.core.x;
  world.player.y = world.core.y;
  update(world, DT, idle);
  const exit = at(world, TILE.EXIT);
  const back = buildFlowField(world, exit.x, exit.y);
  check(`${name}: после ядра есть обратный путь`,
    world.operation.coreTaken && back[tileIndex(world, world.core.x, world.core.y)] >= 0);
  world.player.x = exit.x;
  world.player.y = exit.y;
  update(world, DT, idle);
  check(`${name}: полный цикл заканчивается выходом`, world.state === 'clear', world.state);

  const wrong = createWorld(EVGENY_SANDBOX);
  wrong.player.x = (start[0] + 0.5) * TILE_SIZE;
  wrong.player.y = (start[1] + 0.5) * TILE_SIZE;
  const wrongTarget = at(wrong, tile);
  cast(wrong, wrongStack, angle, 120);
  check(`${name}: неверное вещество не открывает путь`,
    !changed(wrong, wrongTarget) && !coreReachable(wrong));
}

check('операция стоит первой', CAMPAIGN[0] === EVGENY_SANDBOX);
check('операция системная и даёт пять стихий', EVGENY_SANDBOX.operation
  && EVGENY_SANDBOX.systemic && EVGENY_SANDBOX.elements.length === 5);
for (const type of [ENTITY.CIVIL, ENTITY.HOSTAGE, ENTITY.CORE, ENTITY.CANDLE]) {
  check(`сущность ${type} встречается один раз`,
    EVGENY_SANDBOX.entities.filter((entity) => entity.type === type).length === 1);
}
check('на объекте семь охранников', createWorld(EVGENY_SANDBOX).enemies.length === 7);

route('дерево', TILE.WOOD, ['fire'], ['bolt'], [11, 11], 0,
  (world, target) => world.tiles[target.index] !== TILE.WOOD, 900);
route('металл', TILE.METAL, ['earth'], ['fire'], [20, 5], Math.PI / 2,
  (world, target) => world.tiles[target.index] !== TILE.METAL);
route('питание', TILE.PANEL, ['bolt'], ['fire'], [32, 10], 0,
  (world) => !world.powered);
route('кристалл', TILE.CRYSTAL, ['bolt'], ['earth'], [21, 18], -Math.PI / 2,
  (world, target) => world.tiles[target.index] !== TILE.CRYSTAL);

check('измеритель довёл до ядра все попытки', reached === attempted,
  `${reached}/${attempted}`);

for (const line of report) console.log(line);
process.exit(failures ? 1 : 0);
