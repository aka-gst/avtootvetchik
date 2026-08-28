/*
 * АВТООТВЕТЧИК — мир: тела, столкновения, оружие, смерть.
 *
 * Здесь нет ни отрисовки, ни ввода. Мир получает намерение игрока
 * (куда идти, куда смотреть, что нажал) и продвигает себя на dt.
 * Что рисовать — решает render.js, что делают враги — ai.js.
 *
 * Главное правило жанра: с одного удара умирают все, включая игрока.
 * Поэтому здоровья нет ни у кого, а есть только «жив» и «лежит».
 */

import { TILE, blocksMove, blocksSight, blocksShot, breakable } from './level.js';
import { thinkEnemy, buildFlowField } from './ai.js';

export const TILE_SIZE = 32;

/* Радиус тела одинаков у всех: попадание должно читаться на глаз. */
export const BODY = 9;

export const WEAPONS = {
  fists: {
    id: 'fists', name: 'КУЛАКИ', kind: 'melee',
    reach: 27, arc: 1.9, cooldown: 0.30, lethal: false, noise: 70,
  },
  bat: {
    id: 'bat', name: 'БИТА', kind: 'melee',
    reach: 36, arc: 2.0, cooldown: 0.36, lethal: true, noise: 110,
  },
  pistol: {
    id: 'pistol', name: 'ПИСТОЛЕТ', kind: 'gun',
    cooldown: 0.24, clip: 12, speed: 720, spread: 0.03, noise: 460,
  },
};

const PLAYER_SPEED = 205;
const PLAYER_ACCEL = 2600;
const ENEMY_WALK = 62;
const ENEMY_RUN = 138;
const DOWN_TIME = 2.4;
const BULLET_LIFE = 1.6;


/* =========================================================
   МЕЛОЧИ
   ========================================================= */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(from, to, step) {
  const d = angleDelta(from, to);
  return from + clamp(d, -step, step);
}

function rand(a, b) { return a + Math.random() * (b - a); }


/* =========================================================
   СЕТКА
   ========================================================= */

export function tileAt(world, x, y) {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return TILE.WALL;
  return world.tiles[ty * world.w + tx];
}

export function tileIndex(world, x, y) {
  const tx = clamp(Math.floor(x / TILE_SIZE), 0, world.w - 1);
  const ty = clamp(Math.floor(y / TILE_SIZE), 0, world.h - 1);
  return ty * world.w + tx;
}

function solidAt(world, x, y) {
  return blocksMove(tileAt(world, x, y));
}

/*
 * Тело двигается по осям раздельно: так оно скользит вдоль стены, а не
 * залипает в углу. Раздельность важнее точности — в дверном проёме
 * шириной в клетку игрок иначе застревает и умирает не по своей вине.
 */
function moveBody(world, body, dx, dy) {
  const r = BODY;

  if (dx) {
    const nx = body.x + dx;
    const edge = nx + Math.sign(dx) * r;
    if (!solidAt(world, edge, body.y - r + 1) && !solidAt(world, edge, body.y + r - 1)) {
      body.x = nx;
    } else {
      body.vx = 0;
    }
  }

  if (dy) {
    const ny = body.y + dy;
    const edge = ny + Math.sign(dy) * r;
    if (!solidAt(world, body.x - r + 1, edge) && !solidAt(world, body.x + r - 1, edge)) {
      body.y = ny;
    } else {
      body.vy = 0;
    }
  }
}

/*
 * Прямая видимость по клеткам (DDA). Стекло намеренно не мешает: сквозь
 * витрину враг вас увидит, и это единственная подсказка, что она там есть.
 */
export function hasSight(world, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.ceil(Math.hypot(dx, dy) / (TILE_SIZE * 0.4));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (blocksSight(tileAt(world, ax + dx * t, ay + dy * t))) return false;
  }
  return true;
}


/* =========================================================
   ЗВУК КАК ИГРОВАЯ СУЩНОСТЬ
   ========================================================= */

/*
 * Выстрел слышно через стены — это плата за пистолет. Кулаки почти
 * бесшумны. Шум не «оповещает всех», а даёт точку, куда враг придёт
 * смотреть: разница между «услышал» и «увидел» и есть весь стелс.
 */
