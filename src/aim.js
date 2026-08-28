/*
 * АВТООТВЕТЧИК — помощь прицеливанию.
 *
 * Играть можно тремя разными телами: мышью, клавишами и пальцем. Точность
 * у них разная на порядок, а правила боя одни, поэтому прицел приходится
 * дотягивать — иначе клавиатура честно проигрывает мыши на ровном месте.
 *
 * Модуль ничего не знает про ввод и про экран: ему дают мир и угол, он
 * возвращает угол. Поэтому его проверяет прогон, а не глаз.
 */

import { hasSight, angleDelta } from './world.js';

/*
 * Помощь прицеливанию. Ширина сектора зависит от того, чем целятся:
 * мышь наводится точно и почти не нуждается в помощи, стрелки дают
 * всего восемь направлений, а бег — одно, и между ними зияют дыры,
 * в которые проваливается всё, что не строго по курсу.
 */
export const AIM_CONE = {
  mouse: 0.06,
  stick: 0.45,
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
 * Есть ли цель под прицелом — для пальца: на телефоне наведённый стик
 * выпускает набранное сам, потому что целиться и жать одним и тем же
 * большим пальцем невозможно.
 */
export function hasTargetUnderAim(world, angle) {
  const player = world.player;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    if (Math.hypot(dx, dy) > 360) continue;
    if (Math.abs(angleDelta(angle, Math.atan2(dy, dx))) > 0.2) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    return true;
  }

  return false;
}


/*
 * Захват цели.
 *
 * Доводка прицела помогает, только когда игрок уже смотрит примерно туда.
 * С клавиатуры «примерно туда» не получается: направление берётся из бега,
 * а бежать приходится в сторону. Поэтому при живой цели в комнате взгляд
 * держится за неё сам — как ствол за плечом, а не как курсор за мышью.
 *
 * Прежняя цель не бросается, пока жива и видна: иначе прицел прыгает
 * между двумя одинаково удобными врагами и промахивается по обоим.
 */
const LOCK_RANGE = 470;
const LOCK_KEEP = 520;

export function lockTarget(world, previous, facing) {
  const player = world.player;

  const visible = (enemy, limit) => {
    if (!enemy || !enemy.alive) return false;
    const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (dist > limit) return false;
    return hasSight(world, player.x, player.y, enemy.x, enemy.y);
  };

  if (visible(previous, LOCK_KEEP)) return previous;

  let best = null;
  let bestScore = Infinity;

  for (const enemy of world.enemies) {
    if (!visible(enemy, LOCK_RANGE)) continue;

    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const dist = Math.hypot(dx, dy);
    const off = Math.abs(angleDelta(facing, Math.atan2(dy, dx)));

    /* Ближе — важнее, но и разворачиваться на 180° ради лишнего метра глупо. */
    const score = dist + off * 140;
    if (score >= bestScore) continue;
    bestScore = score;
    best = enemy;
  }

  return best;
}
