/*
 * Операция Евгения: цели, люди и последствия системного уровня.
 *
 *   node tests/operation.mjs
 */

import { decode, encode, ENTITY, fromAscii, TILE } from '../src/level.js';
import {
  createWorld, discharge, killEnemy, knockDown, resolveBodyImpact, setPower, TILE_SIZE, update,
} from '../src/world.js';
import { operationResult } from '../src/operation.js';
import { EVGENY_SANDBOX } from '../src/evgeny-sandbox.js';
import { GROUND, JOLT } from '../src/field.js';
import { lockCandidates } from '../src/aim.js';

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };
function step(world, frames = 1) {
  for (let i = 0; i < frames; i += 1) update(world, 1 / 60, idle);
}

{
  const level = fromAscii(['########', '#@...tX#', '########'], { operation: true });
  const soft = createWorld(level);
  const softGuard = soft.enemies[0];
  resolveBodyImpact(soft, softGuard, 140);
  check('слабый удар о стену оглушает',
    softGuard.alive && softGuard.downed > 0,
    `${softGuard.alive}/${softGuard.downed}`);

  const hard = createWorld(level);
  const hardGuard = hard.enemies[0];
  resolveBodyImpact(hard, hardGuard, 260);
  check('сильный удар о стену убивает', !hardGuard.alive, String(hardGuard.alive));

  const noImpact = createWorld(level);
  const safeGuard = noImpact.enemies[0];
  resolveBodyImpact(noImpact, safeGuard, 90);
  check('без сильного столкновения тело остаётся активным',
    safeGuard.alive && safeGuard.downed === 0,
    `${safeGuard.alive}/${safeGuard.downed}`);

  const ordinaryImpact = createWorld(level);
  const ordinaryGuard = ordinaryImpact.enemies[0];
  resolveBodyImpact(ordinaryImpact, ordinaryGuard, 180);
  check('обычный удар 180 оглушает, а не убивает',
    ordinaryGuard.alive && ordinaryGuard.downed > 0);

  const wall = createWorld(fromAscii(['########', '#@..t#X#', '########'], { operation: true }));
  const wallGuard = wall.enemies[0];
  wallGuard.x = 150;
  wallGuard.vx = 140;
  wallGuard.stagger = 0.5;
  wallGuard.shove = 0.5;
  step(wall);
  check('реальное столкновение отброшенного со стеной оглушает',
    wallGuard.alive && wallGuard.downed > 0,
    `${wallGuard.x}/${wallGuard.downed}`);

  const open = createWorld(fromAscii(['########', '#@..t.X#', '########'], { operation: true }));
  const openGuard = open.enemies[0];
  openGuard.x = 150;
  openGuard.vx = 140;
  openGuard.stagger = 0.5;
  openGuard.shove = 0.5;
  step(open);
  check('тот же полёт без стены не оглушает',
    openGuard.alive && openGuard.downed === 0,
    `${openGuard.x}/${openGuard.downed}`);

  const ice = createWorld(fromAscii(['########', '#@..t#X#', '########'], { operation: true }));
  const iceGuard = ice.enemies[0];
  iceGuard.x = 150;
  iceGuard.vx = 140;
  iceGuard.stagger = 0.5;
  const iceAt = Math.floor(iceGuard.y / TILE_SIZE) * ice.w
    + Math.floor(iceGuard.x / TILE_SIZE);
  ice.ground[iceAt] = GROUND.ICE;
  ice.groundLife[iceAt] = 5;
  step(ice);
  check('скольжение по льду в стену оглушает без внешнего толчка',
    iceGuard.alive && iceGuard.downed > 0,
    `${iceGuard.x}/${iceGuard.downed}`);

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

const frozenV4 = decode('Q4gQCCDhFAFABFAAzQ');
check('буквальный код v4 открывается без превращения в операцию',
  frozenV4.systemic && frozenV4.operation === false
    && frozenV4.elements.join(',') === 'fire,water,wind'
    && frozenV4.w === 5 && frozenV4.h === 3,
  `${frozenV4.operation}/${frozenV4.elements.join(',')}/${frozenV4.w}x${frozenV4.h}`);

function cast(world, stack, angle) {
  for (const element of stack) {
    update(world, 1 / 60, { ...idle, aimAngle: angle, charge: element });
    for (let guard = 0; world.player.chargeLeft > 0 && guard < 120; guard += 1) {
      update(world, 1 / 60, { ...idle, aimAngle: angle });
    }
  }
  update(world, 1 / 60, { ...idle, aimAngle: angle, attack: true });
  step(world, 90);
}
function place(body, cellX, cellY) {
  body.x = cellX * TILE_SIZE + TILE_SIZE / 2;
  body.y = cellY * TILE_SIZE + TILE_SIZE / 2;
}

{
  const panelLevel = fromAscii([
    '#########',
    '#@.EF.kX#',
    '#########',
  ], { operation: true });
  const noisy = createWorld(panelLevel);
  place(noisy.player, 2, 1);
  cast(noisy, ['bolt'], 0);
  check('одиночная искра по щитку даёт один шумный инцидент без боя',
    noisy.operation.alerts === 1 && noisy.engaged === false,
    `${noisy.operation.alerts}/${noisy.engaged}`);

  const quiet = createWorld(panelLevel);
  place(quiet.player, 2, 1);
  cast(quiet, ['water', 'bolt'], 0);
  check('составной взлом щитка не поднимает тревогу',
    quiet.operation.alerts === 0 && quiet.engaged === false,
    `${quiet.operation.alerts}/${quiet.engaged}`);

  const heard = createWorld(fromAscii([
    '##########',
    '#@..EF.kX#',
    '####.#####',
    '#...t....#',
    '##########',
  ], { operation: true }));
  place(heard.player, 2, 1);
  const listener = heard.enemies[0];
  const panelX = 4.5 * TILE_SIZE;
  const panelY = 1.5 * TILE_SIZE;
  const beforeNoise = Math.hypot(listener.x - panelX, listener.y - panelY);
  cast(heard, ['bolt'], 0);
  const afterNoise = Math.hypot(listener.x - panelX, listener.y - panelY);
  check('охранник действительно идёт разбираться к шумному щитку',
    listener.alive && listener.state === 'alert' && afterNoise < beforeNoise,
    `${Math.round(beforeNoise)}→${Math.round(afterNoise)} ${listener.state}`);

  const witnessed = createWorld(fromAscii([
    '#########',
    '#@.tt.kX#',
    '#########',
  ], { operation: true }));
  killEnemy(witnessed, witnessed.enemies[0], 0, 'melee', { by: 'player' });
  killEnemy(witnessed, witnessed.enemies[1], 0, 'melee', { by: 'player' });
  check('одно обнаружение несколькими последствиями считается один раз',
    witnessed.engaged && witnessed.operation.alerts === 1,
    `${witnessed.engaged}/${witnessed.operation.alerts}`);
}

{
  const level = fromAscii(['########', '#@...tX#', '########'], { operation: true });
  const frozen = createWorld(level);
  const frozenGuard = frozen.enemies[0];
  frozen.player.x = frozenGuard.x - TILE_SIZE * 2;
  frozen.player.y = frozenGuard.y;
  cast(frozen, ['water', 'wind'], 0);
  check('СТУЖА сначала замораживает и валит, а не убивает',
    frozenGuard.alive && frozenGuard.downed > 0 && frozenGuard.brittle > 0,
    `${frozenGuard.alive}/${frozenGuard.downed}/${frozenGuard.brittle}`);
  resolveBodyImpact(frozen, frozenGuard, 180);
  check('тот же удар 180 разбивает замороженного', !frozenGuard.alive);

  const thawed = createWorld(level);
  const thawedGuard = thawed.enemies[0];
  thawed.player.x = thawedGuard.x - TILE_SIZE * 2;
  thawed.player.y = thawedGuard.y;
  cast(thawed, ['water', 'wind'], 0);
  step(thawed, 240);
  resolveBodyImpact(thawed, thawedGuard, 180);
  check('после видимого окна хрупкость проходит, и удар 180 снова лишь оглушает',
    thawedGuard.alive && thawedGuard.brittle === 0,
    `${thawedGuard.alive}/${thawedGuard.brittle}`);
}

{
  const world = createWorld(EVGENY_SANDBOX);
  const candle = world.props.find((prop) => prop.kind === 'candle');
  const hayAt = Math.floor(candle.y / TILE_SIZE) * world.w
    + Math.floor(candle.x / TILE_SIZE) + 1;
  world.player.x = candle.x - TILE_SIZE * 2;
  world.player.y = candle.y;
  cast(world, ['fire'], 0);
  check('точный огонь зажигает свечу и сохраняет соседнюю солому',
    candle.lit && world.tiles[hayAt] === TILE.HAY && world.operation.candleLesson,
    `${candle.lit}/${world.tiles[hayAt]}`);

  const wide = createWorld(EVGENY_SANDBOX);
  const wideCandle = wide.props.find((prop) => prop.kind === 'candle');
  const wideHayAt = Math.floor(wideCandle.y / TILE_SIZE) * wide.w
    + Math.floor(wideCandle.x / TILE_SIZE) + 1;
  wide.player.x = wideCandle.x - TILE_SIZE * 2;
  wide.player.y = wideCandle.y;
  cast(wide, ['fire', 'wind'], 0);
  check('широкий жар зажигает свечу, но сжигает соседнюю солому',
    wideCandle.lit && wide.tiles[wideHayAt] !== TILE.HAY,
    `${wideCandle.lit}/${wide.tiles[wideHayAt]}`);

  const cold = createWorld(EVGENY_SANDBOX);
  const coldCandle = cold.props.find((prop) => prop.kind === 'candle');
  cold.player.x = coldCandle.x - TILE_SIZE * 2;
  cold.player.y = coldCandle.y;
  cast(cold, ['water'], 0);
  check('неогненное вещество свечу не зажигает', !coldCandle.lit);

  const fresh = createWorld(EVGENY_SANDBOX);
  const freshCandle = fresh.props.find((prop) => prop.kind === 'candle');
  fresh.player.x = freshCandle.x - TILE_SIZE * 2;
  fresh.player.y = freshCandle.y;
  check('свеча доступна в общем списке целей',
    lockCandidates(fresh, 0).some((target) => target.worldProp === freshCandle));
}

{
  const world = createWorld(fromAscii([
    '##########',
    '#@.tcz.tX#',
    '##########',
  ], { operation: true }));
  const wetBodies = [world.enemies[0], world.civilians[0], world.hostage];
  const dryGuard = world.enemies[1];
  for (const body of wetBodies) {
    const at = Math.floor(body.y / TILE_SIZE) * world.w + Math.floor(body.x / TILE_SIZE);
    world.ground[at] = GROUND.WATER;
    world.groundLife[at] = 5;
  }
  discharge(world, world.civilians[0].x, world.civilians[0].y, JOLT);
  step(world, 60);
  check('ток по связной воде не различает охрану, мирного и заложника',
    wetBodies.every((body) => !body.alive), wetBodies.map((body) => body.alive).join('/'));
  check('гибель мирных не начисляет убийства в боевой счёт', world.kills === 1,
    String(world.kills));
  check('сухая цель на той же дистанции током не задета', dryGuard.alive,
    String(dryGuard.alive));
  check('реальная цепь закрывает второй короткий урок', world.operation.waterLesson);
}

{
  const world = createWorld(fromAscii([
    '#########',
    '#@..c..X#',
    '#########',
  ], { operation: true }));
  const civil = world.civilians[0];
  const startX = civil.x;
  const fireAt = Math.floor(civil.y / TILE_SIZE) * world.w
    + Math.floor(civil.x / TILE_SIZE) - 1;
  world.ground[fireAt] = GROUND.FIRE;
  world.groundLife[fireAt] = 5;
  step(world, 30);
  check('мирный сам отступает от ближайшего пожара',
    civil.alive && civil.x > startX,
    `${Math.round(startX)}→${Math.round(civil.x)}`);
}

{
  const world = createWorld(EVGENY_SANDBOX);
  const civil = world.civilians[0];
  const at = Math.floor(civil.y / TILE_SIZE) * world.w + Math.floor(civil.x / TILE_SIZE);
  world.ground[at] = GROUND.FIRE;
  world.groundLife[at] = 5;
  world.groundAge[at] = 1;
  step(world, 120);
  check('мирный в пожаре погибает как тело мира', !civil.alive);
  check('пожар по мирному не даёт боевых очков', world.kills === 0, String(world.kills));
}

{
  const level = fromAscii([
    '##########',
    '#@.c.t..X#',
    '##########',
  ], { operation: true });
  const blocked = createWorld(level);
  cast(blocked, ['fire'], 0);
  step(blocked, 180);
  check('прямой огонь попадает в мирного как в тело мира',
    !blocked.civilians[0].alive, String(blocked.civilians[0].alive));
  check('мирный физически закрывает охранника от непробивного заряда',
    blocked.enemies[0].alive, String(blocked.enemies[0].alive));

  const missed = createWorld(level);
  cast(missed, ['fire'], -Math.PI / 2);
  step(missed, 180);
  check('тот же заряд мимо не задевает мирного',
    missed.civilians[0].alive, String(missed.civilians[0].alive));
}

{
  const world = createWorld(EVGENY_SANDBOX);
  setPower(world, false);
  step(world);
  check('щиток освобождает заложника, но ещё не спасает',
    world.hostage.released && !world.hostage.rescued);

  const startX = world.hostage.x;
  world.player.x = startX - TILE_SIZE * 3;
  world.player.y = world.hostage.y;
  step(world, 60);
  check('освобождённый заложник следует за игроком', world.hostage.x < startX,
    `${Math.round(startX)}→${Math.round(world.hostage.x)}`);

  world.hostage.x = 10.5 * TILE_SIZE;
  world.hostage.y = 20.5 * TILE_SIZE;
  world.player.x = 7.5 * TILE_SIZE;
  world.player.y = world.hostage.y;
  const hostageCell = 20 * world.w + 9;
  world.ground[hostageCell] = GROUND.FIRE;
  world.groundLife[hostageCell] = 5;
  let enteredFire = false;
  for (let frame = 0; frame < 180; frame += 1) {
    step(world);
    const at = Math.floor(world.hostage.y / TILE_SIZE) * world.w
      + Math.floor(world.hostage.x / TILE_SIZE);
    if (world.ground[at] === GROUND.FIRE) enteredFire = true;
  }
  check('заложник обходит активный огонь', !enteredFire,
    `${Math.round(world.hostage.x)},${Math.round(world.hostage.y)}`);
}

{
  const world = createWorld(EVGENY_SANDBOX);
  setPower(world, false);
  world.operation.coreTaken = true;
  world.core.taken = true;
  place(world.player, 3, 20);
  step(world, 1200);
  check('заложник сам находит реальный путь из камеры к выходу',
    world.hostage.rescued,
    `${Math.round(world.hostage.x)},${Math.round(world.hostage.y)}`);
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

{
  const world = createWorld(fromAscii([
    '##########',
    '#@cztt.kX#',
    '##########',
  ], { operation: true }));
  world.civilians[0].alive = false;
  world.hostage.rescued = true;
  world.enemies[0].downed = Number.POSITIVE_INFINITY;
  world.enemies[0].unconscious = true;
  world.enemies[1].alive = false;
  world.operation.alerts = 2;
  const result = operationResult(world);
  check('смешанный итог точно разделяет спасение, жертв и бессознательных',
    result.hostage === 'rescued' && result.civiliansDead === 1
      && result.guardsUnconscious === 1 && result.guardsDead === 1
      && result.alerts === 2,
    JSON.stringify(result));
}

for (const line of report) console.log(line);
process.exit(failures ? 1 : 0);