export function emitNoise(world, x, y, radius, source) {
  world.noises.push({ x, y, radius, life: 0.45, max: 0.45 });

  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.downed > 0) continue;
    if (Math.hypot(enemy.x - x, enemy.y - y) > radius) continue;
    if (enemy.state === 'chase') continue;
    enemy.heard = { x, y };
    enemy.state = 'alert';
    enemy.think = 0;
    if (source === 'player') enemy.suspicion = Math.min(1, enemy.suspicion + 0.6);
  }
}


/* =========================================================
   ЧАСТИЦЫ, КРОВЬ, ГИЛЬЗЫ
   ========================================================= */

function spark(world, x, y, angle, spread, count, color, speed) {
  for (let i = 0; i < count; i += 1) {
    const a = angle + rand(-spread, spread);
    const v = speed * rand(0.4, 1.2);
    world.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.2, 0.5), max: 0.5, color, size: rand(1, 2.4),
    });
  }
}

function bleed(world, x, y, angle, force) {
  for (let i = 0; i < 22; i += 1) {
    const a = angle + rand(-0.9, 0.9);
    const v = force * rand(0.2, 1.1);
    world.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(0.25, 0.6), max: 0.6, color: '#ff1450', size: rand(1.5, 3.4), wet: true,
    });
  }

  /*
   * Лужа рисуется один раз и остаётся до конца попытки. Она тут не
   * украшение, а карта: по ней видно, где ты уже был и куда идти не надо.
   */
  world.decals.push({ x, y, r: rand(11, 18), a: rand(0.6, 0.9) });
  for (let i = 0; i < 9; i += 1) {
    const a = angle + rand(-0.8, 0.8);
    const d = rand(6, 46);
    world.decals.push({
      x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
      r: rand(3, 9), a: rand(0.35, 0.7),
    });
  }
}


/* =========================================================
   СОЗДАНИЕ МИРА
   ========================================================= */

export function createWorld(level) {
  const world = {
    level,
    w: level.w,
    h: level.h,
    tiles: Uint8Array.from(level.tiles),

    player: {
      x: level.spawn.x * TILE_SIZE + TILE_SIZE / 2,
      y: level.spawn.y * TILE_SIZE + TILE_SIZE / 2,
      vx: 0, vy: 0,
      angle: (level.spawn.angle || 0) * (Math.PI / 4),
      alive: true,
      weapon: 'fists',
      ammo: 0,
      cooldown: 0,
      swing: 0,
      step: 0,
    },

    enemies: [],
    pickups: [],
    bullets: [],
    particles: [],
    decals: [],
    casings: [],
    noises: [],
    corpses: [],

    time: 0,
    kills: 0,
    total: 0,
    state: 'play',
    exitOpen: false,
    alarm: 0,

    flow: null,
    flowTimer: 0,
    flowFrom: -1,

    fx: { shake: 0, hitstop: 0, flash: 0, punch: 0 },
    events: [],
  };

  for (const entity of level.entities) {
    const x = entity.x * TILE_SIZE + TILE_SIZE / 2;
    const y = entity.y * TILE_SIZE + TILE_SIZE / 2;

    if (entity.type === 0 || entity.type === 1) {
      world.enemies.push({
        kind: entity.type === 0 ? 'thug' : 'shooter',
        weapon: entity.type === 0 ? 'bat' : 'pistol',
        ammo: entity.type === 0 ? 0 : 6,
        x, y, vx: 0, vy: 0,
        home: { x, y },
        angle: (entity.angle || 0) * (Math.PI / 4),
        alive: true,
        downed: 0,
        state: 'idle',
        think: rand(0, 1.2),
        heard: null,
        suspicion: 0,
        windup: 0,
        cooldown: rand(0, 0.5),
        step: 0,
      });
      world.total += 1;
      continue;
    }

    if (entity.type === 3) world.pickups.push({ weapon: 'bat', x, y, angle: rand(0, 6.28), ammo: 0, vx: 0, vy: 0, spin: 0 });
    if (entity.type === 4) world.pickups.push({ weapon: 'pistol', x, y, angle: rand(0, 6.28), ammo: WEAPONS.pistol.clip, vx: 0, vy: 0, spin: 0 });
  }

  world.flow = buildFlowField(world, world.player.x, world.player.y);
  return world;
}


/* =========================================================
   ОРУЖИЕ
   ========================================================= */

