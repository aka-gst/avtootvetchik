/*
 * АВТООТВЕТЧИК — прогон боя без браузера.
 *
 *   node tests/sim.mjs
 *
 * Мир не знает ни про холст, ни про ввод, поэтому его можно крутить в
 * Node и спрашивать с него правила: убивает ли плевок, слышно ли его,
 * доходит ли враг через двери, открывается ли выход после зачистки, и
 * окупается ли длинная очередь по сравнению с короткой.
 *
 * Проверки писались по ходу работы и дважды ловили настоящие ошибки:
 * бот не мог зачистить этаж, потому что упирался в стену, а взмах оружия
 * убивал всех в секторе разом и делал очередь демонов бессмысленной.
 */

import { CAMPAIGN } from '../src/levels.js';
import { createWorld, update, TILE_SIZE, hasSight, tileIndex } from '../src/world.js';
import { buildFlowField } from '../src/ai.js';
import { blocksMove } from '../src/level.js';
import { createScore } from '../src/score.js';
import { AIM_CONE, assistAim, closeThreat } from '../src/aim.js';
import { CHARGE_STEP, shapeOf, formFor } from '../src/daemons.js';

const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: null, attack: false, charge: null };
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
  let best = null;
  let dist = Infinity;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const d = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    if (d < dist) { dist = d; best = enemy; }
  }
  return { enemy: best, dist };
}

/* Набрать очередь и выпустить её: ровно то, что делает игрок руками. */
function cast(world, stack, angle) {
  const player = world.player;
  for (const element of stack) {
    update(world, DT, { ...idle, aimAngle: angle, charge: element });
    while (player.chargeLeft > 0) update(world, DT, { ...idle, aimAngle: angle });
  }
  update(world, DT, { ...idle, aimAngle: angle, attack: true });
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

/* --- B. Плевок убивает и слышен --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const player = world.player;
  const { enemy } = nearest(world);

  player.x = enemy.x;
  player.y = enemy.y + 120;
  const angle = -Math.PI / 2;

  const sees = hasSight(world, player.x, player.y, enemy.x, enemy.y);
  cast(world, ['fire'], angle);
  run(world, 0.5);

  check('одиночный демон убивает с дистанции', sees ? !enemy.alive : true,
    `видимость=${sees} жив=${enemy.alive}`);
  check('очередь после выстрела пуста', player.stack.length === 0);

  /*
   * Плевок тихий — на нём держится тихая игра: без оружия ближнего боя
   * это единственный способ убрать одного и не собрать этаж. Большие
   * формы, наоборот, слышно везде, и это их честная цена.
   */
  const woke = world.enemies.filter((e) => e.alive && e.state !== 'idle').length;
  check('одиночный демон не поднимает весь этаж', woke <= 1, `подняты ${woke}`);

  const loud = createWorld(CAMPAIGN[0]);
  loud.player.x = world.player.x;
  loud.player.y = world.player.y;
  cast(loud, ['fire', 'fire', 'fire'], angle);
  run(loud, 0.8);
  check('луч слышно через стены',
    loud.enemies.filter((e) => e.alive && e.state !== 'idle').length > woke,
    `подняты ${loud.enemies.filter((e) => e.alive && e.state !== 'idle').length}`);
}

