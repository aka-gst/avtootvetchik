/*
 * АВТООТВЕТЧИК — прогон боя без браузера.
 *
 *   node avto/tests/sim.mjs
 *
 * Мир не знает ни про холст, ни про ввод, поэтому его можно крутить в
 * Node и спрашивать с него правила: сбивает ли кулак, слышно ли выстрел,
 * доходит ли враг через двери, открывается ли выход после зачистки.
 *
 * Проверки писались по ходу работы и один раз уже поймали настоящую
 * ошибку: бот не мог зачистить этаж, потому что упирался в стену — с
 * этого начался разбор, кто здесь ищет дорогу, а кто нет.
 */

import { CAMPAIGN } from '../src/levels.js';
import { createWorld, update, WEAPONS, TILE_SIZE, hasSight, tileIndex } from '../src/world.js';
import { createScore } from '../src/score.js';
import { AIM_CONE, assistAim, closeThreat, meleeSnap } from '../src/aim.js';
import { buildFlowField } from '../src/ai.js';
import { blocksMove } from '../src/level.js';

const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: null, attack: false };
const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

function run(world, seconds, intentFor) {
  for (let i = 0; i < seconds / DT; i += 1) {
    update(world, DT, intentFor ? intentFor(world, i * DT) : idle);
  }
}

function nearest(world) {
  let best = null, dist = Infinity;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const d = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    if (d < dist) { dist = d; best = enemy; }
  }
  return { enemy: best, dist };
}

/* --- A. Мир крутится вхолостую и никого не убивает --- */
{
  const world = createWorld(CAMPAIGN[0]);
  run(world, 25);
  check('20 секунд простоя не роняют мир', world.player.alive && world.state === 'play',
    `состояние ${world.state}`);
  check('никто не поднял тревогу сам по себе',
    world.enemies.every((e) => e.state !== 'chase'),
    world.enemies.map((e) => e.state).join(','));
}

