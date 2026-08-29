/*
 * ТЕХНОМАГИЯ — помощь прицеливанию.
 *
 * Играть можно тремя разными телами: мышью, клавишами и пальцем. Точность
 * у них разная на порядок, а правила боя одни, поэтому прицел приходится
 * дотягивать — иначе клавиатура честно проигрывает мыши на ровном месте.
 *
 * Модуль ничего не знает про ввод и про экран: ему дают мир и угол, он
 * возвращает угол. Поэтому его проверяет прогон, а не глаз.
 */

import { hasSight, angleDelta, TILE_SIZE } from './world.js';
import { weakTo } from './level.js';

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

/*
 * Целью может быть не только живой. Бочку, валун и кристалл ломают тем же
 * заклинанием, что и врага, — а попасть по ним с клавиатуры было нельзя
 * вовсе: прицел держался за тела и на неподвижное не наводился никогда.
 * Обучалка при этом просила разбить бочку, и сделать это можно было только
 * мышью. Теперь предметы стоят в том же списке целей.
 *
 * Но стоят позади: пока в комнате есть живой, взгляд держится за живого —
 * иначе в бою прицел уезжал бы на скамейку. Переключает Tab.
 */
const PROP_PENALTY = 900;

function targetAt(world, index) {
  return {
    prop: index,
    x: ((index % world.w) + 0.5) * TILE_SIZE,
    y: (((index / world.w) | 0) + 0.5) * TILE_SIZE,
  };
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.prop !== undefined || b.prop !== undefined) return a.prop === b.prop;
  return a === b;
}

/* Живой ли ещё захват. Предмет «жив», пока цел: разбитый перестаёт быть
   целью в тот же кадр, и прицел уходит дальше сам. */
function alive(world, target) {
  if (!target) return false;
  if (target.prop !== undefined) return weakTo(world.tiles[target.prop]) !== null;
  return Boolean(target.alive);
}

function visible(world, target, limit) {
  if (!alive(world, target)) return false;
  const player = world.player;
  const dist = Math.hypot(target.x - player.x, target.y - player.y);
  if (dist > limit) return false;
  return hasSight(world, player.x, player.y, target.x, target.y);
}

/* Все цели по порядку удобства: сначала живые, потом предметы. */
export function lockCandidates(world, facing) {
  const player = world.player;
  const out = [];

  const add = (target, penalty) => {
    if (!visible(world, target, LOCK_RANGE)) return;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const off = Math.abs(angleDelta(facing, Math.atan2(dy, dx)));
    /* Ближе — важнее, но и разворачиваться на 180° ради лишнего метра глупо. */
    out.push({ target, score: Math.hypot(dx, dy) + off * 140 + penalty });
  };

  for (const enemy of world.enemies) add(enemy, 0);
  for (let i = 0; i < world.tiles.length; i += 1) {
    if (weakTo(world.tiles[i])) add(targetAt(world, i), PROP_PENALTY);
  }

  return out.sort((a, b) => a.score - b.score).map((entry) => entry.target);
}

export function lockTarget(world, previous, facing) {
  if (visible(world, previous, LOCK_KEEP)) {
    /* Предмет пересобирается каждый кадр, поэтому возвращаем свежий
       объект с теми же координатами, а не устаревший. */
    return previous.prop !== undefined ? targetAt(world, previous.prop) : previous;
  }
  return lockCandidates(world, facing)[0] || null;
}

/* Следующая цель по кругу. Один и тот же список, тот же порядок — значит
   Tab всегда идёт в одну сторону, а не прыгает случайно. */
export function cycleTarget(world, previous, facing) {
  const list = lockCandidates(world, facing);
  if (!list.length) return null;
  const at = list.findIndex((target) => sameTarget(target, previous));
  return list[(at + 1) % list.length];
}
