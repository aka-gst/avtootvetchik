/*
 * Операция Евгения: цели, люди и последствия системного уровня.
 *
 *   node tests/operation.mjs
 */

import { decode, encode, ENTITY, fromAscii } from '../src/level.js';
import { createWorld, knockDown, TILE_SIZE, update } from '../src/world.js';
import { operationResult } from '../src/operation.js';

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const encodedLevel = fromAscii([
  '#########',
  '#@czki.X#',
  '#########',
], {
  title: 'КОНТРОЛЬ ОПЕРАЦИИ',
  elements: ['fire', 'water', 'wind', 'earth', 'bolt'],
  operation: true,
});

const restored = decode(encode(encodedLevel));
check('v5 сохраняет режим операции', restored.operation === true,
  String(restored.operation));
check('v5 сохраняет четыре новых сущности',
  [ENTITY.CIVIL, ENTITY.HOSTAGE, ENTITY.CORE, ENTITY.CANDLE]
    .every((type) => restored.entities.some((entity) => entity.type === type)),
  restored.entities.map((entity) => entity.type).join(','));

const ordinary = fromAscii(['###', '#@#', '###'], { elements: ['fire'] });
check('обычный новый уровень не становится операцией',
  decode(encode(ordinary)).operation === false,
  String(decode(encode(ordinary)).operation));

const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };
function step(world, frames = 1) {
  for (let i = 0; i < frames; i += 1) update(world, 1 / 60, idle);
}
function place(body, cellX, cellY) {
  body.x = cellX * TILE_SIZE + TILE_SIZE / 2;
  body.y = cellY * TILE_SIZE + TILE_SIZE / 2;
}

{
  const rows = [
    '########',
    '#@...tX#',
    '########',
  ];
  const operationWorld = createWorld(fromAscii(rows, { operation: true }));
  const campaignWorld = createWorld(fromAscii(rows));
  const operationGuard = operationWorld.enemies[0];
  const campaignGuard = campaignWorld.enemies[0];

  knockDown(operationWorld, operationGuard, 0, 0.1);
  knockDown(campaignWorld, campaignGuard, 0, 0.1);
  step(operationWorld, 60);
  step(campaignWorld, 60);

  check('в операции оглушённый не поднимается',
    operationGuard.alive && operationGuard.downed > 0
      && operationGuard.state === 'down',
    `${operationGuard.alive}/${operationGuard.downed}/${operationGuard.state}`);
  check('в старом уровне оглушённый поднимается по таймеру',
    campaignGuard.alive && campaignGuard.downed <= 0
      && campaignGuard.state === 'alert',
    `${campaignGuard.alive}/${campaignGuard.downed}/${campaignGuard.state}`);
}

{
  const world = createWorld(encodedLevel);
  check('операция создаёт цель с ядром', world.operation?.required === 'core');
  check('операция создаёт мирного, заложника, ядро и свечу',
    world.civilians.length === 1 && world.hostage?.kind === 'hostage'
      && world.core?.kind === 'core'
      && world.props.some((prop) => prop.kind === 'candle'));

  place(world.player, 7, 1);
  step(world);
  check('выход до ядра не завершает операцию', world.state === 'play', world.state);

  place(world.player, 4, 1);
  step(world);
  check('касание забирает ядро', world.operation.coreTaken && world.core.taken);

  place(world.player, 7, 1);
  step(world);
  check('с ядром выход завершает операцию', world.state === 'clear', world.state);

  const result = operationResult(world);
  check('результат считает оставленного заложника и живого мирного',
    result.hostage === 'left' && result.civiliansAlive === 1
      && result.guardsDead === 0,
    `${result.hostage}/${result.civiliansAlive}/${result.guardsDead}`);
}

for (const line of report) console.log(line);
process.exit(failures ? 1 : 0);
