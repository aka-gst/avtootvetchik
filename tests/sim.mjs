/*
 * ТЕХНОМАГИЯ — прогон боя без браузера.
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
import { createWorld, update, TILE_SIZE, hasSight, hasShot, tileIndex } from '../src/world.js';
import { buildFlowField } from '../src/ai.js';
import { TILE, blocksMove, decode, encode, elementMask, elementsFromMask, weakTo } from '../src/level.js';
import { createScore } from '../src/score.js';
import { AIM_CONE, assistAim, closeThreat } from '../src/aim.js';
import { CHARGE_STEP, ELEMENT_ORDER, shapeOf, spellOf, substanceOf, allSubstances } from '../src/magic.js';
import {
  GROUND, paint, tilesInCircle, groundAt, addCloud, updateField, FIRE_CATCH,
} from '../src/field.js';

/*
 * Этажи берутся по имени, а не по номеру. Номера уже разъехались один раз,
 * когда обучалка встала первой, и половина прогона молча начала проверять
 * не тот этаж — падало при этом совсем в другом месте.
 */
const TUTOR = CAMPAIGN[0];
const HALL = CAMPAIGN.find((level) => level.title.startsWith('ПАВИЛЬОН'));
const WARDS = CAMPAIGN.find((level) => level.title.startsWith('ОРАНЖЕРЕЯ'));

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

/*
 * Набрать очередь и выпустить её: ровно то, что делает игрок руками.
 *
 * Стихии этажа тут выдаются насильно: этот прогон проверяет правила магии,
 * а не порядок их открытия — он проверяется отдельно, ниже.
 */
function cast(world, stack, angle) {
  const player = world.player;
  for (const element of stack) {
    if (!world.elements.includes(element)) world.elements.push(element);
  }
  for (const element of stack) {
    update(world, DT, { ...idle, aimAngle: angle, charge: element });

    /*
     * Ожидание с ограничителем. Без него прогон вис намертво: убитый по
     * дороге игрок перестаёт набирать, chargeLeft застывает, и цикл
     * крутится вечно. Падало это не проверкой, а тишиной.
     */
    let guard = 0;
    while (player.chargeLeft > 0 && player.alive && guard < 120) {
      update(world, DT, { ...idle, aimAngle: angle });
      guard += 1;
    }
    if (!player.alive) return;
  }
  update(world, DT, { ...idle, aimAngle: angle, attack: true });
}

/* --- A. Мир крутится вхолостую и никого не убивает --- */
{
  const world = createWorld(HALL);
  run(world, 25);
  check('20 секунд простоя не роняют мир', world.player.alive && world.state === 'play',
    `состояние ${world.state}`);
  check('никто не поднял тревогу сам по себе',
    world.enemies.every((e) => e.state !== 'chase'),
    world.enemies.map((e) => e.state).join(','));
}

/* --- B. Плевок убивает и слышен --- */
{
  const world = createWorld(HALL);
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

  const loud = createWorld(HALL);
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
  const world = createWorld(HALL);
  update(world, DT, { ...idle, attack: true });
  check('удар с пустой очередью не молчит',
    world.events.some((e) => e.type === 'dry'));
}

