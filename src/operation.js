/*
 * Правила большой операции. Здесь живут цель и итог, но не отрисовка:
 * один и тот же исход обязан получаться у человека и в прогоне Node.
 */

const PICKUP_RADIUS = 18;

export function createOperation(enabled) {
  return enabled ? {
    required: 'core',
    coreTaken: false,
    hostageReleased: false,
    escaped: false,
    alerts: 0,
  } : null;
}

export function updateOperation(world) {
  if (!world.operation || !world.player.alive) return;

  const core = world.core;
  if (core && !core.taken
    && Math.hypot(world.player.x - core.x, world.player.y - core.y) <= PICKUP_RADIUS) {
    core.taken = true;
    world.operation.coreTaken = true;
    world.events.push({ type: 'core-taken' });
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
