/*
 * АВТООТВЕТЧИК — помощь прицеливанию.
 *
 * Игра задумана так, что играть в неё можно тремя разными телами: мышью,
 * клавишами и пальцем. Точность у них разная на порядок, а правила боя
 * одни, поэтому прицел приходится дотягивать — иначе клавиатура честно
 * проигрывает мыши на ровном месте.
 *
 * Модуль ничего не знает про ввод и про экран: ему дают мир и угол, он
 * возвращает угол. Поэтому его проверяет прогон, а не глаз.
 */

import { WEAPONS, BODY, hasSight, angleDelta } from './world.js';

/*
 * Помощь прицеливанию. Ширина сектора зависит от того, чем целятся:
 * мышь наводится точно и почти не нуждается в помощи, стрелки дают
 * всего восемь направлений, а бег — одно, и между ними зияют дыры,
 * в которые проваливается всё, что не строго по курсу.
 */
export const AIM_CONE = {
  mouse: 0.06,
  stick: 0.45,
  keys: 0.5,
  run: 0.7,
};

export function assistAim(world, angle, cone) {
  const player = world.player;
  let best = angle;
  let bestScore = Infinity;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 360) continue;

    const toEnemy = Math.atan2(dy, dx);
    const diff = Math.abs(angleDelta(angle, toEnemy));
    if (diff > cone) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;

    /* Ближний важнее идеально соосного: бьют того, кто уже дышит в лицо. */
    const score = diff + dist / 1400;
    if (score >= bestScore) continue;
    bestScore = score;
    best = toEnemy;
  }

  return best;
}

/*
 * Стоя без единой нажатой клавиши, повернуться было нечем: прицел брался
 * только из движения. Поэтому вплотную подошедший враг сам притягивает
 * взгляд — иначе игра требует отбежать, чтобы ударить стоящего рядом.
 */
export function closeThreat(world, radius = 130) {
  const player = world.player;
  let angle = null;
  let best = radius;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > best) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    best = dist;
    angle = Math.atan2(dy, dx);
  }

  return angle;
}

/*
 * Добор удара. Если в секторе замаха никого нет, а в шаге стоит враг —
 * доворачиваем на него. Это правит ровно ту обиду, когда удар «прошёл
 * сквозь» стоящего вплотную только потому, что он был на десять градусов
 * левее.
 */
export function meleeSnap(world, angle) {
  const player = world.player;
  const weapon = WEAPONS[player.weapon];
  if (weapon.kind !== 'melee') return null;

  const reach = weapon.reach + BODY;
  let target = null;
  let best = Infinity;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach) continue;

    const toEnemy = Math.atan2(dy, dx);
    const diff = Math.abs(angleDelta(angle, toEnemy));
    /* Кто-то уже под ударом — не отбираем у игрока выбранную цель. */
    if (diff < weapon.arc / 2) return null;
    if (diff > 1.8) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    if (dist >= best) continue;
    best = dist;
    target = toEnemy;
  }

  return target;
}

export function hasTargetUnderAim(world, angle) {
  const player = world.player;
  const weapon = WEAPONS[player.weapon];
  const range = weapon.kind === 'gun' ? 360 : weapon.reach + 12;
  const spread = weapon.kind === 'gun' ? 0.2 : weapon.arc / 2;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    if (Math.hypot(dx, dy) > range) continue;
    if (Math.abs(angleDelta(angle, Math.atan2(dy, dx))) > spread) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    return true;
  }

  return false;
}


/*
 * Есть ли под ударом тот, кто уже знает про игрока.
 *
 * По этому условию срабатывает автоудар: в схеме, где обе руки заняты
 * ходьбой и набором, жать ещё и удар в ближнем бою нечем. Но только по
 * заметившим — иначе автоудар сам убивал бы стоящих спиной, и красться
 * мимо часового стало бы невозможно.
 */
export function awareTargetInReach(world, angle) {
  const player = world.player;
  const weapon = WEAPONS[player.weapon];
  if (weapon.kind !== 'melee') return false;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    if (enemy.state !== 'chase' && enemy.state !== 'alert' && enemy.state !== 'down') continue;

    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    if (Math.hypot(dx, dy) > weapon.reach + BODY) continue;
    if (Math.abs(angleDelta(angle, Math.atan2(dy, dx))) > weapon.arc / 2) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    return true;
  }

  return false;
}