/* --- B. Кулак сбивает, второй удар добивает --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const victim = world.enemies[0];
  const player = world.player;
  player.x = victim.x - 20;
  player.y = victim.y;
  player.angle = 0;

  update(world, DT, { ...idle, attack: true });
  check('кулаком враг сбит с ног, но жив', victim.downed > 0 && victim.alive,
    `downed=${victim.downed.toFixed(2)} alive=${victim.alive}`);

  run(world, 0.4);
  update(world, DT, { ...idle, attack: true });
  check('добивание лежачего засчитано', !victim.alive && world.kills === 1,
    `kills=${world.kills}`);
  check('после смерти на полу осталось оружие', world.pickups.some((p) => p.weapon === 'bat'));
}

/* --- C. Выстрел убивает и слышен другим --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const player = world.player;
  const { enemy } = nearest(world);
  player.weapon = 'pistol';
  player.ammo = 12;
  player.x = enemy.x;
  player.y = enemy.y + 120;
  player.angle = -Math.PI / 2;

  const sees = hasSight(world, player.x, player.y, enemy.x, enemy.y);
  update(world, DT, { ...idle, attack: true });
  run(world, 0.4);
  check('пуля с дистанции убивает', sees ? !enemy.alive : true,
    `видимость=${sees} жив=${enemy.alive}`);
  check('патрон списан', player.ammo === 11, `ammo=${player.ammo}`);
  const woken = world.enemies.filter((e) => e.alive && e.state !== 'idle').length;
  check('выстрел поднял соседей', woken > 0, `подняты ${woken}`);
}

/* --- D. Враг доходит до игрока через двери --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const enemy = world.enemies.find((e) => e.kind === 'thug');
  enemy.state = 'chase';
  const before = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
  run(world, 12);
  const after = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
  check('преследователь находит дорогу к игроку', after < before * 0.4 || !world.player.alive,
    `было ${before | 0} стало ${after | 0}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
}

/* --- E. Полная зачистка открывает выход --- */
{
  const world = createWorld(CAMPAIGN[0]);

  /*
   * Бот ходит по той же волне, что и враги: иначе он упирается в стену и
   * тест меряет не игру, а тупость бота.
   */
  function stepToward(w, target) {
    const field = buildFlowField(w, target.x, target.y);
    const player = w.player;
    const cx = Math.floor(player.x / TILE_SIZE);
    const cy = Math.floor(player.y / TILE_SIZE);
    let best = field[cy * w.w + cx];
    if (best < 0) return { x: 0, y: 0 };
    let dx = 0, dy = 0;
    for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      if (ox && oy) {
        if (blocksMove(w.tiles[cy * w.w + nx]) || blocksMove(w.tiles[ny * w.w + cx])) continue;
      }
      const value = field[ny * w.w + nx];
      if (value < 0 || value >= best) continue;
      best = value; dx = ox; dy = oy;
    }
    if (!dx && !dy) return { x: 0, y: 0 };
    const angle = Math.atan2((cy + dy + 0.5) * TILE_SIZE - player.y, (cx + dx + 0.5) * TILE_SIZE - player.x);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  run(world, 120, (w) => {
    const player = w.player;
    player.weapon = 'pistol';
    player.ammo = 12;

    const { enemy, dist } = nearest(w);

    if (enemy) {
      const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      const clear = hasSight(w, player.x, player.y, enemy.x, enemy.y);
      const step = clear && dist < 260 ? { x: 0, y: 0 } : stepToward(w, enemy);
      return { moveX: step.x, moveY: step.y, aimAngle: angle, attack: clear && dist < 420 };
    }

    let exit = null;
    for (let i = 0; i < w.tiles.length && !exit; i += 1) {
      if (w.tiles[i] === 4) exit = { x: ((i % w.w) + 0.5) * TILE_SIZE, y: ((i / w.w | 0) + 0.5) * TILE_SIZE };
    }
    const step = stepToward(w, exit);
    return { moveX: step.x, moveY: step.y, aimAngle: 0, attack: false };
  });

  check('бот зачистил этаж', world.kills === world.total, `${world.kills}/${world.total}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
  check('выход открылся после зачистки', world.exitOpen || !world.player.alive);
  check('дойдя до выхода, этаж засчитан', world.state === 'clear' || !world.player.alive,
    `состояние ${world.state}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
}

/* --- E2. Счёт: цепочка, казнь, ранг --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const score = createScore(CAMPAIGN[0], 1);
  const player = world.player;

  const step = (intent) => {
    update(world, DT, intent || idle);
    score.feed(world.events);
    score.update(DT);
  };

  /* Ставим игрока с битой вплотную к цели и бьём. */
  const strike = (victim) => {
    player.weapon = 'bat';
    player.cooldown = 0;
    player.x = victim.x - 20;
    player.y = victim.y;
    player.angle = 0;
    step({ ...idle, attack: true });
  };

  const alive = world.enemies.filter((e) => e.alive);
  strike(alive[0]);
  const first = score.state.score;
  check('первое убийство стоит базовых очков', first === 100, String(first));

  strike(alive[1]);
  check('второе подряд идёт с множителем ×2', score.state.score === 300, String(score.state.score));
  check('множитель показан верно', score.state.combo === 2, String(score.state.combo));

  /* Пауза длиннее окна цепочки обрывает её. */
  for (let i = 0; i < 4.5 / DT; i += 1) step();
  check('пауза обрывает цепочку', score.state.combo === 0, String(score.state.combo));

  const before = score.state.score;
  strike(alive[2]);
  check('после паузы снова базовая цена', score.state.score - before === 100,
    String(score.state.score - before));

  /* Кулаком сбить, кулаком добить: добивание дороже обычного удара. */
  const victim = alive[3];
  player.weapon = 'fists';
  player.cooldown = 0;
  player.x = victim.x - 18;
  player.y = victim.y;
  player.angle = 0;
  step({ ...idle, attack: true });
  check('кулак не убивает, а сбивает', victim.alive && victim.downed > 0);

  const beforeExecution = score.state.score;
  for (let i = 0; i < 0.4 / DT; i += 1) step();
  player.cooldown = 0;
  step({ ...idle, attack: true });
  const gained = score.state.score - beforeExecution;
  check('добивание лежачего дороже удара', gained === 300, `получено ${gained} при цепочке 2`);
  check('казнь посчитана отдельно', score.state.executions === 1);

  const final = score.finish(world);
  check('ранг рассчитан', ['S', 'A', 'B', 'C', 'D'].includes(final.rank), final.rank);
  check('итог не меньше набранного в бою', final.total >= score.state.score,
    `${final.total} против ${score.state.score}`);
  check('в разборе есть строка за убийства',
    final.lines.some((line) => line.label === 'ЗА УБИЙСТВА'));
}

