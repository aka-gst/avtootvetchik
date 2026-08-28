/*
 * АВТООТВЕТЧИК — что делают враги.
 *
 * Противник ничего не знает о мире напрямую: он видит конусом, слышит
 * точкой шума и ходит по волне, построенной от игрока. Никакого «врагу
 * всегда известно, где вы» — иначе исчезает единственная тактика,
 * которая тут есть: обойти и ударить первым.
 *
 * Состояния:
 *   idle   стоит на месте, лениво водит взглядом
 *   alert  идёт смотреть, откуда шумнуло
 *   chase  видит игрока и идёт убивать
 *   down   лежит после удара кулаком или брошенной битой
 */

import { TILE_SIZE, BODY, WEAPONS, angleDelta, turnToward, clamp, hasSight, emitNoise, tileIndex } from './world.js';
import { blocksMove } from './level.js';

const SIGHT_RANGE = 300;
const SIGHT_HALF = 0.95;   /* половина конуса, ~110° целиком */
const FEEL_RANGE = 58;     /* за спиной, но вплотную — заметит */
const NOTICE_TIME = 0.2;   /* столько взгляда нужно, чтобы понять */
const FORGET_TIME = 3.5;

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];


/*
 * Волна расстояний от игрока по проходимым клеткам. Поле маленькое
 * (тысяча клеток), поэтому проще пересчитать его целиком четыре раза в
 * секунду, чем вести и чинить пути для каждого врага.
 */
export function buildFlowField(world, x, y) {
  const size = world.w * world.h;
  const field = new Int16Array(size).fill(-1);
  const start = tileIndex(world, x, y);

  if (blocksMove(world.tiles[start])) return field;

  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  field[start] = 0;

  while (head < tail) {
    const at = queue[head++];
    const ax = at % world.w;
    const ay = (at / world.w) | 0;
    const next = field[at] + 1;

    for (let i = 0; i < 4; i += 1) {
      const nx = ax + NEIGHBOURS[i][0];
      const ny = ay + NEIGHBOURS[i][1];
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const idx = ny * world.w + nx;
      if (field[idx] !== -1 || blocksMove(world.tiles[idx])) continue;
      field[idx] = next;
      queue[tail++] = idx;
    }
  }

  return field;
}


/* Куда шагнуть, чтобы стать ближе к игроку по волне. */
function flowStep(world, enemy) {
  const field = world.flow;
  const cx = Math.floor(enemy.x / TILE_SIZE);
  const cy = Math.floor(enemy.y / TILE_SIZE);
  const here = field[cy * world.w + cx];
  if (here === undefined || here < 0) return null;

  let best = here;
  let bestX = 0;
  let bestY = 0;

  for (const [dx, dy] of NEIGHBOURS) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;

    /* По диагонали — только если оба бока свободны: иначе врагу срезает угол сквозь косяк. */
    if (dx && dy) {
      if (blocksMove(world.tiles[cy * world.w + nx])) continue;
      if (blocksMove(world.tiles[ny * world.w + cx])) continue;
    }

    const value = field[ny * world.w + nx];
    if (value < 0 || value >= best) continue;
    best = value;
    bestX = dx;
    bestY = dy;
  }

  if (!bestX && !bestY) return null;

  /* Целимся в центр соседней клетки, а не в её край — так меньше трения о стены. */
  const tx = (cx + bestX + 0.5) * TILE_SIZE;
  const ty = (cy + bestY + 0.5) * TILE_SIZE;
  const angle = Math.atan2(ty - enemy.y, tx - enemy.x);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}


function sees(world, enemy, target) {
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const dist = Math.hypot(dx, dy);
  if (dist > SIGHT_RANGE) return false;

  const toTarget = Math.atan2(dy, dx);
  const inCone = Math.abs(angleDelta(enemy.angle, toTarget)) < SIGHT_HALF;
  if (!inCone && dist > FEEL_RANGE) return false;

  return hasSight(world, enemy.x, enemy.y, target.x, target.y);
}