function fireGun(world, shooter, from) {
  const weapon = WEAPONS[shooter.weapon];
  const angle = shooter.angle + rand(-weapon.spread, weapon.spread) * (from === 'enemy' ? 2.4 : 1);

  world.bullets.push({
    x: shooter.x + Math.cos(shooter.angle) * 14,
    y: shooter.y + Math.sin(shooter.angle) * 14,
    vx: Math.cos(angle) * weapon.speed,
    vy: Math.sin(angle) * weapon.speed,
    from,
    weapon: shooter.weapon,
    life: BULLET_LIFE,
  });

  shooter.ammo -= 1;
  shooter.cooldown = weapon.cooldown;
  shooter.flash = 0.06;

  world.casings.push({
    x: shooter.x, y: shooter.y,
    vx: Math.cos(angle - 1.6) * rand(50, 90),
    vy: Math.sin(angle - 1.6) * rand(50, 90),
    angle: rand(0, 6.28), spin: rand(-14, 14), life: 0.6,
  });

  spark(world, shooter.x + Math.cos(shooter.angle) * 16, shooter.y + Math.sin(shooter.angle) * 16,
    shooter.angle, 0.4, 6, '#ffe06b', 260);

  emitNoise(world, shooter.x, shooter.y, weapon.noise, from);
  world.fx.shake = Math.max(world.fx.shake, from === 'player' ? 3.5 : 2);
  world.events.push({ type: 'shot', from });
}

/*
 * Удар — не снаряд, а мгновенная проверка сектора. Так он честно
 * попадает по тому, кого игрок видел на экране в момент нажатия.
 */
function swingMelee(world, attacker, from) {
  const weapon = WEAPONS[attacker.weapon];
  attacker.cooldown = weapon.cooldown;
  attacker.swing = 0.16;
  emitNoise(world, attacker.x, attacker.y, weapon.noise, from);
  world.events.push({ type: 'swing', from, lethal: weapon.lethal });

  const targets = from === 'player'
    ? world.enemies.filter((e) => e.alive)
    : [world.player].filter((p) => p.alive);

  let connected = false;

  for (const target of targets) {
    const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
    if (dist > weapon.reach + BODY) continue;
    const toTarget = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    if (Math.abs(angleDelta(attacker.angle, toTarget)) > weapon.arc / 2) continue;
    if (!hasSight(world, attacker.x, attacker.y, target.x, target.y)) continue;

    connected = true;

    if (target === world.player) {
      killPlayer(world, toTarget);
      continue;
    }

    /* Лежачего добивают даже кулаком — иначе сбитый враг бессмысленен. */
    if (weapon.lethal || target.downed > 0) {
      killEnemy(world, target, toTarget, 'melee', {
        by: from,
        weapon: attacker.weapon,
        execution: target.downed > 0,
      });
    } else {
      knockDown(world, target, toTarget);
    }
  }

  if (connected) {
    world.fx.hitstop = Math.max(world.fx.hitstop, 0.075);
    world.fx.shake = Math.max(world.fx.shake, 5);
  }
}

export function knockDown(world, enemy, angle) {
  enemy.downed = DOWN_TIME;
  enemy.state = 'down';
  enemy.vx += Math.cos(angle) * 220;
  enemy.vy += Math.sin(angle) * 220;
  spark(world, enemy.x, enemy.y, angle, 1.2, 6, '#ffffff', 120);
  world.events.push({ type: 'knock' });
}

export function killEnemy(world, enemy, angle, cause, source = {}) {
  if (!enemy.alive) return;
  enemy.alive = false;
  world.kills += 1;

  bleed(world, enemy.x, enemy.y, angle, cause === 'bullet' ? 260 : 190);

  world.corpses.push({
    x: enemy.x + Math.cos(angle) * 6,
    y: enemy.y + Math.sin(angle) * 6,
    angle: enemy.angle,
    kind: enemy.kind,
    twitch: 0.5,
  });

  /* Оружие остаётся на полу — из него и собирается следующая минута. */
  if (enemy.weapon) {
    world.pickups.push({
      weapon: enemy.weapon,
      ammo: enemy.ammo,
      x: enemy.x + Math.cos(angle) * 12,
      y: enemy.y + Math.sin(angle) * 12,
      angle: rand(0, 6.28), vx: 0, vy: 0, spin: 0,
    });
  }

  world.fx.hitstop = Math.max(world.fx.hitstop, 0.06);
  world.fx.flash = Math.max(world.fx.flash, 0.25);

  /*
   * Событие несёт не только факт смерти: счёту нужно знать, чьих это рук
   * дело, чем ударили и добивали ли лежачего. Считать это задним числом
   * по состоянию мира уже нельзя — тела к тому моменту одинаковы.
   */
  world.events.push({
    type: 'kill',
    cause,
    by: source.by || 'player',
    weapon: source.weapon || null,
    execution: Boolean(source.execution),
  });

  if (world.kills >= world.total && !world.exitOpen) {
    world.exitOpen = true;
    world.events.push({ type: 'cleared' });
  }
}