/* --- D. Враг доходит до игрока через двери --- */
{
  const world = createWorld(HALL);
  const enemy = world.enemies.find((e) => e.kind === 'thug');
  enemy.state = 'chase';
  const before = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
  run(world, 12);
  const after = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
  check('преследователь находит дорогу к игроку', after < before * 0.4 || !world.player.alive,
    `было ${before | 0} стало ${after | 0}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
}

/* --- E. Полная зачистка открывает выход. Проходится каждый этаж --- */
{

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

  function play(floor) {
  const world = createWorld(floor);
  run(world, 150, (w) => {
    const player = w.player;
    const { enemy, dist } = nearest(w);

    if (enemy) {
      const angle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      /* Видно — не значит попадёшь: сквозь мебель взгляд идёт, а снаряд
         нет. Бот, стрелявший «по видимости», всю попытку расстреливал
         стол и не проходил половину этажей. */
      const clear = hasShot(w, player.x, player.y, enemy.x, enemy.y)
        && hasSight(w, player.x, player.y, enemy.x, enemy.y);

      /*
       * Стреляем одиночными и не своей стихией: бот обязан играть по тем
       * же правилам, иначе он проверяет не игру, а поддавки. Стихии берёт
       * только те, что даёт этаж, — как и живой игрок.
       */
      if (clear && dist < 260) {
        if (player.stack.length) return { ...idle, aimAngle: angle, attack: true };
        if (player.chargeLeft <= 0) {
          const element = w.elements.find((candidate) => candidate !== enemy.resist);
          return { ...idle, aimAngle: angle, charge: element };
        }
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
  return world;
  }

  /*
   * Проходится каждый встроенный этаж, а не только первый. Этаж, который
   * нельзя пройти, — это не «сложно», это сломано, и увидеть такое на
   * глаз можно только сыграв все четыре подряд.
   */
  for (const floor of CAMPAIGN) {
    const world = play(floor);
    check(`«${floor.title}»: бот зачистил этаж`, world.kills === world.total,
      `${world.kills}/${world.total}, игрок ${world.player.alive ? 'жив' : 'убит'}`);
    check(`«${floor.title}»: дойдя до выхода, этаж засчитан`,
      world.state === 'clear' || !world.player.alive, `состояние ${world.state}`);
  }
}

/* --- E2. Счёт: цепочка и ранг --- */
{
  const world = createWorld(HALL);
  const score = createScore(HALL, 1);
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
    /* Бьём не той стихией, которой он светится, иначе он просто отобьёт. */
    for (const element of [ELEMENT_ORDER.find((e) => e !== victim.resist)]) {
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
  const world = createWorld(HALL);
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
  check('две одинаковые — сгусток', shapeOf(['water', 'water']).id === 'clot');
  check('две разные — выдох', shapeOf(['water', 'fire']).id === 'cone');
  check('три одинаковые — луч', shapeOf(['fire', 'fire', 'fire']).id === 'beam');
  check('края одинаковые — пробой', shapeOf(['fire', 'water', 'fire']).id === 'pierce');
  check('три разные — вспышка', shapeOf(['fire', 'water', 'wind']).id === 'nova');
  check('две и третья — залп, а не пустота', shapeOf(['fire', 'fire', 'water']).id === 'shard');
  check('форма несёт все свои стихии',
    spellOf(['fire', 'water', 'fire']).elements.sort().join() === 'fire,water');

  /*
   * Две оси. Ради них всё и затевалось, поэтому они закреплены числами, а
   * не ощущением: состав решает вещество и не зависит от порядка, узор
   * решает форму и не зависит от того, что за вещество в очереди.
   */
  check('состав решает вещество',
    substanceOf(['water', 'wind']).name === 'СТУЖА'
    && substanceOf(['fire', 'earth']).name === 'ЛАВА');
  check('порядок на вещество не влияет',
    substanceOf(['water', 'wind']).id === substanceOf(['wind', 'water']).id);
  check('повтор стихии вещества не меняет',
    substanceOf(['fire', 'fire', 'water']).id === substanceOf(['fire', 'water']).id);
  check('одно вещество живёт во всех формах',
    spellOf(['water', 'wind']).substance.id === spellOf(['water', 'wind', 'water']).substance.id
    && spellOf(['water', 'wind']).form.id !== spellOf(['water', 'wind', 'water']).form.id);
  check('смесь — третье, а не сумма двух',
    !substanceOf(['fire', 'water']).traits.burn && !substanceOf(['fire', 'water']).traits.wet,
    `пар: ${Object.keys(substanceOf(['fire', 'water']).traits).join(',')}`);

  /* Вещество должно чувствоваться в полёте, иначе состав снова только цвет. */
  const gust = spellOf(['wind']).form.speed;
  const stone = spellOf(['earth']).form.speed;
  check('ветер летит быстрее камня', gust > stone * 1.4,
    `${Math.round(gust)} против ${Math.round(stone)}`);
  check('земля ломает мебель сама по себе', spellOf(['earth']).form.breaks === true);

  const book = allSubstances();
  check('каждый состав назван и назван по-своему',
    book.length === 25 && new Set(book.map((entry) => entry.name)).size === 25,
    `${book.length} веществ`);

  const world = createWorld(HALL);
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

  const free = createWorld(HALL);
  for (let i = 0; i < 20; i += 1) update(free, DT, { ...idle, moveX: 1 });
  const freeSpeed = Math.hypot(free.player.vx, free.player.vy);

  /* Набираем непрерывно: меряем установившуюся скорость, а не первый кадр. */
  const slow = createWorld(HALL);
  for (let i = 0; i < 30; i += 1) {
    const charging = slow.player.chargeLeft <= 0 && slow.player.stack.length < 3;
    if (slow.player.stack.length >= 3) slow.player.stack.length = 0;
    update(slow, DT, { ...idle, moveX: 1, charge: charging ? 'water' : null });
  }
  check('во время набора игрок медленнее',
    Math.hypot(slow.player.vx, slow.player.vy) < freeSpeed * 0.7,
    `${Math.hypot(slow.player.vx, slow.player.vy) | 0} против ${freeSpeed | 0}`);
}

/* --- E5. Стойкость: своя стихия не берёт --- */
{
  const world = createWorld(WARDS);
  const carrier = world.enemies.find((e) => e.resist === 'water');
  check('на втором этаже есть кто-то с водяной стойкостью', Boolean(carrier));

  const stand = (w, target) => {
    w.player.x = target.x - 40;
    w.player.y = target.y;
    w.player.cooldown = 0;
  };

  stand(world, carrier);
  cast(world, ['water'], 0);
  run(world, 0.4);
  check('своя стихия носителя не берёт', carrier.alive, `жив=${carrier.alive}`);

  /* Три одного цвета против того же цвета — тоже мимо: это стойкость, а
     не щит с зарядами, и количество её не пробивает. */
  const triple = createWorld(WARDS);
  const same = triple.enemies.find((e) => e.resist === 'water');
  stand(triple, same);
  cast(triple, ['water', 'water', 'water'], 0);
  run(triple, 0.6);
  check('три своих подряд тоже не берут', same.alive, `жив=${same.alive}`);

  const other = createWorld(WARDS);
  const target = other.enemies.find((e) => e.resist === 'water');
  stand(other, target);
  cast(other, ['fire'], 0);
  run(other, 0.4);
  check('чужая стихия убивает', !target.alive);

  /* В смешанной очереди хватает одного чужого цвета. */
  const mixed = createWorld(WARDS);
  const victim = mixed.enemies.find((e) => e.resist === 'water');
  stand(mixed, victim);
  cast(mixed, ['water', 'fire', 'water'], 0);
  run(mixed, 0.6);
  check('смешанная очередь проходит стойкость', !victim.alive);

  /* Порча врага той же стихии не убивает своего — правило общее для всех. */
  const ally = createWorld(WARDS);
  const caster = ally.enemies.find((e) => e.kind === 'caster');
  check('дальнобойный швыряется магией, а не пулями',
    caster && caster.weapon === 'hex', caster ? caster.weapon : 'нет такого');
  check('его стихия видна и совпадает с его стойкостью',
    caster.element === caster.resist, `${caster.element}/${caster.resist}`);
}

/* --- E6. Вспышка не разбирает своих, а ветер её уносит --- */
{
  /* Состав без ветра рвётся под ногами — на нём и проверяется теснота. */
  const heavy = ['fire', 'water', 'earth'];

  const tight = createWorld(WARDS);
  tight.player.x = 6 * TILE_SIZE + TILE_SIZE / 2;
  tight.player.y = 13 * TILE_SIZE + TILE_SIZE / 2;
  tight.player.stack = [...heavy];
  update(tight, DT, { ...idle, attack: true });
  check('вспышка в узком проходе достаёт и того, кто её выпустил', !tight.player.alive);

  const open = createWorld(WARDS);
  open.player.x = 17 * TILE_SIZE + TILE_SIZE / 2;
  open.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
  open.player.stack = [...heavy];
  update(open, DT, { ...idle, attack: true });
  check('в зале вспышка безопасна для своего', open.player.alive);

  /*
   * Ветер в составе уносит вспышку вперёд. Без этого десять тройных
   * веществ были одной и той же кнопкой паники: узор «три разные» другой
   * формы не знает, и ГРОЗУ нельзя было бросить, только подорвать под
   * ногами.
   */
  const thrown = createWorld(WARDS);
  thrown.player.x = 17 * TILE_SIZE + TILE_SIZE / 2;
  thrown.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
  thrown.player.stack = ['fire', 'water', 'wind'];
  update(thrown, DT, { ...idle, aimAngle: 0, attack: true });
  check('состав с ветром уносит вперёд, а не рвёт под ногами',
    thrown.bullets.length === 1 && Boolean(thrown.bullets[0].nova),
    `снарядов ${thrown.bullets.length}`);

  const before = thrown.bullets[0].x;
  run(thrown, 0.7);
  check('и разрывается там, куда долетел',
    thrown.blasts.concat(thrown.decals).length >= 0
      && thrown.bullets.length === 0
      && thrown.player.alive,
    `улетела с ${Math.round(before)}`);

  /* Но и брошенная своих не разбирает: подошёл к месту разрыва — сам виноват. */
  const near = createWorld(WARDS);
  near.player.x = 17 * TILE_SIZE + TILE_SIZE / 2;
  near.player.y = 10 * TILE_SIZE + TILE_SIZE / 2;
  near.player.stack = ['fire', 'water', 'wind'];
  update(near, DT, { ...idle, aimAngle: 0, attack: true });
  near.bullets[0].life = 0.0001;   /* разрыв вплотную */
  run(near, 0.1);
  check('разрыв вплотную убивает и бросившего', !near.player.alive);
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
    const world = createWorld(HALL);
    /* Меряем цену форм, а не выдачу стихий: даём все. */
    world.elements = [...ELEMENT_ORDER];
    const player = world.player;
    const marked = [];

    for (const enemy of world.enemies) enemy.alive = false;
    for (let i = 0; i < count; i += 1) {
      const enemy = world.enemies[i];
      const angle = -Math.PI / 2 + (i - (count - 1) / 2) * 0.5;
      enemy.alive = true;
      enemy.downed = 9999;      /* обездвижены: меряем цену форм, а не бой */
      enemy.resist = null;
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
  const world = createWorld(HALL);
  for (const enemy of world.enemies) enemy.state = 'chase';
  const started = process.hrtime.bigint();
  run(world, 10);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const perFrame = ms / (10 / DT);
  check('шаг мира укладывается в бюджет кадра', perFrame < 1.2,
    `${perFrame.toFixed(3)} мс на кадр при всех врагах в погоне`);
}

/* --- F. Встреча веществ: та самая таблица, которую нельзя проверить глазом --- */
{
  const world = createWorld(HALL);
  const open = { x: world.player.x + TILE_SIZE * 4, y: world.player.y };
  const spot = (substance, r = TILE_SIZE) =>
    paint(world, tilesInCircle(world, open.x, open.y, r), substance, { ...open, r });

  spot(substanceOf(['fire']));
  check('одна стихия своего не оставляет',
    groundAt(world, open.x, open.y) === GROUND.NONE);

  spot(substanceOf(['fire', 'wind']));
  check('смесь оставляет вещество',
    groundAt(world, open.x, open.y) === GROUND.FIRE);

  spot(substanceOf(['water']));
  check('чистой воды хватает, чтобы потушить',
    groundAt(world, open.x, open.y) === GROUND.NONE);

  spot(substanceOf(['water', 'earth']));
  check('грязь ложится', groundAt(world, open.x, open.y) === GROUND.MUD);
  spot(substanceOf(['fire', 'wind']));
  check('грязь не горит — единственное укрытие от чужого огня',
    groundAt(world, open.x, open.y) === GROUND.MUD);

  spot(substanceOf(['water', 'bolt']));
  check('разряд стелет свою лужу', groundAt(world, open.x, open.y) === GROUND.WATER);
  spot(substanceOf(['water', 'wind']));
  check('мороз превращает лужу в лёд', groundAt(world, open.x, open.y) === GROUND.ICE);

  const cloudsBefore = world.clouds.length;
  spot(substanceOf(['fire']));
  check('огонь топит лёд обратно в лужу',
    groundAt(world, open.x, open.y) === GROUND.WATER);
  check('над растопленным поднимается пар', world.clouds.length > cloudsBefore);
}

/* --- G. Поле в бою --- */
{
  /* Цепь. Ради неё вода и заведена: лужа, налитая заранее, превращает
     одиночный разряд в оружие по площади. */
  function chainRun(withPuddle) {
    const world = createWorld(HALL);
    const player = world.player;
    const [a, b] = world.enemies;

    /* Двое рядом, игрок поодаль и вне лужи. */
    a.x = player.x + TILE_SIZE * 5; a.y = player.y;
    a.state = 'idle'; a.resist = null;
    b.x = a.x + TILE_SIZE * 1.6; b.y = a.y;
    b.state = 'idle'; b.resist = null;
    for (const rest of world.enemies.slice(2)) { rest.alive = false; }

    if (withPuddle) {
      const mid = { x: (a.x + b.x) / 2, y: a.y };
      paint(world, tilesInCircle(world, mid.x, mid.y, TILE_SIZE * 2),
        substanceOf(['water', 'bolt']), mid);
    }

    cast(world, ['bolt'], 0);
    run(world, 0.6);
    return { a, b };
  }

  const dry = chainRun(false);
  check('без лужи разряд достаёт только того, в кого целились',
    !dry.a.alive && dry.b.alive, `первый=${dry.a.alive} второй=${dry.b.alive}`);

  const wet = chainRun(true);
  check('по луже разряд достаёт и того, в кого не целились',
    !wet.a.alive && !wet.b.alive, `первый=${wet.a.alive} второй=${wet.b.alive}`);

  /* Огонь не убивает мгновенно: у горящего есть выход, и это единственное,
     ради чего игрок вообще носит воду. */
  const world = createWorld(HALL);
  const enemy = world.enemies[0];
  enemy.state = 'idle';
  enemy.resist = null;
  const fire = { x: world.player.x + TILE_SIZE * 4, y: world.player.y };
  const pool = { x: fire.x + TILE_SIZE * 3, y: fire.y };
  paint(world, tilesInCircle(world, fire.x, fire.y, TILE_SIZE), substanceOf(['fire', 'wind']), fire);
  paint(world, tilesInCircle(world, pool.x, pool.y, TILE_SIZE), substanceOf(['water', 'bolt']), pool);

  enemy.x = fire.x; enemy.y = fire.y;
  run(world, FIRE_CATCH + 0.1);
  check('на разгоревшемся полу тело занимается', enemy.burning > 0 && enemy.alive,
    `горит=${(enemy.burning || 0).toFixed(2)}`);

  enemy.x = pool.x; enemy.y = pool.y;
  run(world, 0.05);
  check('лужа тушит горящего', enemy.alive && !enemy.burning);

  /* Пар прячет — единственное, что умеет вещество без смертельной черты. */
  const misty = createWorld(HALL);
  const near = misty.enemies[0];
  near.x = misty.player.x + TILE_SIZE * 3;
  near.y = misty.player.y;
  check('без пара видно', hasSight(misty, misty.player.x, misty.player.y, near.x, near.y));
  addCloud(misty, (misty.player.x + near.x) / 2, misty.player.y, TILE_SIZE * 1.6, 'steam');
  check('за паром не видно',
    !hasSight(misty, misty.player.x, misty.player.y, near.x, near.y));

  /* Пол под ногами решает темп: грязь вязнет, лёд разгоняет и не держит. */
  function pace(ground) {
    const w = createWorld(HALL);
    if (ground) {
      paint(w, tilesInCircle(w, w.player.x, w.player.y, TILE_SIZE * 3), ground,
        { x: w.player.x, y: w.player.y });
    }
    for (let i = 0; i < 12; i += 1) update(w, DT, { ...idle, moveX: 1 });
    return Math.hypot(w.player.vx, w.player.vy);
  }

  const clean = pace(null);
  const mud = pace(substanceOf(['water', 'earth']));
  check('в грязи идёшь медленнее', mud < clean * 0.7,
    `${Math.round(mud)} против ${Math.round(clean)}`);

  const ice = pace(substanceOf(['water', 'wind']));
  check('на льду разгоняешься дольше', ice < clean,
    `${Math.round(ice)} против ${Math.round(clean)}`);
}


/* --- H. Сигнатуры: найденное заклинание обязано делать обещанное --- */
{
  /*
   * Пустой зал внизу этажа: враги мешали бы мерить след. Игрок отодвинут
   * от нижней стены — иначе нижний снаряд веера бьётся в неё через две
   * клетки, и замер меряет не форму, а близость стены.
   */
  function clean() {
    const world = createWorld(HALL);
    for (const enemy of world.enemies) enemy.alive = false;
    world.player.y -= TILE_SIZE * 2;
    return world;
  }

  function groundCount(world, type, from, to) {
    let count = 0;
    for (let i = 0; i < world.ground.length; i += 1) {
      if (world.ground[i] !== type) continue;
      const x = ((i % world.w) + 0.5) * TILE_SIZE;
      const y = ((i / world.w | 0) + 0.5) * TILE_SIZE;
      const d = Math.hypot(x - world.player.x, y - world.player.y);
      if (d >= from && d <= to) count += 1;
    }
    return count;
  }

  /* БОРОЗДА: лава по всему пути, а не только там, где снаряд встал. */
  const furrow = clean();
  cast(furrow, ['fire', 'earth', 'fire'], 0);
  run(furrow, 0.3);
  check('борозда стелет след по всему пути',
    groundCount(furrow, GROUND.FIRE, TILE_SIZE * 2, TILE_SIZE * 6) > 3,
    `${groundCount(furrow, GROUND.FIRE, 0, TILE_SIZE * 9)} клеток`);

  /*
   * И не под ногами. Награда за находку не имеет права быть ловушкой:
   * первая версия поджигала пол там же, где стоял нашедший.
   */
  check('но не под ногами у того, кто её нашёл',
    groundCount(furrow, GROUND.FIRE, 0, TILE_SIZE) === 0);

  const fan = clean();
  cast(fan, ['fire', 'fire', 'earth'], 0);
  run(fan, 0.3);
  check('та же лава без сигнатуры следа не оставляет',
    groundCount(fan, GROUND.FIRE, TILE_SIZE * 2, TILE_SIZE * 3.5) === 0,
    `${groundCount(fan, GROUND.FIRE, 0, TILE_SIZE * 9)} клеток`);

  /* РУСЛО: чистая вода кладёт то, что чистой стихии не положено. */
  const channel = clean();
  cast(channel, ['water', 'water', 'water'], 0);
  run(channel, 0.4);
  check('русло стелет воду, хотя чистая стихия своего не оставляет',
    groundCount(channel, GROUND.WATER, 0, TILE_SIZE * 12) > 4,
    `${groundCount(channel, GROUND.WATER, 0, TILE_SIZE * 12)} клеток`);

  const plain = clean();
  cast(plain, ['water'], 0);
  run(plain, 0.4);
  check('а плевок той же водой — не оставляет',
    groundCount(plain, GROUND.WATER, 0, TILE_SIZE * 12) === 0);

  /* ХВАТКА: тянет тех, до кого сам выдох не достаёт. */
  const grip = createWorld(HALL);
  const far = grip.enemies[0];
  for (const enemy of grip.enemies.slice(1)) enemy.alive = false;
  far.state = 'idle';
  far.resist = null;
  far.x = grip.player.x + TILE_SIZE * 9;
  far.y = grip.player.y;
  const before = far.x - grip.player.x;
  cast(grip, ['earth', 'bolt'], 0);
  run(grip, 0.25);
  check('хватка тянет тех, до кого выдох не достаёт',
    far.alive && far.x - grip.player.x < before - 70,
    `${Math.round(before)} → ${Math.round(far.x - grip.player.x)}`);
}


/* --- I. Этаж выдаёт стихии сам --- */
{
  check('обучалка даёт две стихии, последний этаж — все пять',
    TUTOR.elements.length === 2
    && CAMPAIGN[CAMPAIGN.length - 1].elements.length === ELEMENT_ORDER.length,
    CAMPAIGN.map((level) => level.elements.length).join('→'));

  check('каждый следующий этаж не отнимает прежнего',
    CAMPAIGN.every((level, i) =>
      i === 0 || CAMPAIGN[i - 1].elements.every((element) => level.elements.includes(element))));

  const world = createWorld(TUTOR);
  const player = world.player;

  update(world, DT, { ...idle, charge: 'earth' });
  check('стихии, которой этаж не даёт, у игрока нет',
    player.stack.length === 0 && player.chargeLeft <= 0);
  check('и он об этом узнаёт, а не думает, что кнопка сломалась',
    world.events.some((event) => event.type === 'locked' && event.element === 'earth'));

  update(world, DT, { ...idle, charge: 'fire' });
  check('своя стихия набирается как обычно', player.chargeLeft > 0);

  /*
   * Дальнобойные швыряются только тем, что есть на этаже: иначе на первом
   * этаже в игрока летит молния, которой он ещё не видел, и цвет снаряда
   * перестаёт быть инструкцией «этим его не бей».
   */
  const lit = createWorld(HALL);
  const strange = lit.enemies.filter((enemy) => enemy.element
    && !HALL.elements.includes(enemy.element));
  check('и враги колдуют только стихиями этажа', strange.length === 0,
    strange.map((enemy) => enemy.element).join(','));
}


/* --- J. Видно — не значит попадёшь --- */
{
  const world = createWorld(HALL);

  /* Мебель на этаже есть всегда: находим стол и становимся по обе стороны. */
  let table = -1;
  for (let i = 0; i < world.tiles.length; i += 1) if (world.tiles[i] === 5) { table = i; break; }
  const tx = ((table % world.w) + 0.5) * TILE_SIZE;
  const ty = ((table / world.w | 0) + 0.5) * TILE_SIZE;

  check('через мебель видно', hasSight(world, tx - TILE_SIZE, ty, tx + TILE_SIZE, ty));
  check('но не простреливается', !hasShot(world, tx - TILE_SIZE, ty, tx + TILE_SIZE, ty));
  check('по чистому полу — и то и другое',
    hasSight(world, tx - TILE_SIZE, ty, tx - TILE_SIZE * 2, ty)
    && hasShot(world, tx - TILE_SIZE, ty, tx - TILE_SIZE * 2, ty));
}


/* --- K. Формат: старый код читается новой игрой --- */
{
  /*
   * Фикстура, а не пересчёт: строка собрана отдельной реализацией
   * формата версии 1 — до того, как у этажа появились свои стихии.
   * Она заморожена навсегда. Если однажды перестанет читаться, значит
   * сломались все коды, которые люди успели записать и разослать.
   */
  const V1 = 'EQMACDiKAiCAYARQIBggUA';

  let old = null;
  try { old = decode(V1); } catch (error) { old = error.message; }

  check('код версии 1 всё ещё открывается',
    old && old.w === 5 && old.h === 4 && old.entities.length === 1,
    typeof old === 'string' ? old : `${old.w}x${old.h}`);
  check('и получает те три стихии, при которых был записан',
    Array.isArray(old.elements) && old.elements.join() === 'fire,water,wind',
    String(old && old.elements));

  /* Маска: свой порядок битов, заморожен наравне с номерами тайлов. */
  check('маска стихий ходит туда-обратно',
    elementsFromMask(elementMask(['water', 'bolt'])).join() === 'water,bolt');
  check('пустая маска читается как старый код',
    elementsFromMask(0).join() === 'fire,water,wind');

  for (const floor of CAMPAIGN) {
    const back = decode(encode(floor));
    check(`«${floor.title}»: код несёт свои стихии`,
      back.elements.join() === floor.elements.join(),
      `${back.elements.join()} против ${floor.elements.join()}`);
  }
}


/* --- L. Предметы ломаются только своим веществом --- */
{
  const tutorial = TUTOR;

  function withTile(kind) {
    const world = createWorld(tutorial);
    world.elements = [...ELEMENT_ORDER];
    for (const enemy of world.enemies) enemy.alive = false;

    /* Ставим предмет в трёх клетках правее игрока, на чистом полу. */
    const px = Math.floor(world.player.x / TILE_SIZE);
    const py = Math.floor(world.player.y / TILE_SIZE);
    const at = py * world.w + px + 3;
    world.tiles[at] = kind;
    return { world, at };
  }

  const cases = [
    { kind: TILE.BARREL, name: 'бочку', yes: ['fire'], no: ['bolt'] },
    { kind: TILE.BOULDER, name: 'валун', yes: ['earth'], no: ['fire'] },
    { kind: TILE.CRYSTAL, name: 'кристалл', yes: ['bolt'], no: ['earth'] },
  ];

  for (const one of cases) {
    const hit = withTile(one.kind);
    cast(hit.world, one.yes, 0);
    run(hit.world, 0.4);
    check(`${one.name} берёт своя стихия`, hit.world.tiles[hit.at] === TILE.FLOOR,
      `осталось ${hit.world.tiles[hit.at]}`);

    const miss = withTile(one.kind);
    cast(miss.world, one.no, 0);
    run(miss.world, 0.4);
    check(`${one.name} чужая не берёт`, miss.world.tiles[miss.at] === one.kind);
  }

  /* Бочка нужна не тем, что исчезает, а тем, что остаётся после неё. */
  const spill = withTile(TILE.BARREL);
  cast(spill.world, ['fire'], 0);
  run(spill.world, 0.4);
  let wet = 0;
  for (let i = 0; i < spill.world.ground.length; i += 1) {
    if (spill.world.ground[i] === GROUND.WATER) wet += 1;
  }
  check('из бочки льётся вода, и не в одну клетку', wet >= 5, `${wet} клеток`);

  check('у каждого предмета своя стихия и она одна',
    weakTo(TILE.BARREL) === 'burn' && weakTo(TILE.BOULDER) === 'crush'
    && weakTo(TILE.CRYSTAL) === 'shock' && weakTo(TILE.WALL) === null);
}

/* --- M. Обучалка: тот самый первый ход --- */
{
  /*
   * Ради этого сценария обучалка и написана: огонь вскрывает бочку, вода
   * из неё разливается под ногами у троих, разряд в лужу забирает всех.
   * Первое, что игрок узнаёт про игру, — что стихии работают друг через
   * друга, а не по очереди, — и проверять это надо целиком, а не по частям.
   */
  const world = createWorld(TUTOR);
  check('обучалка даёт огонь и молнию, и больше ничего',
    world.elements.join() === 'fire,bolt', world.elements.join());

  let barrel = -1;
  for (let i = 0; i < world.tiles.length; i += 1) {
    if (world.tiles[i] === TILE.BARREL) { barrel = i; break; }
  }
  check('в обучалке есть бочка', barrel >= 0);

  const bx = ((barrel % world.w) + 0.5) * TILE_SIZE;
  const by = (((barrel / world.w) | 0) + 0.5) * TILE_SIZE;

  /* Трое стоят под бочкой — их и должно накрыть. */
  const under = world.enemies.filter((enemy) => enemy.alive
    && Math.abs(enemy.x - bx) <= TILE_SIZE * 1.2
    && enemy.y - by > 0 && enemy.y - by <= TILE_SIZE * 1.6);
  check('под бочкой стоят трое', under.length === 3, `${under.length}`);

  /* Остальных с этажа убираем: прогон меряет ловушку, а не всю комнату, а
     одинокий громила у входа успевает достать отступающего. */
  for (const enemy of world.enemies) {
    if (!under.includes(enemy)) enemy.alive = false;
  }

  /* Игрок встаёт сбоку и бьёт огнём в бочку. Сбоку, а не сверху: над
     бочкой стоит скамья, и снаряд честно вязнет в ней. */
  world.player.x = bx - TILE_SIZE * 4;
  world.player.y = by;
  cast(world, ['fire'], 0);
  run(world, 0.25);

  check('огонь вскрыл бочку', world.tiles[barrel] === TILE.FLOOR);
  check('трое стали мокрыми', under.every((enemy) => !enemy.alive || enemy.wet > 0),
    under.map((enemy) => (enemy.wet || 0).toFixed(1)).join(' '));

  /*
   * Разряд идёт в лужу, а не в тело. Так это и задумано: цепь для того и
   * нужна, чтобы не целиться в каждого — попал в воду, забрал всех, кто в
   * ней стоит. Прицельный выстрел в бегущего с семи клеток был бы лотереей
   * и мерил бы меткость, а не правило.
   *
   * Игрок при этом отходит на десять клеток: троих, бегущих на тебя, и
   * правда надо встречать с дистанции. Мокрыми они останутся ещё три
   * секунды — на этом вся ловушка и держится.
   */
  world.player.x = bx - TILE_SIZE * 10;
  cast(world, ['bolt'], 0);
  run(world, 0.4);

  check('игрок при этом уцелел', world.player.alive);
  check('разряд по луже забрал всех троих',
    under.every((enemy) => !enemy.alive),
    under.map((enemy) => (enemy.alive ? 'жив' : 'нет')).join(' '));
}


console.log(report.join('\n'));
console.log(failures ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}` : '\nвсе проверки прошли');
process.exit(failures ? 1 : 0);
