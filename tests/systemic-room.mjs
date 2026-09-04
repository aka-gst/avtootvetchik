/*
 * Системная комната: один выпуск заклинания меняет материю мира, а не
 * переключает отдельную кнопку победы.
 *
 *   node tests/systemic-room.mjs
 */

import { SYSTEMIC_ROOM, systemicLabel } from '../src/systemic-room.js';
import { decode, encode, TILE } from '../src/level.js';
import { buildFlowField } from '../src/ai.js';
import { createWorld, tileIndex, TILE_SIZE, update } from '../src/world.js';
import { CAMPAIGN } from '../src/levels.js';

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const world = createWorld(SYSTEMIC_ROOM);
const barriers = [TILE.DOOR, TILE.METAL, TILE.CRYSTAL, TILE.FORCE];
const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };

function findTile(world, tile) {
  const index = world.tiles.findIndex((value) => value === tile);
  return {
    index,
    x: ((index % world.w) + 0.5) * TILE_SIZE,
    y: (((index / world.w) | 0) + 0.5) * TILE_SIZE,
  };
}

function cast(world, stack, angle) {
  for (const element of stack) {
    update(world, DT, { ...idle, aimAngle: angle, charge: element });
    let guard = 0;
    while (world.player.chargeLeft > 0 && guard < 120) {
      update(world, DT, { ...idle, aimAngle: angle });
      guard += 1;
    }
  }
  update(world, DT, { ...idle, aimAngle: angle, attack: true });
}

function settle(world, until, frames = 120) {
  const events = [];
  for (let i = 0; i < frames; i += 1) {
    update(world, DT, idle);
    events.push(...world.events);
    if (until()) break;
  }
  return events;
}

function exitReachable(world) {
  const exit = findTile(world, TILE.EXIT);
  const flow = buildFlowField(world, exit.x, exit.y);
  return flow[tileIndex(world, world.player.x, world.player.y)] >= 0;
}

function checkRoute(name, targetTile, stack, kind, expects) {
  const route = createWorld(SYSTEMIC_ROOM);
  const target = findTile(route, targetTile);
  route.player.x = target.x - TILE_SIZE * 2;
  route.player.y = target.y;
  cast(route, stack, 0);
  const events = settle(route, () => expects(route));

  check(name, expects(route) && exitReachable(route),
    `клетка=${route.tiles[target.index]} путь=${exitReachable(route)}`);
  check(`${name}: засчитано последствие, а не выпуск`, route.systemic?.actions === 1
    && events.some((event) => event.type === 'consequence' && event.kind === kind),
  `счёт=${route.systemic?.actions}`);
}

check('комната помечена как системная', world.systemic?.actions === 0,
  String(world.systemic?.actions));
check('в комнате ровно четыре материальных прохода',
  barriers.every((tile) => [...world.tiles].filter((value) => value === tile).length === 1),
  barriers.map((tile) => [...world.tiles].filter((value) => value === tile).length).join('/'));
check('выход открыт в пустой комнате, но всё ещё отделён материалами',
  world.exitOpen === true && barriers.some((tile) => world.tiles.includes(tile)),
  `выход=${world.exitOpen}`);
check('системная комната доступна как обычный этаж кампании', CAMPAIGN.includes(SYSTEMIC_ROOM));
check('у комнаты доступны все пять стихий',
  SYSTEMIC_ROOM.elements.join(',') === 'fire,water,wind,earth,bolt', SYSTEMIC_ROOM.elements.join(','));
check('код комнаты сохраняет системный режим для ссылки-вызова',
  decode(encode(SYSTEMIC_ROOM)).systemic === true,
  String(decode(encode(SYSTEMIC_ROOM)).systemic));
check('обратная связь называет дерево, металл, кристалл и питание',
  ['wood', 'metal', 'crystal', 'power'].map(systemicLabel).join('|')
    === 'ДЕРЕВО ГОРИТ|МЕТАЛЛ СМЯТ|КРИСТАЛЛ РАЗРЯЖЕН|ПИТАНИЕ СНЯТО');

checkRoute('огонь сжигает деревянную створку', TILE.DOOR, ['fire'], 'wood',
  (route) => !route.tiles.includes(TILE.DOOR));
checkRoute('земля мнёт металлическую створку', TILE.METAL, ['earth'], 'metal',
  (route) => !route.tiles.includes(TILE.METAL));
checkRoute('молния разбивает кристалл', TILE.CRYSTAL, ['bolt'], 'crystal',
  (route) => !route.tiles.includes(TILE.CRYSTAL));

const force = findTile(createWorld(SYSTEMIC_ROOM), TILE.FORCE);
checkRoute('молния в щиток гасит силовую завесу', TILE.PANEL, ['bolt'], 'power',
  (route) => route.tiles[force.index] === TILE.FORCE_OFF);

{
  const empty = createWorld(SYSTEMIC_ROOM);
  update(empty, DT, { ...idle, attack: true });
  check('пустой выпуск не засчитывается как действие', empty.systemic?.actions === 0,
    `счёт=${empty.systemic?.actions}`);
}

{
  const wrong = createWorld(SYSTEMIC_ROOM);
  const crystal = findTile(wrong, TILE.CRYSTAL);
  wrong.player.x = crystal.x - TILE_SIZE * 2;
  wrong.player.y = crystal.y;
  cast(wrong, ['fire'], 0);
  settle(wrong, () => false, 30);
  check('огонь не выдаёт ложную победу на кристалле',
    wrong.tiles[crystal.index] === TILE.CRYSTAL && wrong.systemic?.actions === 0,
    `клетка=${wrong.tiles[crystal.index]} счёт=${wrong.systemic?.actions}`);
}

for (const line of report) console.log(line);
process.exit(failures ? 1 : 0);