export function killPlayer(world, angle) {
  const player = world.player;
  if (!player.alive || world.state !== 'play') return;
  player.alive = false;
  world.state = 'dead';
  bleed(world, player.x, player.y, angle, 240);
  world.fx.hitstop = Math.max(world.fx.hitstop, 0.22);
  world.fx.shake = 11;
  world.events.push({ type: 'death' });
}


/* =========================================================
   ПОДОБРАТЬ И БРОСИТЬ
   ========================================================= */

function tryPickup(world) {
  const player = world.player;
  let best = null;
  let bestDist = 34;

  for (const pickup of world.pickups) {
    if (pickup.flying) continue;
    const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
    if (dist < bestDist) { best = pickup; bestDist = dist; }
  }

  if (!best) return;

  const carried = player.weapon;
  const carriedAmmo = player.ammo;

  player.weapon = best.weapon;
  player.ammo = best.ammo;
  world.pickups.splice(world.pickups.indexOf(best), 1);
  world.events.push({ type: 'pickup' });

  if (carried !== 'fists') {
    world.pickups.push({
      weapon: carried, ammo: carriedAmmo,
      x: player.x, y: player.y, angle: rand(0, 6.28), vx: 0, vy: 0, spin: 0,
    });
  }
}

/*
 * Брошенное оружие сбивает с ног, но не убивает. Это выход из положения,
 * когда патроны кончились, а не второй пистолет.
 */
function tryThrow(world) {
  const player = world.player;
  if (player.weapon === 'fists') return;

  world.pickups.push({
    weapon: player.weapon,
    ammo: player.ammo,
    x: player.x + Math.cos(player.angle) * 12,
    y: player.y + Math.sin(player.angle) * 12,
    vx: Math.cos(player.angle) * 560,
    vy: Math.sin(player.angle) * 560,
    angle: player.angle,
    spin: 22,
    flying: true,
  });

  player.weapon = 'fists';
  player.ammo = 0;
  world.events.push({ type: 'throw' });
}


/* =========================================================
   ШАГ МИРА
   ========================================================= */

export function update(world, dt, intent) {
  world.events.length = 0;

  /* Стоп-кадр в момент удара: он и делает попадание «мясным». */
  if (world.fx.hitstop > 0) {
    world.fx.hitstop -= dt;
    dt = Math.min(dt, 0.004);
  }

  world.fx.shake = Math.max(0, world.fx.shake - dt * 26);
  world.fx.flash = Math.max(0, world.fx.flash - dt * 3.2);
  world.fx.punch = Math.max(0, world.fx.punch - dt * 4);

  if (world.state === 'play') world.time += dt;

  updatePlayer(world, dt, intent);

  world.flowTimer -= dt;
  const playerCell = tileIndex(world, world.player.x, world.player.y);
  if (world.flowTimer <= 0 || playerCell !== world.flowFrom) {
    world.flow = buildFlowField(world, world.player.x, world.player.y);
    world.flowFrom = playerCell;
    world.flowTimer = 0.2;
  }

  for (const enemy of world.enemies) updateEnemy(world, enemy, dt);

  updateBullets(world, dt);
  updateLoose(world, dt);

  for (const noise of world.noises) noise.life -= dt;
  world.noises = world.noises.filter((n) => n.life > 0);

  for (const corpse of world.corpses) corpse.twitch = Math.max(0, corpse.twitch - dt);

  if (world.decals.length > 420) world.decals.splice(0, world.decals.length - 420);
}