/* --- C. Пустая очередь: удар ничего не делает, но говорит об этом --- */
{
  const world = createWorld(CAMPAIGN[0]);
  update(world, DT, { ...idle, attack: true });
  check('удар с пустой очередью не молчит',
    world.events.some((e) => e.type === 'dry'));
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

  /* Бот ходит по той же волне, что и враги: иначе он упирается в стену и
     тест меряет не игру, а тупость бота. */
  function stepToward(w, target) {
    const field = buildFlowField(w, target.x, target.y);
    const player = w.player;
    const cx = Math.floor(player.x / TILE_SIZE);
    const cy = Math.floor(player.y / TILE_SIZE);
    let best = field[cy * w.w + cx];
    if (best < 0) return { x: 0, y: 0 };
    let dx = 0;
    let dy = 0;
    for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      if (ox && oy && (blocksMove(w.tiles[cy * w.w + nx]) || blocksMove(w.tiles[ny * w.w + cx]))) continue;
      const value = field[ny * w.w + nx];
      if (value < 0 || value >= best) continue;
      best = value; dx = ox; dy = oy;
    }
    if (!dx && !dy) return { x: 0, y: 0 };
    const angle = Math.atan2((cy + dy + 0.5) * TILE_SIZE - player.y, (cx + dx + 0.5) * TILE_SIZE - player.x);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  run(world, 150, (w) => {
    const player = w.player;
    const { enemy, dist } = nearest(w);

    if (enemy) {
      const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      const clear = hasSight(w, player.x, player.y, enemy.x, enemy.y);

      /* Стреляем одиночными: бот проверяет проходимость игры, а не мастерство. */
      if (clear && dist < 260) {
        if (player.stack.length) return { ...idle, aimAngle: angle, attack: true };
        if (player.chargeLeft <= 0) return { ...idle, aimAngle: angle, charge: 'fire' };
        return { ...idle, aimAngle: angle };
      }

      const step = stepToward(w, enemy);
      return { ...idle, moveX: step.x, moveY: step.y, aimAngle: angle };
    }

    let exit = null;
    for (let i = 0; i < w.tiles.length && !exit; i += 1) {
      if (w.tiles[i] === 4) {
        exit = { x: ((i % w.w) + 0.5) * TILE_SIZE, y: ((i / w.w | 0) + 0.5) * TILE_SIZE };
      }
    }
    const step = stepToward(w, exit);
    return { ...idle, moveX: step.x, moveY: step.y };
  });

  check('бот зачистил этаж демонами', world.kills === world.total,
    `${world.kills}/${world.total}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
  check('выход открылся после зачистки', world.exitOpen || !world.player.alive);
  check('дойдя до выхода, этаж засчитан', world.state === 'clear' || !world.player.alive,
    `состояние ${world.state}`);
}

/* --- E2. Счёт: цепочка и ранг --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const score = createScore(CAMPAIGN[0], 1);
  const player = world.player;

  const step = (intent) => {
    update(world, DT, intent || idle);
    score.feed(world.events);
    score.update(DT);
  };

  const kill = (victim) => {
    player.x = victim.x;
    player.y = victim.y + 60;
    const angle = -Math.PI / 2;
    for (const element of ['fire']) {
      step({ ...idle, aimAngle: angle, charge: element });
      while (player.chargeLeft > 0) step({ ...idle, aimAngle: angle });
    }
    player.cooldown = 0;
    step({ ...idle, aimAngle: angle, attack: true });
    for (let i = 0; i < 12; i += 1) step();
  };

  const alive = world.enemies.filter((e) => e.alive);
  kill(alive[0]);
  check('первое убийство стоит базовых очков', score.state.score === 100, String(score.state.score));

  kill(alive[1]);
  check('второе подряд идёт с множителем ×2', score.state.score === 300, String(score.state.score));

  for (let i = 0; i < 4.5 / DT; i += 1) step();
  check('пауза обрывает цепочку', score.state.combo === 0);

  const final = score.finish(world);
  check('ранг рассчитан', ['S', 'A', 'B', 'C', 'D'].includes(final.rank), final.rank);
  check('в разборе есть строка за убийства',
    final.lines.some((line) => line.label === 'ЗА УБИЙСТВА'));
}

/* --- E3. Помощь прицела: игра без мыши --- */
{
  const world = createWorld(CAMPAIGN[0]);
  const player = world.player;

  for (const enemy of world.enemies) enemy.alive = false;
  const [near, far] = world.enemies;

  /* Ставим только вверх и вбок: под игроком в этом этаже сразу стена. */
  const place = (enemy, dx, dy) => {
    enemy.alive = true;
    enemy.downed = 0;
    enemy.x = player.x + dx;
    enemy.y = player.y + dy;
  };

  place(near, 120, -100);
  const running = 0;
  const aimed = assistAim(world, running, AIM_CONE.run);
  const toNear = Math.atan2(near.y - player.y, near.x - player.x);
  check('прицел доводится до цели в стороне от курса', Math.abs(aimed - toNear) < 0.001,
    `${(aimed * 57.3).toFixed(0)}° против ${(toNear * 57.3).toFixed(0)}°`);
  check('узкий сектор мыши так далеко не тянется',
    assistAim(world, running, AIM_CONE.mouse) === running);

  /*
   * Правило выбора цели: направление задаёт игрок, расстояние только
   * разнимает близкие по углу. Иначе наводка начинает спорить с тем,
   * куда человек показал.
   */
  place(far, 200, -8);
  place(near, 100, -4);
  check('при равном угле выбирается ближний',
    Math.abs(assistAim(world, running, AIM_CONE.run)
      - Math.atan2(near.y - player.y, near.x - player.x)) < 0.001);

  place(far, 300, -6);
  place(near, 90, -60);
  check('точно по курсу важнее, чем просто рядом',
    Math.abs(assistAim(world, running, AIM_CONE.run)
      - Math.atan2(far.y - player.y, far.x - player.x)) < 0.001);
  far.alive = false;

  place(near, 0, -180);
  check('стена между — цель не ловится (проверка расстановки)',
    !hasSight(world, player.x, player.y, near.x, near.y));
  check('сквозь стену прицел не тянет',
    assistAim(world, -Math.PI / 2, AIM_CONE.run) === -Math.PI / 2);

  place(near, -60, 0);
  const threat = closeThreat(world);
  check('стоя на месте, поворачиваемся к тому, кто рядом',
    threat !== null && Math.abs(Math.abs(threat) - Math.PI) < 0.001);

  place(near, 260, 0);
  check('дальний никого не притягивает', closeThreat(world) === null);
  check('с набранной очередью взгляд достаёт дальше', closeThreat(world, 300) !== null);
}

/* --- E4. Демоны: узоры и цена набора --- */
{
  check('одна стихия — плевок', shapeOf(['fire']).id === 'spit');
  check('две одинаковые — сгусток', shapeOf(['water', 'water']).id === 'bolt');
  check('две разные — выдох', shapeOf(['water', 'fire']).id === 'cone');
  check('три одинаковые — луч', shapeOf(['fire', 'fire', 'fire']).id === 'beam');
  check('края одинаковые — пробой', shapeOf(['fire', 'water', 'fire']).id === 'pierce');
  check('три разные — вспышка', shapeOf(['fire', 'water', 'wind']).id === 'nova');
  check('две и третья — залп, а не пустота', shapeOf(['fire', 'fire', 'water']).id === 'shard');
  check('форма несёт все свои стихии',
    formFor(['fire', 'water', 'fire']).elements.sort().join() === 'fire,water');

  const world = createWorld(CAMPAIGN[0]);
  const player = world.player;

  update(world, DT, { ...idle, charge: 'fire' });
  check('набор занимает слот не мгновенно', player.stack.length === 0 && player.chargeLeft > 0);

  let waited = DT;
  while (player.chargeLeft > 0 && waited < 1) { update(world, DT, idle); waited += DT; }
  check('стихия ложится в очередь через шаг набора',
    player.stack.length === 1 && Math.abs(waited - CHARGE_STEP) < 0.05,
    `${waited.toFixed(2)} с при шаге ${CHARGE_STEP}`);

  update(world, DT, { ...idle, dump: true });
  check('сброс очищает очередь', player.stack.length === 0);

  const free = createWorld(CAMPAIGN[0]);
  for (let i = 0; i < 20; i += 1) update(free, DT, { ...idle, moveX: 1 });
  const freeSpeed = Math.hypot(free.player.vx, free.player.vy);

  const slow = createWorld(CAMPAIGN[0]);
  update(slow, DT, { ...idle, moveX: 1, charge: 'water' });
  for (let i = 0; i < 10; i += 1) update(slow, DT, { ...idle, moveX: 1 });
  check('во время набора игрок медленнее',
    Math.hypot(slow.player.vx, slow.player.vy) < freeSpeed * 0.7,
    `${Math.hypot(slow.player.vx, slow.player.vy) | 0} против ${freeSpeed | 0}`);
}

/* --- E5. Щит носителя --- */
{
  const wrong = createWorld(CAMPAIGN[1]);
  const carrier = wrong.enemies.find((e) => e.shield === 'water');
  check('на втором этаже есть носитель воды', Boolean(carrier));

  wrong.player.x = carrier.x - 40;
  wrong.player.y = carrier.y;
  cast(wrong, ['fire'], 0);
  run(wrong, 0.2);
  check('чужая стихия щит срывает, носителя не берёт',
    carrier.alive && carrier.shield === null, `жив=${carrier.alive}`);
  check('сорванный щит выключает носителя', carrier.stagger > 0,
    `оглушение ${carrier.stagger.toFixed(2)} с`);
  run(wrong, 0.5);
  check('оглушение проходит само', carrier.stagger <= 0);

  const right = createWorld(CAMPAIGN[1]);
  const matched = right.enemies.find((e) => e.shield === 'water');
  right.player.x = matched.x - 40;
  right.player.y = matched.y;
  cast(right, ['water'], 0);
  run(right, 0.4);
  check('свой демон снимает щит вместе с носителем', !matched.alive);
}

/* --- E6. Вспышка не разбирает своих --- */
{
  const tight = createWorld(CAMPAIGN[1]);
  tight.player.x = 6 * TILE_SIZE + TILE_SIZE / 2;
  tight.player.y = 13 * TILE_SIZE + TILE_SIZE / 2;
  tight.player.stack = ['fire', 'water', 'wind'];
  update(tight, DT, { ...idle, attack: true });
  check('вспышка в узком проходе достаёт и того, кто её выпустил', !tight.player.alive);

  const open = createWorld(CAMPAIGN[1]);
  open.player.x = 17 * TILE_SIZE + TILE_SIZE / 2;
  open.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
  open.player.stack = ['fire', 'water', 'wind'];
  update(open, DT, { ...idle, attack: true });
  check('в зале вспышка безопасна для своего', open.player.alive);
}

/* --- E7. Цена очереди в числах --- */
{
  /*
   * Оружия у игрока нет, поэтому короткий ответ — одиночный плевок.
   * Правило, которое проверяется: на одиночной цели плевок быстрее, на
   * толпе окупается длинная очередь. Иначе одна из двух половин механики
   * лишняя, и на глаз это не видно — играется бодро и так.
   */
  const clearTime = (count, style) => {
    const world = createWorld(CAMPAIGN[0]);
    const player = world.player;
    const marked = [];

    for (const enemy of world.enemies) enemy.alive = false;
    for (let i = 0; i < count; i += 1) {
      const enemy = world.enemies[i];
      const angle = -Math.PI / 2 + (i - (count - 1) / 2) * 0.5;
      enemy.alive = true;
      enemy.downed = 9999;      /* обездвижены: меряем цену форм, а не бой */
      enemy.shield = null;
      enemy.x = player.x + Math.cos(angle) * 40;
      enemy.y = player.y + Math.sin(angle) * 40;
      marked.push(enemy);
    }

    const queue = style === 'nova' ? ['fire', 'water', 'wind'] : ['fire'];
    let t = 0;

    while (t < 10 && marked.some((e) => e.alive)) {
      const target = marked.find((e) => e.alive);
      const intent = {
        ...idle,
        aimAngle: Math.atan2(target.y - player.y, target.x - player.x),
      };

      if (player.stack.length === queue.length) intent.attack = true;
      else if (player.chargeLeft <= 0) intent.charge = queue[player.stack.length];

      update(world, DT, intent);
      t += DT;
    }

    return marked.some((e) => e.alive) ? Infinity : t;
  };

  const oneSpit = clearTime(1, 'spit');
  const oneNova = clearTime(1, 'nova');
  check('на одной цели плевок быстрее вспышки', oneSpit < oneNova,
    `${oneSpit.toFixed(2)} против ${oneNova.toFixed(2)}`);

  const crowdSpit = clearTime(5, 'spit');
  const crowdNova = clearTime(5, 'nova');
  check('на толпе длинная очередь окупается', crowdNova < crowdSpit,
    `${crowdNova.toFixed(2)} против ${crowdSpit.toFixed(2)}`);
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