/* --- E3. Помощь прицела: игра без мыши --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const player = world.player;

  /* Расчищаем этаж: в проверке участвуют только поставленные вручную. */
  for (const enemy of world.enemies) enemy.alive = false;
  const [near, far] = world.enemies;

  /* Ставим только вверх и вбок: под игроком в этом этаже сразу стена. */
  const place = (enemy, dx, dy) => {
    enemy.alive = true;
    enemy.downed = 0;
    enemy.x = player.x + dx;
    enemy.y = player.y + dy;
  };

  /* Враг в 40° от направления бега — сектор бега должен его достать. */
  place(near, 120, -100);
  const running = Math.atan2(0, 1);
  const aimed = assistAim(world, running, AIM_CONE.run);
  const toNear = Math.atan2(near.y - player.y, near.x - player.x);
  check('прицел доводится до цели в стороне от курса',
    Math.abs(aimed - toNear) < 0.001,
    `${(aimed * 57.3).toFixed(0)}° против ${(toNear * 57.3).toFixed(0)}°`);

  check('узкий сектор мыши так далеко не тянется',
    assistAim(world, running, AIM_CONE.mouse) === running);

  /*
   * Правило выбора цели: направление задаёт игрок, расстояние только
   * разнимает близкие по углу. Иначе наводка начинает спорить с тем,
   * куда человек показал, и это читается как «прицел живёт своей жизнью».
   */
  place(far, 200, -8);
  place(near, 100, -4);
  const closer = assistAim(world, running, AIM_CONE.run);
  check('при равном угле выбирается ближний',
    Math.abs(closer - Math.atan2(near.y - player.y, near.x - player.x)) < 0.001,
    `${(closer * 57.3).toFixed(1)}°`);

  place(far, 300, -6);
  place(near, 90, -60);
  const aligned = assistAim(world, running, AIM_CONE.run);
  check('точно по курсу важнее, чем просто рядом',
    Math.abs(aligned - Math.atan2(far.y - player.y, far.x - player.x)) < 0.001,
    `${(aligned * 57.3).toFixed(1)}°`);
  far.alive = false;

  /* За стеной наводка не работает — иначе прицел липнет сквозь этаж. */
  place(near, 0, -180);
  check('стена между — цель не ловится (проверка расстановки)',
    !hasSight(world, player.x, player.y, near.x, near.y));
  check('сквозь стену прицел не тянет',
    assistAim(world, -Math.PI / 2, AIM_CONE.run) === -Math.PI / 2);

  /* Стоим без ввода: подошедший вплотную сам притягивает взгляд. */
  place(near, -60, 0);
  const threat = closeThreat(world);
  check('стоя на месте, поворачиваемся к тому, кто рядом',
    threat !== null && Math.abs(Math.abs(threat) - Math.PI) < 0.001, String(threat));

  place(near, 260, 0);
  check('дальний никого не притягивает', closeThreat(world) === null);

  /* Добор удара: враг сбоку, замах смотрит прямо. */
  player.weapon = 'bat';
  place(near, 8, -26);
  const snapped = meleeSnap(world, 0);
  check('удар доворачивается на стоящего вплотную сбоку',
    snapped !== null && Math.abs(snapped - Math.atan2(-26, 8)) < 0.001, String(snapped));

  place(near, 30, 2);
  check('если цель уже под ударом, доворота нет', meleeSnap(world, 0) === null);

  /* И то же самое целиком: стоя на месте, добить соседа сбоку. */
  place(near, 4, -28);
  player.cooldown = 0;
  const angle = closeThreat(world);
  const finalAngle = meleeSnap(world, angle === null ? player.angle : angle) ?? angle;
  update(world, DT, { moveX: 0, moveY: 0, aimAngle: finalAngle, attack: true });
  check('стоя без движения, удар по соседу засчитан', !near.alive,
    near.alive ? 'враг цел' : 'враг убит');
}

/* --- F. Производительность шага --- */
{
  const world = createWorld(CAMPAIGN[0]);
  for (const enemy of world.enemies) enemy.state = 'chase';
  const started = process.hrtime.bigint();
  run(world, 10);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const perFrame = ms / (10 / DT);
  check('шаг мира укладывается в бюджет кадра', perFrame < 1.2,
    `${perFrame.toFixed(3)} мс на кадр при всех врагах в погоне`);
}

console.log(report.join('\n'));
console.log(failures ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}` : '\nвсе проверки прошли');
process.exit(failures ? 1 : 0);