function updatePlayer(world, dt, intent) {
  const player = world.player;
  if (!player.alive) return;

  const wish = Math.hypot(intent.moveX, intent.moveY);
  const targetX = wish > 0.001 ? (intent.moveX / Math.max(1, wish)) * PLAYER_SPEED : 0;
  const targetY = wish > 0.001 ? (intent.moveY / Math.max(1, wish)) * PLAYER_SPEED : 0;

  player.vx += clamp(targetX - player.vx, -PLAYER_ACCEL * dt, PLAYER_ACCEL * dt);
  player.vy += clamp(targetY - player.vy, -PLAYER_ACCEL * dt, PLAYER_ACCEL * dt);

  moveBody(world, player, player.vx * dt, player.vy * dt);

  player.step += Math.hypot(player.vx, player.vy) * dt;
  if (player.step > 26) {
    player.step = 0;
    emitNoise(world, player.x, player.y, 58, 'player');
    world.events.push({ type: 'step' });
  }

  if (intent.aimAngle !== null && intent.aimAngle !== undefined) {
    player.angle = intent.aimAngle;
  } else if (wish > 0.1) {
    player.angle = turnToward(player.angle, Math.atan2(player.vy, player.vx), dt * 14);
  }

  player.cooldown = Math.max(0, player.cooldown - dt);
  player.swing = Math.max(0, player.swing - dt);
  player.flash = Math.max(0, (player.flash || 0) - dt);

  if (intent.pickup) tryPickup(world);
  if (intent.throw) tryThrow(world);

  if (intent.attack && player.cooldown <= 0) {
    const weapon = WEAPONS[player.weapon];
    if (weapon.kind === 'gun') {
      if (player.ammo > 0) {
        fireGun(world, player, 'player');
        world.fx.punch = 1;
      } else {
        player.cooldown = 0.25;
        world.events.push({ type: 'dry' });
      }
    } else {
      swingMelee(world, player, 'player');
    }
  }

  /* Выход открыт — стоя на нём, этаж считается сданным. */
  if (world.exitOpen && world.state === 'play' && tileAt(world, player.x, player.y) === TILE.EXIT) {
    world.state = 'clear';
    world.events.push({ type: 'exit' });
  }
}


function updateEnemy(world, enemy, dt) {
  if (!enemy.alive) {
    enemy.vx *= 0.8;
    enemy.vy *= 0.8;
    return;
  }

  enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  enemy.swing = Math.max(0, (enemy.swing || 0) - dt);
  enemy.flash = Math.max(0, (enemy.flash || 0) - dt);

  if (enemy.downed > 0) {
    enemy.downed -= dt;
    enemy.vx *= 0.86;
    enemy.vy *= 0.86;
    moveBody(world, enemy, enemy.vx * dt, enemy.vy * dt);
    if (enemy.downed <= 0) {
      enemy.state = 'alert';
      enemy.heard = { x: world.player.x, y: world.player.y };
    }
    return;
  }

  const move = thinkEnemy(world, enemy, dt, { walk: ENEMY_WALK, run: ENEMY_RUN });

  enemy.vx = lerp(enemy.vx, move.vx, clamp(dt * 9, 0, 1));
  enemy.vy = lerp(enemy.vy, move.vy, clamp(dt * 9, 0, 1));
  moveBody(world, enemy, enemy.vx * dt, enemy.vy * dt);

  /* Тела расталкиваются, иначе толпа слипается в одну точку. */
  for (const other of world.enemies) {
    if (other === enemy || !other.alive) continue;
    const dx = other.x - enemy.x;
    const dy = other.y - enemy.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01 && dist < BODY * 2) {
      const push = (BODY * 2 - dist) * 0.5;
      moveBody(world, enemy, (-dx / dist) * push, (-dy / dist) * push);
    }
  }

  if (move.attack) {
    const weapon = WEAPONS[enemy.weapon];
    if (weapon.kind === 'gun' && enemy.ammo > 0) fireGun(world, enemy, 'enemy');
    else if (weapon.kind === 'melee') swingMelee(world, enemy, 'enemy');
  }

  enemy.step += Math.hypot(enemy.vx, enemy.vy) * dt;
  if (enemy.step > 30) { enemy.step = 0; world.events.push({ type: 'enemystep', x: enemy.x, y: enemy.y }); }
}


