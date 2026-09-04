/*
 * Правила большой операции. Здесь живут цель и итог, но не отрисовка:
 * один и тот же исход обязан получаться у человека и в прогоне Node.
 */

import { blocksMove, TILE, TILE_SIZE } from './level.js';
import { GROUND } from './field.js';

const PICKUP_RADIUS = 18;
const FOLLOW_DISTANCE = 28;
const FOLLOW_SPEED = 112;
const CIVIL_SPEED = 92;

function cellAt(world, x, y) {
  return Math.floor(y / TILE_SIZE) * world.w + Math.floor(x / TILE_SIZE);
}

export function createOperation(enabled) {
  return enabled ? {
    required: 'core',
    coreTaken: false,
    hostageReleased: false,
    escaped: false,
    alerts: 0,
    candleLesson: false,
    waterLesson: false,
  } : null;
}

function safeAt(world, x, y) {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  const tile = world.tiles[ty * world.w + tx];
  if (blocksMove(tile)) return false;
  const ground = world.ground[ty * world.w + tx];
  if (ground === GROUND.FIRE) return false;
  if (ground === GROUND.WATER && world.charged?.tiles?.has(ty * world.w + tx)) return false;
  return true;
}

function nextSafeCell(world, body, target) {
  const start = cellAt(world, body.x, body.y);
  const goal = cellAt(world, target.x, target.y);
  if (start === goal) return null;

  const previous = new Int32Array(world.w * world.h).fill(-1);
  const queue = new Int32Array(world.w * world.h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  previous[start] = start;

  while (head < tail && previous[goal] < 0) {
    const at = queue[head++];
    const x = at % world.w;
    const y = Math.floor(at / world.w);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const next = ny * world.w + nx;
      if (previous[next] >= 0) continue;
      const cx = (nx + 0.5) * TILE_SIZE;
      const cy = (ny + 0.5) * TILE_SIZE;
      if (!safeAt(world, cx, cy)) continue;
      previous[next] = at;
      queue[tail++] = next;
    }
  }
  if (previous[goal] < 0) return null;

  let next = goal;
  while (previous[next] !== start) next = previous[next];
  return {
    x: (next % world.w + 0.5) * TILE_SIZE,
    y: (Math.floor(next / world.w) + 0.5) * TILE_SIZE,
  };
}

function nearestDanger(world, body) {
  let danger = null;
  let best = TILE_SIZE * 5;
  for (let i = 0; i < world.ground.length; i += 1) {
    if (world.ground[i] !== GROUND.FIRE) continue;
    const x = (i % world.w + 0.5) * TILE_SIZE;
    const y = (Math.floor(i / world.w) + 0.5) * TILE_SIZE;
    const distance = Math.hypot(body.x - x, body.y - y);
    if (distance < best) { best = distance; danger = { x, y }; }
  }
  for (const noise of world.noises || []) {
    const distance = Math.hypot(body.x - noise.x, body.y - noise.y);
    if (distance < best) { best = distance; danger = noise; }
  }
  return danger;
}

function fleeCivilians(world, dt) {
  for (const body of world.civilians) {
    if (!body.alive || body.downed > 0) continue;
    const danger = nearestDanger(world, body);
    if (!danger) { body.vx = 0; body.vy = 0; continue; }

    const cx = Math.floor(body.x / TILE_SIZE);
    const cy = Math.floor(body.y / TILE_SIZE);
    const options = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
      .map(([x, y]) => ({ x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE }))
      .filter((point) => safeAt(world, point.x, point.y))
      .sort((a, b) => Math.hypot(b.x - danger.x, b.y - danger.y)
        - Math.hypot(a.x - danger.x, a.y - danger.y));
    const target = options[0];
    if (!target) continue;
    const dx = target.x - body.x;
    const dy = target.y - body.y;
    const gap = Math.hypot(dx, dy);
    const step = Math.min(CIVIL_SPEED * dt, gap);
    body.vx = dx / gap * CIVIL_SPEED;
    body.vy = dy / gap * CIVIL_SPEED;
    const nx = body.x + dx / gap * step;
    const ny = body.y + dy / gap * step;
    if (safeAt(world, nx, body.y)) body.x = nx;
    if (safeAt(world, body.x, ny)) body.y = ny;
  }
}

export function updateOperation(world, dt = 0) {
  if (!world.operation || !world.player.alive) return;

  fleeCivilians(world, dt);

  const core = world.core;
  if (core && !core.taken
    && Math.hypot(world.player.x - core.x, world.player.y - core.y) <= PICKUP_RADIUS) {
    core.taken = true;
    world.operation.coreTaken = true;
    world.events.push({ type: 'core-taken' });
  }

  const hostage = world.hostage;
  if (!hostage || !hostage.alive) return;
  if (!hostage.released && !world.powered) {
    hostage.released = true;
    world.operation.hostageReleased = true;
    world.events.push({ type: 'hostage-released' });
  }
  if (!hostage.released || hostage.downed > 0) return;

  const dx = world.player.x - hostage.x;
  const dy = world.player.y - hostage.y;
  const gap = Math.hypot(dx, dy);
  if (gap > FOLLOW_DISTANCE && dt > 0) {
    const waypoint = nextSafeCell(world, hostage, world.player);
    const tx = waypoint?.x ?? world.player.x;
    const ty = waypoint?.y ?? world.player.y;
    const pathDx = tx - hostage.x;
    const pathDy = ty - hostage.y;
    const pathGap = Math.hypot(pathDx, pathDy);
    const step = Math.min(FOLLOW_SPEED * dt, pathGap);
    const nx = hostage.x + pathDx / pathGap * step;
    const ny = hostage.y + pathDy / pathGap * step;
    if (safeAt(world, nx, hostage.y)) hostage.x = nx;
    if (safeAt(world, hostage.x, ny)) hostage.y = ny;
  }

  if (world.operation.coreTaken && world.exitOpen
      && Math.hypot(world.player.x - hostage.x, world.player.y - hostage.y) <= TILE_SIZE * 2) {
    if (world.tiles[cellAt(world, world.player.x, world.player.y)] === TILE.EXIT) {
      hostage.rescued = true;
    }
  }
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