export function thinkEnemy(world, enemy, dt, speed) {
  const player = world.player;
  const result = { vx: 0, vy: 0, attack: false };

  /*
   * Заряженного видно издалека: стек горит над головой. Спрятать силу
   * нельзя — значит, на неё отвечают: громила ускоряется, чтобы достать
   * до выстрела, стрелок жмёт на спуск раньше.
   */
  const charged = player.stack && player.stack.length >= 2;

  const visible = player.alive && sees(world, enemy, player);
  const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  const toPlayer = Math.atan2(player.y - enemy.y, player.x - enemy.x);

  if (visible) {
    enemy.notice = (enemy.notice || 0) + dt;
    if (enemy.notice > NOTICE_TIME && enemy.state !== 'chase') {
      enemy.state = 'chase';
      enemy.lost = 0;
      /* Крик — это тоже шум: одного увидевшего хватает, чтобы сбежался этаж. */
      emitNoise(world, enemy.x, enemy.y, 240, 'shout');
      world.events.push({ type: 'spot' });
    }
  } else {
    enemy.notice = Math.max(0, (enemy.notice || 0) - dt * 1.6);
  }

  switch (enemy.state) {

    case 'idle': {
      /* Взгляд гуляет: неподвижный конус читается как слепое пятно. */
      enemy.think -= dt;
      if (enemy.think <= 0) {
        enemy.think = 1.4 + Math.random() * 2.2;
        enemy.lookAt = enemy.angle + (Math.random() - 0.5) * 2.4;
      }
      if (enemy.lookAt !== undefined) enemy.angle = turnToward(enemy.angle, enemy.lookAt, dt * 1.6);

      if (enemy.heard) enemy.state = 'alert';
      break;
    }

    case 'alert': {
      const point = enemy.heard || enemy.home;
      const gap = Math.hypot(point.x - enemy.x, point.y - enemy.y);

      if (gap > 26) {
        const step = flowStepToward(world, enemy, point);
        result.vx = step.x * speed.walk * 1.25;
        result.vy = step.y * speed.walk * 1.25;
        enemy.angle = turnToward(enemy.angle, Math.atan2(step.y, step.x), dt * 6);
        enemy.search = 2.6;
      } else {
        enemy.search = (enemy.search ?? 2.6) - dt;
        enemy.angle += Math.sin(world.time * 2.2 + enemy.home.x) * dt * 2.2;
        if (enemy.search <= 0) {
          enemy.heard = null;
          enemy.state = 'idle';
          enemy.think = 0.4;
        }
      }
      break;
    }

    case 'chase': {
      if (!visible) {
        enemy.lost = (enemy.lost || 0) + dt;
        if (enemy.lost > FORGET_TIME) {
          enemy.state = 'alert';
          enemy.heard = { x: player.x, y: player.y };
          enemy.search = 3;
          break;
        }
      } else {
        enemy.lost = 0;
        enemy.lastSeen = { x: player.x, y: player.y };
      }

      const weapon = WEAPONS[enemy.weapon];
      enemy.angle = turnToward(enemy.angle, toPlayer, dt * (visible ? 7 : 3.5));

      if (weapon.kind === 'gun') {
        /*
         * Дальность огня ограничена тем, что игрок видит на своём экране
         * (её сообщает камера). На узком телефоне стрелок подойдёт ближе,
         * на широком мониторе достанет издалека — но выстрела из-за края
         * кадра не будет нигде.
         */
        const reach = Math.min(330, world.viewRadius || 260);
        const shootable = visible && dist < reach && Math.abs(angleDelta(enemy.angle, toPlayer)) < 0.2;

        /* Стрелок держит дистанцию: вплотную он беспомощен, и это шанс игрока. */
        if (dist < 90) {
          const away = toPlayer + Math.PI;
          result.vx = Math.cos(away) * speed.walk;
          result.vy = Math.sin(away) * speed.walk;
        } else if (!shootable) {
          const step = flowStep(world, enemy) || { x: Math.cos(toPlayer), y: Math.sin(toPlayer) };
          result.vx = step.x * speed.run;
          result.vy = step.y * speed.run;
        }

        if (shootable && enemy.cooldown <= 0) {
          /* Замах перед выстрелом: у игрока должно быть время уйти с линии. */
          enemy.windup = (enemy.windup || 0) + dt;
          if (enemy.windup > (charged ? 0.3 : 0.42)) {
            enemy.windup = 0;
            result.attack = true;
            enemy.cooldown = 0.9 + Math.random() * 0.5;
          }
        } else {
          enemy.windup = Math.max(0, (enemy.windup || 0) - dt * 2);
        }

        if (enemy.ammo <= 0) {
          /* Патроны кончились — идёт бить прикладом. */
          enemy.weapon = 'bat';
        }
        break;
      }

      const reach = weapon.reach + BODY - 6;
      if (dist > reach) {
        const step = (visible && hasSight(world, enemy.x, enemy.y, player.x, player.y))
          ? { x: Math.cos(toPlayer), y: Math.sin(toPlayer) }
          : (flowStep(world, enemy) || { x: 0, y: 0 });
        const rush = charged ? 1.14 : 1;
        result.vx = step.x * speed.run * rush;
        result.vy = step.y * speed.run * rush;
        enemy.windup = 0;
      } else if (enemy.cooldown <= 0) {
        enemy.windup = (enemy.windup || 0) + dt;
        if (enemy.windup > 0.22) {
          enemy.windup = 0;
          result.attack = true;
        }
      }
      break;
    }

    default:
      break;
  }

  return result;
}


/* Волна построена от игрока, а к точке шума враг идёт по прямой со скольжением. */
function flowStepToward(world, enemy, point) {
  const angle = Math.atan2(point.y - enemy.y, point.x - enemy.x);
  const ahead = { x: Math.cos(angle), y: Math.sin(angle) };

  const probeX = enemy.x + ahead.x * (BODY + 10);
  const probeY = enemy.y + ahead.y * (BODY + 10);
  const blocked = blocksMove(world.tiles[tileIndex(world, probeX, probeY)]);
  if (!blocked) return ahead;

  /* Упёрся — пробуем обойти по волне, она знает про двери. */
  const step = flowStep(world, enemy);
  if (step) return step;

  const side = angle + (enemy.home.x % 2 ? 1.2 : -1.2);
  return { x: Math.cos(side), y: Math.sin(side) };
}

export { clamp };