function updateBullets(world, dt) {
  for (const bullet of world.bullets) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bullet.vx, bullet.vy) * dt / 6));
    const sx = (bullet.vx * dt) / steps;
    const sy = (bullet.vy * dt) / steps;

    for (let i = 0; i < steps && bullet.life > 0; i += 1) {
      bullet.x += sx;
      bullet.y += sy;

      const tile = tileAt(world, bullet.x, bullet.y);

      if (breakable(tile)) {
        world.tiles[tileIndex(world, bullet.x, bullet.y)] = TILE.FLOOR;
        spark(world, bullet.x, bullet.y, Math.atan2(sy, sx), 2.2, 14, '#9be7ff', 200);
        emitNoise(world, bullet.x, bullet.y, 300, 'glass');
        world.fx.shake = Math.max(world.fx.shake, 3);
        world.events.push({ type: 'glass' });
        /* Витрина запечена в статический слой — его придётся собрать заново. */
        world.rebake = true;
        continue;
      }

      if (blocksShot(tile)) {
        spark(world, bullet.x, bullet.y, Math.atan2(-sy, -sx), 1.1, 5, '#ffe06b', 150);
        bullet.life = 0;
        break;
      }

      const angle = Math.atan2(sy, sx);

      if (bullet.from === 'player') {
        for (const enemy of world.enemies) {
          if (!enemy.alive) continue;
          if (Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < BODY + 1) {
            killEnemy(world, enemy, angle, 'bullet', { by: 'player', weapon: bullet.weapon });
            bullet.life = 0;
            break;
          }
        }
      } else {
        const player = world.player;
        if (player.alive && Math.hypot(player.x - bullet.x, player.y - bullet.y) < BODY + 1) {
          killPlayer(world, angle);
          bullet.life = 0;
        }
        /* Своих тоже задевает: чужая пуля в спину товарища — честный трофей. */
        for (const enemy of world.enemies) {
          if (!enemy.alive || bullet.life <= 0) continue;
          if (Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < BODY + 1) {
            killEnemy(world, enemy, angle, 'bullet', { by: 'enemy', weapon: bullet.weapon });
            bullet.life = 0;
          }
        }
      }
    }

    bullet.life -= dt;
  }

  world.bullets = world.bullets.filter((b) => b.life > 0);
}


function updateLoose(world, dt) {
  for (const pickup of world.pickups) {
    if (!pickup.flying) continue;

    const nx = pickup.x + pickup.vx * dt;
    const ny = pickup.y + pickup.vy * dt;

    if (blocksMove(tileAt(world, nx, ny))) {
      pickup.flying = false;
      pickup.vx = 0;
      pickup.vy = 0;
      pickup.spin = 0;
      spark(world, pickup.x, pickup.y, Math.atan2(-pickup.vy, -pickup.vx), 1, 4, '#cfc3ff', 90);
      emitNoise(world, pickup.x, pickup.y, 200, 'throw');
      continue;
    }

    pickup.x = nx;
    pickup.y = ny;
    pickup.angle += pickup.spin * dt;

    for (const enemy of world.enemies) {
      if (!enemy.alive || enemy.downed > 0) continue;
      if (Math.hypot(enemy.x - pickup.x, enemy.y - pickup.y) < BODY + 6) {
        knockDown(world, enemy, Math.atan2(pickup.vy, pickup.vx));
        world.events.push({ type: 'thrown-hit' });
        world.fx.hitstop = Math.max(world.fx.hitstop, 0.06);
        world.fx.shake = Math.max(world.fx.shake, 4);
        pickup.flying = false;
        pickup.vx = 0;
        pickup.vy = 0;
        pickup.spin = 0;
        break;
      }
    }

    pickup.vx *= 0.995;
    pickup.vy *= 0.995;
    if (Math.hypot(pickup.vx, pickup.vy) < 60) pickup.flying = false;
  }

  for (const particle of world.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.9;
    particle.vy *= 0.9;
    particle.life -= dt;
    if (particle.wet && particle.life <= 0 && !blocksMove(tileAt(world, particle.x, particle.y))) {
      world.decals.push({ x: particle.x, y: particle.y, r: rand(1.5, 3.5), a: rand(0.25, 0.5) });
    }
  }
  world.particles = world.particles.filter((p) => p.life > 0);

  for (const casing of world.casings) {
    casing.x += casing.vx * dt;
    casing.y += casing.vy * dt;
    casing.vx *= 0.87;
    casing.vy *= 0.87;
    casing.angle += casing.spin * dt;
    casing.life -= dt;
  }
  world.casings = world.casings.filter((c) => c.life > 0);
}
