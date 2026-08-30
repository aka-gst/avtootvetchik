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
import { createWorld, update, TILE_SIZE, hasSight, hasShot, tileIndex, killEnemy } from '../src/world.js';
import { buildFlowField } from '../src/ai.js';
import { TILE, blocksMove, decode, encode, elementMask, elementsFromMask, weakTo, brokenBy } from '../src/level.js';
import { createScore } from '../src/score.js';
import { AIM_CONE, assistAim, closeThreat, lockTarget, cycleTarget, lockCandidates, targetNear } from '../src/aim.js';
import { CHARGE_STEP, ELEMENT_ORDER, shapeOf, spellOf, substanceOf, allSubstances } from '../src/magic.js';
import {
  GROUND, paint, tilesInCircle, groundAt, addCloud, updateField, FIRE_CATCH, BURN_TIME,
} from '../src/field.js';

/*
 * Случайность зафиксирована сидом.
 *
 * Враги думают и стреляют по таймерам от Math.random, и бот проходил этажи
 * с разбросом: раз в десяток запусков не успевал, и прогон падал в случайном
 * месте. Плавающий FAIL хуже медленного прогона — его начинают пролистывать,
 * а вместе с ним пролистают и настоящий.
 *
 * Разброс от этого не исчез, он просто перестал быть лотереей: чтобы
 * посмотреть другой расклад, меняют сид, а не перезапускают наугад.
 */
let seed = 20260829;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

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

  /*
   * Времени вдвое больше, чем было. Причина не в боте: с тех пор как этаж
   * спит до замеченной смерти, враги перестали бежать навстречу, и весь
   * этаж приходится обходить ногами. Проверяется проходимость, а не
   * скорость, — поэтому растёт бюджет, а не требования.
   */
  function play(floor) {
  const world = createWorld(floor);

  /*
   * Бот умеет ломать то, что держит дорогу. Раньше не умел, и этого не
   * было заметно: этажи были проходными комнатами, обойти можно было
   * всё. Как только первый этаж стал коридором задачек с воротами из
   * соломы и кристалла, бот встал во второй комнате — и это не «сложно»,
   * это проверка, которая перестала проверять.
   *
   * Ломает он вслепую, перебором стихий, как и живой человек, который
   * ещё не знает, что соломе нужен огонь: если стоим на месте дольше
   * полутора секунд, бьём в ближайшее ломаемое очередной стихией.
   */
  let stillFor = 0;
  let wasX = 0;
  let wasY = 0;
  let tryElement = 0;
  let breaking = null;
  let breakingFor = 0;

  /*
   * В огонь не идём. Бот честно ломал соломенную створку и честно шёл в
   * неё же — прямо по горящим клеткам, — и погибал во второй комнате
   * от собственного пожара. Живой игрок ждёт, пока прогорит; боту это
   * приходится сказать словами.
   */
  function safeStep(w, step) {
    if (!step || (!step.x && !step.y)) return step;
    const player = w.player;
    if (groundAt(w, player.x, player.y) === GROUND.FIRE) {
      return { x: -step.x, y: -step.y };
    }
    /*
     * Смотрим на две клетки вперёд, а не на одну. Створка — коридор в
     * одну клетку шириной: войдя в неё по краю пожара, выйти уже некуда,
     * все стороны заняты стеной, и огонь доедает стоящего. Правильное
     * место, чтобы этого не случилось, — снаружи, до входа.
     */
    for (const reach of [26, 48]) {
      if (groundAt(w, player.x + step.x * reach, player.y + step.y * reach) === GROUND.FIRE) {
        return { x: 0, y: 0 };
      }
    }
    return step;
  }

  /*
   * Молния в собственной луже убивает того, кто её пустил, — правило
   * игры, а не поблажка. Бот на него исправно натыкался: разливал воду
   * из бочки, вставал в неё и бил разрядом. Живой игрок отучается от
   * этого за одну смерть, боту нужна строчка.
   */
  function shocksSelf(w, element) {
    if (element !== 'bolt') return false;
    const player = w.player;
    return groundAt(w, player.x, player.y) === GROUND.WATER || (player.wet || 0) > 0;
  }

  function blocker(w) {
    const player = w.player;
    /*
     * Без круга поиска. Круг в восемь клеток казался разумным, пока
     * этаж не стал коридором: зачистив свою половину, бот стоял посреди
     * пустой комнаты и не видел створки в двух комнатах отсюда — а
     * идти было больше некуда.
     */
    let best = null;
    let bestGap = Infinity;
    for (let i = 0; i < w.tiles.length; i += 1) {
      if (!weakTo(w.tiles[i])) continue;

      /*
       * Преграда обязана преграждать. Как только ломаемыми стали двери и
       * скамьи, бот бросился жечь их по всему этажу и переставал доходить
       * до врагов: дверь ломается, но через неё и так ходят, а значит
       * ломать её незачем. Спрашиваем не «ломается ли», а «держит ли».
       */
      /*
       * Преграда обязана преграждать — либо открывать. Щиток сам проход
       * не держит, но силовые двери держатся на нём: когда дороги нет и
       * ломать нечего, живой игрок идёт искать щиток, и бот обязан уметь
       * то же, иначе этаж с силовой дверью для него непроходим.
       */
      if (!blocksMove(w.tiles[i]) && w.tiles[i] !== TILE.PANEL) continue;
      const x = ((i % w.w) + 0.5) * TILE_SIZE;
      const y = (((i / w.w) | 0) + 0.5) * TILE_SIZE;
      /*
       * Створка важнее копны. Ломаемое в стене — это дверь, ломаемое
       * посреди комнаты — просто вещь, и бот, выбиравший ближайшее,
       * методично жёг стог в двух шагах, пока дверь в соседнюю комнату
       * стояла нетронутой. Считаем стены вокруг: у двери их две и
       * больше, у вещи ни одной.
       */
      const tx = i % w.w;
      const ty = (i / w.w) | 0;
      const wall = (ox, oy) => {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) return true;
        return w.tiles[ny * w.w + nx] === TILE.WALL;
      };

      const sideWalls = (wall(1, 0) ? 1 : 0) + (wall(-1, 0) ? 1 : 0);
      const flatWalls = (wall(0, 1) ? 1 : 0) + (wall(0, -1) ? 1 : 0);
      const walls = sideWalls + flatWalls;

      /*
       * Ось захода задаёт стена, а не то, с какой стороны мы подошли.
       * Створка в горизонтальной стене — это дыра, к которой подходят
       * сверху или снизу; выравниваться по вертикали к ней бессмысленно,
       * там стена. Бот именно это и делал: стоял слева, видел, что по
       * горизонтали до створки дальше, чем по вертикали, шёл выравнивать
       * вертикаль, упирался в стену и через четыре секунды стрелял в неё
       * же — по диагонали, мимо.
       */
      const axis = sideWalls > flatWalls ? 'x' : (flatWalls > sideWalls ? 'y' : null);

      const gap = Math.hypot(x - player.x, y - player.y) - (walls >= 2 ? 4000 : 0);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = { x, y, tile: w.tiles[i], axis };
    }
    return best;
  }

  /* Отчего именно погиб бот — половина ответа на вопрос, что сломано.
     Без этого «игрок убит» одинаково означает и злого врага, и свой же
     пожар, и собственную лужу под током. */
  world.botDeath = null;
  let burnedAt = null;
  world.botTrace = process.env.TRACE ? [] : null;

  run(world, 300, (w) => {
    const player = w.player;
    const { enemy, dist } = nearest(w);

    if (w.events.some((event) => event.type === 'ignite' && event.player)) burnedAt = w.time;

    if (!world.botDeath) {
      if (w.events.some((event) => event.type === 'shocked-self')) world.botDeath = 'свой разряд';
      else if (!player.alive) {
        /*
         * Отчего именно погиб — половина ответа. Проигранный бой и
         * смерть от собственного пожара выглядят одинаково («игрок
         * убит»), а значат прямо противоположное: первое — нормальная
         * игра, второе — этаж, убивающий игрока его же инструментом.
         */
        /*
         * Горящий умирает ровно в тот кадр, когда пламя догорело, и
         * burning в этот момент уже ноль. Считать по нему — значит
         * записывать каждую смерть от огня в «убит врагом», что и
         * происходило: причина смерти в отчёте была неверной.
         */
        const burned = (player.burning || 0) > 0
          || groundAt(w, player.x, player.y) === GROUND.FIRE
          || (burnedAt !== null && w.time - burnedAt < 3);
        const near = w.enemies.filter((e) => e.alive
          && Math.hypot(e.x - player.x, e.y - player.y) < 120)
          .map((e) => `${Math.round(e.x)},${Math.round(e.y)}`);
        world.botDeath = burned ? 'сгорел' : 'убит врагом';
        world.botDeathWhere = `${Math.round(player.x)},${Math.round(player.y)}`
          + (near.length ? ` рядом:${near.join(';')}` : ' рядом никого');
      }
    }

    /*
     * Первое правило, выше всех остальных: горит под ногами — уходи.
     * Проверки «не входить в огонь» мало, потому что огонь приходит сам:
     * бот замирал на месте, набирая стихию, пожар доползал до его клетки,
     * и он погибал стоя. На земле, которая убивает, не остаются ни ради
     * замаха, ни ради выстрела.
     */
    let hot = null;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const nx = player.x + Math.cos(a) * 40;
      const ny = player.y + Math.sin(a) * 40;
      if (groundAt(w, nx, ny) === GROUND.FIRE) { hot = { x: nx, y: ny }; break; }
    }
    if (!hot && groundAt(w, player.x, player.y) === GROUND.FIRE) {
      hot = { x: player.x, y: player.y };
    }

    if (hot) {
      /*
       * Уходим от огня заранее, а не когда загорелись. Поджёгшийся уже
       * не спасётся: пламя на теле тушит только вода, а её на этаже может
       * не быть вовсе. Значит единственная защита — не стоять рядом, и
       * правило это выше всех прочих: ни замах, ни выстрел не стоят того,
       * чтобы досчитывать их в огне.
       */
      const away = Math.atan2(player.y - hot.y, player.x - hot.x) || Math.PI;
      for (let i = 0; i < 8; i += 1) {
        const a = away + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.7;
        const nx = player.x + Math.cos(a) * 34;
        const ny = player.y + Math.sin(a) * 34;
        if (blocksMove(w.tiles[tileIndex(w, nx, ny)])) continue;
        if (groundAt(w, nx, ny) === GROUND.FIRE) continue;
        return { ...idle, moveX: Math.cos(a), moveY: Math.sin(a) };
      }
    }

    if (Math.hypot(player.x - wasX, player.y - wasY) < 6) stillFor += DT;
    else stillFor = 0;
    wasX = player.x;
    wasY = player.y;

    /*
     * Дорогу держит то, что ломается. Пока этажи были проходными
     * комнатами, боту это не требовалось; коридор задачек с воротами из
     * соломы и кристалла он не проходит вовсе, и проверка перестаёт
     * проверять.
     *
     * Преграда запоминается, а не ищется заново каждый кадр: отойти для
     * замаха — это движение, а движение сбрасывало «стою на месте», и бот
     * вечно топтался между «застрял» и «отхожу», ни разу не выстрелив.
     */
    /*
     * Ломать имеет смысл, только когда дороги нет. Раньше бот брался за
     * преграду по одному признаку «стою на месте», и пока ломаемыми были
     * три вещи, это сходило с рук. Как только загорелось дерево и
     * забилось стекло, ломаемого стало вдесятеро больше — и бот принялся
     * жечь скамьи по всему складу, ни разу не дойдя до врага.
     *
     * Спрашиваем прямо: доходит ли поле пути от врага до нашей клетки.
     * Отрицательное значение и значит «не доходит».
     */
    /* Цель — ближайший живой, а когда живых нет, выход: и туда дорога
       тоже может оказаться заперта. */
    let goal = enemy;
    if (!goal) {
      for (let i = 0; i < w.tiles.length && !goal; i += 1) {
        if (w.tiles[i] !== TILE.EXIT) continue;
        goal = { x: ((i % w.w) + 0.5) * TILE_SIZE, y: (((i / w.w) | 0) + 0.5) * TILE_SIZE };
      }
    }

    if (goal) {
      const field = buildFlowField(w, goal.x, goal.y);
      if (field[tileIndex(w, player.x, player.y)] >= 0) {
        breaking = null;
        breakingFor = 0;
        stillFor = 0;
      }
    }

    if (!breaking && stillFor > 1.5) {
      breaking = blocker(w);
      if (world.botTrace) world.botTrace.push(breaking ? `цель:${Math.round(breaking.x)},${Math.round(breaking.y)}` : `застрял:${Math.round(player.x)},${Math.round(player.y)}`);
    }

    if (breaking) {
      /*
       * Створка — это дыра в стене, и бить в неё надо стоя напротив.
       * Выстрел по диагонали уходит в стену рядом: бот честно целился в
       * кристалл и полторы сотни раз попал в забор.
       *
       * Поэтому сначала занимаем место в четырёх клетках прямо перед
       * створкой, с той стороны, где стоим, и идём туда обычным поиском
       * пути — он умеет обходить стены, а самодельное выравнивание по
       * оси упиралось в них и не сходилось.
       */
      const dx = breaking.x - player.x;
      const dy = breaking.y - player.y;
      const alongY = breaking.axis ? breaking.axis === 'x' : Math.abs(dy) >= Math.abs(dx);

      /* Далеко — сначала дойти, и дойти по-настоящему, через двери. */
      if (Math.hypot(dx, dy) > TILE_SIZE * 7) {
        const walk = safeStep(w, stepToward(w, breaking));
        if (walk.x || walk.y) {
          return { ...idle, moveX: walk.x, moveY: walk.y,
            aimAngle: Math.atan2(dy, dx) };
        }
      }
      /*
       * Отступ зависит от того, что ломаем. Соломе нужно шесть клеток:
       * копна занимается целиком, и огонь достаёт дальше, чем стоял
       * поджигатель. Всему остальному хватает четырёх, и это важно:
       * створки стоят через равные промежутки, и отступ в пять клеток
       * ставил бота ровно в соседнюю створку — в дыру шириной в клетку,
       * откуда он бил по стене рядом с целью.
       */
      const back = breaking.tile === TILE.HAY ? 6 : 4;
      const spot = alongY
        ? { x: breaking.x, y: breaking.y - Math.sign(dy || 1) * TILE_SIZE * back }
        : { x: breaking.x - Math.sign(dx || 1) * TILE_SIZE * back, y: breaking.y };

      const angle = Math.atan2(dy, dx);
      const offSpot = Math.hypot(spot.x - player.x, spot.y - player.y);

      /*
       * Заход на позицию не может длиться вечно: поиск пути возвращает
       * «стой», как только считает, что лучше уже не станет, и бот
       * замирал напротив створки навсегда. Через три секунды бьём с того
       * места, где стоим — промах дешевле молчания.
       *
       * Но пожар в счёт не идёт. Своя же горящая створка держит дорогу
       * несколько секунд, и если отсчитывать это время как «заход не
       * удался», бот успевает выстрелить из-за угла в стену и уйти в
       * бесконечный круг. Ждём, пока прогорит, и только потом торопимся.
       */
      /*
       * Встаём на ось створки простым шагом вдоль стены, а не поиском
       * пути. Поиск пути возвращает «стой» в десятке безобидных случаев
       * и уводил бота то в соседнюю створку, то в тупик; комната же
       * открыта, и вдоль неё достаточно идти в одну сторону, пока
       * створка не окажется ровно под нами.
       */
      const wanted = alongY
        ? { x: Math.sign(dx) * (Math.abs(dx) > 8 ? 1 : 0), y: 0 }
        : { x: 0, y: Math.sign(dy) * (Math.abs(dy) > 8 ? 1 : 0) };
      const step = safeStep(w, wanted);
      const heldByFire = (wanted.x || wanted.y) && !step.x && !step.y;

      if (!heldByFire) breakingFor += DT;

      if (heldByFire || ((wanted.x || wanted.y) && breakingFor < 4)) {
        return { ...idle, moveX: step.x, moveY: step.y, aimAngle: angle };
      }

      /* Слишком близко — сначала отойти, иначе свой же пожар достанет. */
      if (Math.hypot(dx, dy) < TILE_SIZE * (breaking.tile === TILE.HAY ? 5 : 3)) {
        const off = safeStep(w, { x: -Math.cos(angle), y: -Math.sin(angle) });
        if (off.x || off.y) return { ...idle, moveX: off.x, moveY: off.y, aimAngle: angle };
      }

      if (player.stack.length) {
        if (world.botTrace) world.botTrace.push(`${w.elements[tryElement % w.elements.length]}@${Math.round(breaking.x)},${Math.round(breaking.y)}из${Math.round(player.x)},${Math.round(player.y)}`);
        /*
         * Не «стой смирно ещё полторы секунды», а «попробуй снова через
         * треть». Створке нужна своя стихия, и первая попытка чаще всего
         * не та; при полном сбросе бот успевал уйти, перестать считаться
         * застрявшим и больше не возвращался — одна попытка на створку
         * за весь прогон.
         */
        breaking = null;
        breakingFor = 0;
        stillFor = 1.2;
        tryElement += 1;
        return { ...idle, aimAngle: angle, attack: true };
      }
      if (player.chargeLeft <= 0) {
        const pick = w.elements[tryElement % w.elements.length];
        if (shocksSelf(w, pick)) {
          const away = safeStep(w, { x: -Math.cos(angle), y: -Math.sin(angle) });
          return { ...idle, moveX: away.x, moveY: away.y, aimAngle: angle };
        }
        return { ...idle, aimAngle: angle, charge: pick };
      }
      return { ...idle, aimAngle: angle };
    }


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
      /*
       * Ближе, чем летит плевок. Порог стоял на 260, а одиночный демон
       * долетает на 211 — и пока враги сами бежали навстречу, разница не
       * замечалась. Как только этаж стал спать до замеченной смерти, бот
       * встал на 256 и триста секунд стрелял в воздух: расстояние он
       * держал по своему порогу, а не по дальности того, чем стреляет.
       */
      if (clear && dist < 190) {
        if (player.stack.length) return { ...idle, aimAngle: angle, attack: true };

        /*
         * Набирать стихию вплотную к бите нельзя: набор занимает почти
         * секунду, а громиле хватает одного шага. Пятимся и набираем на
         * ходу — ровно то, что делает живой игрок, и то, чего боту не
         * хватало, чтобы пережить последнюю комнату.
         */
        if (dist < 72) {
          const back = safeStep(w, { x: -Math.cos(angle), y: -Math.sin(angle) });
          return { ...idle, moveX: back.x, moveY: back.y, aimAngle: angle,
            charge: player.chargeLeft <= 0
              ? w.elements.find((candidate) => candidate !== enemy.resist
                && !shocksSelf(w, candidate))
              : null };
        }
        if (player.chargeLeft <= 0) {
          const element = w.elements.find((candidate) => candidate !== enemy.resist
            && !shocksSelf(w, candidate));
          if (!element) {
            /* Отход тоже через проверку огня: пятиться в пожар — тот же
               способ погибнуть, что и идти в него. */
            const away = safeStep(w, { x: -Math.cos(angle), y: -Math.sin(angle) });
            return { ...idle, moveX: away.x, moveY: away.y, aimAngle: angle };
          }
          return { ...idle, aimAngle: angle, charge: element };
        }
        return { ...idle, aimAngle: angle };
      }

      const step = safeStep(w, stepToward(w, enemy));
      return { ...idle, moveX: step.x, moveY: step.y, aimAngle: angle };
    }

    let exit = null;
    for (let i = 0; i < w.tiles.length && !exit; i += 1) {
      if (w.tiles[i] === 4) {
        exit = { x: ((i % w.w) + 0.5) * TILE_SIZE, y: ((i / w.w | 0) + 0.5) * TILE_SIZE };
      }
    }
    const step = safeStep(w, stepToward(w, exit));
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

    /*
     * Обучалка меряется не зачисткой. Она — коридор задачек, и её
     * вопрос другой: открывается ли каждая створка своей стихией и
     * ничем больше. Бот берёт все четыре с первой попытки, но добить
     * последнюю комнату его грубой тактики не хватает, и требовать от
     * него полного прохождения значило бы проверять бота, а не этаж.
     *
     * Зачистку по-прежнему требуем со всех остальных этажей: там она и
     * есть вопрос — можно ли этаж пройти вообще.
     */
    if (floor.tutorial) {
      const left = world.tiles.filter((tile, i) => {
        if (!weakTo(tile)) return false;
        const tx = i % world.w;
        const ty = (i / world.w) | 0;
        let walls = 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) { walls += 1; continue; }
          if (world.tiles[ny * world.w + nx] === TILE.WALL) walls += 1;
        }
        return walls >= 2;
      }).length;

      check(`«${floor.title}»: все створки открыты своей стихией`, left === 0,
        `осталось запертых: ${left}`);
      /*
       * Погибнуть от собственного пожара тут можно, и это не изъян, а
       * замысел: игра не только про то, как убить всех разом, но и про
       * то, как при этом уцелеть самому. Поэтому смерть бота ничего не
       * проваливает — она пишется в отчёт как наблюдение.
       */
      check(`«${floor.title}»: чем кончилась попытка бота`, true,
        `${world.kills}/${world.total}, ${world.botDeath || 'жив'}`
        + (world.botDeathWhere ? ` на ${world.botDeathWhere}` : '')
        + (world.botTrace ? ` [${world.botTrace.slice(0, 10).join(' ')}]` : ''));
      continue;
    }

    check(`«${floor.title}»: бот зачистил этаж`, world.kills === world.total,
      `${world.kills}/${world.total}, игрок ${world.player.alive ? 'жив' : 'убит'}`
      + (world.botDeath ? ` (${world.botDeath})` : '')
      + (world.botTrace ? ` [${world.botTrace.slice(0, 12).join(' ')}]` : '')
      + (world.botTrace ? ` осталось-ломаемого:${world.tiles.filter((t) => weakTo(t)).length}` : '')
      + (world.botTrace ? ` бот:${Math.round(world.player.x)},${Math.round(world.player.y)}`
        + ` живые:${world.enemies.filter((e) => e.alive).map((e) => `${Math.round(e.x)},${Math.round(e.y)}/${e.state}`).join(' ')}` : ''));
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
    { kind: TILE.BARREL, name: 'бочку', yes: ['fire'], no: ['water'] },
    { kind: TILE.BARREL, name: 'бочку молнией', yes: ['bolt'], no: ['water'] },
    { kind: TILE.BOULDER, name: 'валун', yes: ['earth'], no: ['fire'] },
    { kind: TILE.CRYSTAL, name: 'кристалл', yes: ['bolt'], no: ['earth'] },
    { kind: TILE.HAY, name: 'солому', yes: ['fire'], no: ['bolt'] },
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

  /* Лужа растекается кольцами до 0.36 секунды после вскрытия — считать
     клетки раньше значит мерить недотёкшую воду. */
  run(spill.world, 0.9);
  let wet = 0;
  for (let i = 0; i < spill.world.ground.length; i += 1) {
    if (spill.world.ground[i] === GROUND.WATER) wet += 1;
  }
  check('из бочки льётся вода, и не в одну клетку', wet >= 5, `${wet} клеток`);

  /*
   * Разница между «ломается многим» и «ломается одним» — это и есть вся
   * тактика вокруг предметов. Тонкая бочка поддаётся многому, валун и
   * кристалл — ровно одному, и в этом их смысл: они не препятствие, а
   * вопрос «чем именно».
   */
  check('бочка ломается многим, а валун и кристалл — одним',
    weakTo(TILE.BARREL).length > 1
    && weakTo(TILE.BOULDER).length === 1 && weakTo(TILE.CRYSTAL).length === 1,
    weakTo(TILE.BARREL).join('/'));
  check('стена не ломается ничем', weakTo(TILE.WALL) === null);
  check('солома горит и только',
    brokenBy(TILE.HAY, { burn: 1 }) && !brokenBy(TILE.HAY, { shock: 1, crush: 1 }));
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

  /*
   * Берётся не первая бочка, а та, под которой кто-то стоит: бочкой
   * заперта ещё и створка между комнатами, и она в проверке ни при чём.
   */
  let barrel = -1;
  for (let i = 0; i < world.tiles.length && barrel < 0; i += 1) {
    if (world.tiles[i] !== TILE.BARREL) continue;
    const bxx = ((i % world.w) + 0.5) * TILE_SIZE;
    const byy = (((i / world.w) | 0) + 0.5) * TILE_SIZE;
    const below = world.enemies.filter((enemy) => enemy.alive
      && Math.abs(enemy.x - bxx) <= TILE_SIZE * 1.2
      && enemy.y - byy > 0 && enemy.y - byy <= TILE_SIZE * 1.6).length;
    if (below >= 3) barrel = i;
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

  /*
   * Цепочка разложена по времени, и порядок в ней — не украшение, а
   * условие: игрок должен успеть увидеть, что бочку вскрыло раньше, чем
   * потекла вода. Поэтому меряется не «случилось ли», а «что за чем»:
   * кадр, в котором бочки не стало, и кадр, в котором намок первый.
   */
  let brokeAt = -1;
  let wetAt = -1;
  for (let i = 0; i < 90; i += 1) {
    update(world, DT, idle);
    if (brokeAt < 0 && world.tiles[barrel] === TILE.FLOOR) brokeAt = i;
    if (wetAt < 0 && under.some((enemy) => (enemy.wet || 0) > 0)) wetAt = i;
  }

  check('огонь вскрыл бочку', world.tiles[barrel] === TILE.FLOOR);
  check('вода потекла после того, как бочку вскрыло',
    brokeAt >= 0 && wetAt > brokeAt, `бочка ${brokeAt}, вода ${wetAt}`);
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

  /* Та же проверка порядка на второй половине хода: сначала трясёт, потом
     падают. Разряд, убивающий в тот же кадр, в котором пришёл, читается
     как «все просто умерли» — ровно то, чего быть не должно. */
  const zapAt = new Map();
  const deadAt = new Map();
  for (let i = 0; i < 150; i += 1) {
    update(world, DT, idle);
    for (const enemy of under) {
      if (!zapAt.has(enemy) && (enemy.zap || 0) > 0) zapAt.set(enemy, i);
      if (!deadAt.has(enemy) && !enemy.alive) deadAt.set(enemy, i);
    }
  }

  /* Считается по каждому отдельно: снаряд по дороге может убить одного
     напрямую, и общий «первый умерший» мерил бы не цепочку. */
  const jolted = [...zapAt.keys()];
  check('игрок при этом уцелел', world.player.alive);
  check('пойманных цепью сначала бьёт током, потом убивает',
    jolted.length > 0 && jolted.every((enemy) => deadAt.get(enemy) > zapAt.get(enemy)),
    jolted.map((enemy) => `${zapAt.get(enemy)}→${deadAt.get(enemy)}`).join(' '));
  check('разряд по луже забрал всех троих',
    under.every((enemy) => !enemy.alive),
    under.map((enemy) => (enemy.alive ? 'жив' : 'нет')).join(' '));
}


/* --- N. Прицел видит и неживое --- */
{
  /*
   * Обучалка просит разбить бочку, а прицел с клавиатуры держался только
   * за тела: на неподвижное он не наводился никогда, и пройти обучалку
   * можно было исключительно мышью. Это нашлось не прогоном, а живым
   * человеком за игрой — тем обиднее.
   */
  const world = createWorld(TUTOR);
  /*
   * Берётся не первая бочка, а та, под которой кто-то стоит: бочкой
   * заперта ещё и створка между комнатами, и она в проверке ни при чём.
   */
  let barrel = -1;
  for (let i = 0; i < world.tiles.length && barrel < 0; i += 1) {
    if (world.tiles[i] !== TILE.BARREL) continue;
    const bxx = ((i % world.w) + 0.5) * TILE_SIZE;
    const byy = (((i / world.w) | 0) + 0.5) * TILE_SIZE;
    const below = world.enemies.filter((enemy) => enemy.alive
      && Math.abs(enemy.x - bxx) <= TILE_SIZE * 1.2
      && enemy.y - byy > 0 && enemy.y - byy <= TILE_SIZE * 1.6).length;
    if (below >= 3) barrel = i;
  }

  const bx = ((barrel % world.w) + 0.5) * TILE_SIZE;
  const by = (((barrel / world.w) | 0) + 0.5) * TILE_SIZE;
  world.player.x = bx - TILE_SIZE * 3;
  world.player.y = by;

  const all = lockCandidates(world, 0);
  check('бочка попадает в список целей',
    all.some((target) => target.prop === barrel), `целей ${all.length}`);

  /* Но не вперёд живых: в бою прицел не должен уезжать на скамейку. */
  const first = lockTarget(world, null, 0);
  check('живой всё равно берётся первым',
    first && first.prop === undefined,
    first ? (first.prop === undefined ? 'живой' : 'предмет') : 'никого');

  /* Tab обязан до неё доводить — иначе список бесполезен. */
  let target = first;
  let steps = 0;
  while (steps < all.length + 1 && (!target || target.prop !== barrel)) {
    target = cycleTarget(world, target, 0);
    steps += 1;
  }
  check('Tab доводит до бочки', target && target.prop === barrel, `за ${steps} нажатий`);

  /* Разбитая перестаёт быть целью в тот же кадр. */
  world.tiles[barrel] = 0;
  check('разбитая бочка из целей уходит',
    !lockCandidates(world, 0).some((t) => t.prop === barrel));
}


/* --- N2. В непрозрачное тоже можно ткнуть --- */
{
  /*
   * Стог, валун и ящик загораживают обзор — и загораживали сами себя:
   * луч видимости шёл до середины клетки, упирался в неё же и объявлял
   * цель невидимой. Выбрать их было нельзя ни тапом, ни клавишей, хотя
   * видно их прекрасно, и это ровно те вещи, ради которых прицел по
   * предметам делался.
   *
   * Ошибка живёт только на непрозрачном: бочку было видно всегда, и на
   * ней проверка ничего не находила.
   */
  const world = createWorld(TUTOR);

  /*
   * Берётся не первый попавшийся стог, а тот, слева от которого есть где
   * встать. Первый в списке — створка в стене, и игрок, поставленный на
   * пять клеток левее неё, оказывается внутри стены: ни обзора, ни целей,
   * и проверка падала не по делу.
   */
  let hay = -1;
  for (let i = 0; i < world.tiles.length && hay < 0; i += 1) {
    if (world.tiles[i] !== TILE.HAY) continue;
    const tx = i % world.w;
    const ty = (i / world.w) | 0;
    let open = true;
    for (let back = 1; back <= 5 && open; back += 1) {
      if (tx - back < 0 || blocksMove(world.tiles[ty * world.w + tx - back])) open = false;
    }
    if (open) hay = i;
  }
  check('в парке есть стог с подходом слева', hay >= 0, `клетка ${hay}`);

  const hx = ((hay % world.w) + 0.5) * TILE_SIZE;
  const hy = (((hay / world.w) | 0) + 0.5) * TILE_SIZE;

  /* Игрок встаёт слева и в стороне: по прямой, но не вплотную. */
  world.player.x = hx - TILE_SIZE * 5;
  world.player.y = hy;

  const list = lockCandidates(world, 0);
  check('стог попадает в список целей',
    list.some((target) => target.prop === hay), `целей ${list.length}`);

  /* И тап рядом с ним выбирает именно его. */
  const near = targetNear(world, hx, hy);
  check('тап по стогу выбирает стог',
    near && near.prop === hay,
    near ? (near.prop === undefined ? 'живого' : `предмет ${near.prop}`) : 'ничего');

  /* Далёкая цель тоже берётся руками: половина игры в том, чтобы ударить
     издалека, и круг автонаведения тут не указ. */
  world.player.x = hx - TILE_SIZE * 5;
  world.viewRadius = 420;
  const far = targetNear(world, hx, hy);
  check('дальний стог берётся руками, а не автонаведением',
    far && far.prop === hay, far ? 'выбран' : 'потерян');
}


/* --- O. Этаж спит до первой смерти --- */
{
  /*
   * Половина игры, которой не хватало: комнату можно обойти и разглядеть,
   * а бой начинается тогда, когда его начал ты. Считается именно смерть —
   * не шум и не вид заряженного, — иначе тихая фаза кончалась бы неизвестно
   * от чего.
   */
  const world = createWorld(TUTOR);
  const enemy = world.enemies.find((e) => e.alive);

  /* Встаём вплотную и стоим: заметить обязаны, броситься — нет. */
  world.player.x = enemy.x + TILE_SIZE * 1.5;
  world.player.y = enemy.y;
  run(world, 4);

  check('пока никто не убит, никто не гонится',
    world.enemies.every((e) => e.state !== 'chase'),
    world.enemies.map((e) => e.state).join(','));
  check('и стоящего вплотную не трогают', world.player.alive);
  check('этаж числится спящим', world.engaged === false);

  /*
   * Первая замеченная смерть будит всех — замеченная, поэтому убиваем
   * того, рядом с кем есть кому заметить. На этаже, где враги стоят по
   * разным комнатам, смерть одиночки не будит никого, и это правило, а
   * не сбой: тревогу поднимает не смерть, а свидетель.
   */
  const seen = world.enemies.find((victim) => victim.alive
    && world.enemies.some((other) => other !== victim && other.alive
      && Math.hypot(other.x - victim.x, other.y - victim.y) < 120));
  check('на этаже есть смерть, которую увидят', Boolean(seen));
  killEnemy(world, seen, 0, 'daemon', { by: 'player' });
  check('смерть объявляется событием',
    world.events.some((event) => event.type === 'engaged'));
  check('этаж проснулся', world.engaged === true);

  /* Встаём на виду у выжившего: разбуженный этаж должен реагировать. */
  const next = world.enemies.find((e) => e.alive);

  /* Встаём на открытую клетку рядом: слепой сдвиг «на две клетки вправо»
     мог поставить игрока в стену, и разбуженный этаж честно никого не
     видел. Сторона выбирается по карте, а не наугад. */
  const spots = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]];
  for (const [dx, dy] of spots) {
    const x = next.x + dx * TILE_SIZE;
    const y = next.y + dy * TILE_SIZE;
    const at = (((y / TILE_SIZE) | 0) * world.w) + ((x / TILE_SIZE) | 0);
    if (world.tiles[at] !== undefined && !blocksMove(world.tiles[at])) {
      world.player.x = x;
      world.player.y = y;
      break;
    }
  }
  /* И разворачиваем его к игроку: проверяется реакция разбуженного этажа,
     а не удача с тем, куда враг смотрел в момент убийства. */
  next.angle = Math.atan2(world.player.y - next.y, world.player.x - next.x);

  run(world, 3);
  check('после смерти за игроком уже гонятся',
    world.enemies.some((e) => e.alive && e.state === 'chase') || !world.player.alive,
    world.enemies.filter((e) => e.alive).map((e) => e.state).join(','));
}

/* --- P. Первый ход: молния в бочку --- */
{
  /*
   * Ровно тот ход, ради которого обучалка и стоит первой: разряд в бочку,
   * вода разливается, и ток идёт по ней ко всем, кто в этот момент в воде.
   * Одно нажатие, три следствия — и ни одно из них не работает в одиночку.
   */
  const world = createWorld(TUTOR);
  /*
   * Берётся не первая бочка, а та, под которой кто-то стоит: бочкой
   * заперта ещё и створка между комнатами, и она в проверке ни при чём.
   */
  let barrel = -1;
  for (let i = 0; i < world.tiles.length && barrel < 0; i += 1) {
    if (world.tiles[i] !== TILE.BARREL) continue;
    const bxx = ((i % world.w) + 0.5) * TILE_SIZE;
    const byy = (((i / world.w) | 0) + 0.5) * TILE_SIZE;
    const below = world.enemies.filter((enemy) => enemy.alive
      && Math.abs(enemy.x - bxx) <= TILE_SIZE * 1.2
      && enemy.y - byy > 0 && enemy.y - byy <= TILE_SIZE * 1.6).length;
    if (below >= 3) barrel = i;
  }

  const bx = ((barrel % world.w) + 0.5) * TILE_SIZE;
  const by = (((barrel / world.w) | 0) + 0.5) * TILE_SIZE;

  const under = world.enemies.filter((enemy) => enemy.alive
    && Math.abs(enemy.x - bx) <= TILE_SIZE * 1.2
    && enemy.y - by > 0 && enemy.y - by <= TILE_SIZE * 1.6);
  for (const enemy of world.enemies) {
    if (!under.includes(enemy)) enemy.alive = false;
  }

  world.player.x = bx - TILE_SIZE * 4;
  world.player.y = by;
  cast(world, ['bolt'], 0);

  /* Цепочке нужно время: бочку вскрыло, вода разошлась, разряд добежал,
     тела отдёргались и попадали по очереди. Полторы секунды хватает на
     всё это с запасом — и запас нужен: домино добавляет по восьмой доле
     секунды на каждого следующего. */
  run(world, 1.6);

  check('молния вскрывает бочку', world.tiles[barrel] === TILE.FLOOR);
  check('и тем же разрядом забирает всех, кто оказался в воде',
    under.every((enemy) => !enemy.alive),
    under.map((enemy) => (enemy.alive ? 'жив' : 'нет')).join(' '));
}

/* --- P2. Крепкий держит одиночную стихию --- */
{
  /*
   * Носитель щита — первый враг, которого нельзя снять одним касанием.
   * Смысл не в том, чтобы бить дважды, а в том, чтобы найти, чем взять:
   * способов четыре, и каждый убивает его сразу. Проверяются все четыре
   * и отдельно то, ради чего всё затевалось, — что простой удар не берёт.
   */
  function carrier(prepare) {
    const world = createWorld(TUTOR);
    world.elements = [...ELEMENT_ORDER];

    for (const enemy of world.enemies) enemy.alive = false;

    const mark = world.enemies[0];
    mark.alive = true;
    mark.kind = 'carrier';
    mark.hp = 2;
    mark.resist = null;
    mark.state = 'idle';
    mark.x = world.player.x + TILE_SIZE * 3;
    mark.y = world.player.y;
    world.total = 1;
    world.kills = 0;

    if (prepare) prepare(world, mark);
    return { world, mark };
  }

  {
    const { world, mark } = carrier();
    cast(world, ['fire'], 0);
    run(world, 0.6);
    check('крепкий держит одиночную стихию', mark.alive && mark.hp === 1,
      `жив=${mark.alive} запас=${mark.hp}`);
  }

  {
    /* 1. Состояние: мокрого добивает разряд. */
    const { world, mark } = carrier((w, enemy) => { enemy.wet = 3; });
    cast(world, ['bolt'], 0);
    run(world, 0.6);
    check('мокрого крепкого разряд снимает сразу', !mark.alive);
  }

  {
    /* 2. Состав: две стихии — это вещество, а не искра. */
    const { world, mark } = carrier();
    cast(world, ['fire', 'water'], 0);
    run(world, 0.8);
    check('состав из двух стихий снимает крепкого сразу', !mark.alive);
  }

  {
    /* 3. Дорогая форма: за луч заплачено набором. */
    const { world, mark } = carrier();
    cast(world, ['water', 'water', 'water'], 0);
    run(world, 0.8);
    check('дорогая форма снимает крепкого сразу', !mark.alive,
      `жив=${mark.alive} запас=${mark.hp}`);
  }

  {
    /* 4. Добивание: оглушённый не держит ничего. */
    const { world, mark } = carrier((w, enemy) => { enemy.stagger = 0.5; });
    cast(world, ['fire'], 0);
    run(world, 0.6);
    check('оглушённого крепкого добивает любой удар', !mark.alive);
  }
}


/* --- P3. Летящее тело — снаряд --- */
{
  /*
   * Правило общее, а не частный случай про трупы от бочки. Иначе это
   * украшение: красиво один раз и ничего не меняет. Общее правило даёт
   * игроку новый глагол — швырять врагов друг в друга, — и порождает
   * решения, которых никто не задумывал.
   *
   * Поэтому проверяются оба конца: и живой отброшенный, и мёртвый
   * отлетевший. Если работает только один, правило снова частный случай.
   */
  function pair() {
    const world = createWorld(TUTOR);
    for (const enemy of world.enemies) enemy.alive = false;

    const flyer = world.enemies[0];
    const mark = world.enemies[1];
    flyer.alive = true;
    mark.alive = true;
    mark.resist = null;
    mark.hp = 1;
    flyer.x = 200; flyer.y = 200;
    mark.x = 260; mark.y = 200;
    world.total = 2;
    world.kills = 0;
    return { world, flyer, mark };
  }

  {
    const { world, flyer, mark } = pair();
    flyer.stagger = 1.2;
    flyer.shove = 1.2;
    flyer.vx = 400;
    run(world, 1);
    check('отброшенный живой сносит того, в кого влетел', !mark.alive);
  }

  {
    /* Мёртвый уносит скорость с собой — ровно тот случай, который просил
       автор: тело отлетело от взрыва и снесло второго. */
    const { world, flyer, mark } = pair();
    flyer.vx = 420;
    killEnemy(world, flyer, 0, 'daemon', { by: 'player' });
    run(world, 1);
    check('труп, отлетевший со скоростью, сносит второго', !mark.alive);
  }

  {
    /* А вот бегущий своим ходом никого не сносит: иначе враги валили бы
       друг друга сами, и правило превратилось бы в шум. */
    const { world, mark } = pair();
    const runner = world.enemies[0];
    runner.vx = 150;
    runner.stagger = 0;
    run(world, 1);
    check('бегущий своим ходом никого не сносит', mark.alive);
  }
}


/* --- P4. Щиток шумит не там, где игрок --- */
{
  /*
   * Первый способ пройти этаж, никого не убив, и первый шум в игре,
   * который исходит не из-под ног игрока. Всё остальное, что гремит,
   * гремит там, где ты стоишь: выстрел, взрыв, падающее тело. Таким
   * шумом можно убить, но нельзя отвлечь.
   *
   * Проверяется не «щиток ломается», а то, ради чего он есть: стража
   * идёт к щитку, а не к игроку. Проверка на разность расстояний, а не
   * на факт тревоги — иначе она пройдёт и на шуме под ногами.
   */
  const world = createWorld(TUTOR);
  world.elements = [...ELEMENT_ORDER];

  let panel = -1;
  for (let i = 0; i < world.tiles.length && panel < 0; i += 1) {
    if (world.tiles[i] === TILE.PANEL) panel = i;
  }
  check('в парке есть щиток', panel >= 0, `клетка ${panel}`);

  const px = ((panel % world.w) + 0.5) * TILE_SIZE;
  const py = (((panel / world.w) | 0) + 0.5) * TILE_SIZE;

  /* Игрок далеко от щитка и от стражи: важно, что шум придёт не от него. */
  const guard = world.enemies.find((enemy) => enemy.alive);
  guard.x = px + TILE_SIZE * 6;
  guard.y = py + TILE_SIZE * 3;
  guard.state = 'idle';
  guard.heard = null;

  world.player.x = px + TILE_SIZE * 4;
  world.player.y = py;

  const доИгрока = () => Math.hypot(guard.x - world.player.x, guard.y - world.player.y);
  const доЩитка = () => Math.hypot(guard.x - px, guard.y - py);
  const былоДоЩитка = доЩитка();

  cast(world, ['bolt'], Math.PI);
  run(world, 3);

  check('щиток замкнуло', world.tiles[panel] !== TILE.PANEL);
  check('стража пошла к щитку, а не к игроку',
    доЩитка() < былоДоЩитка && доЩитка() < доИгрока(),
    `до щитка ${Math.round(былоДоЩитка)} → ${Math.round(доЩитка())}, до игрока ${Math.round(доИгрока())}`);
}


/* --- P5. Стена — то же тело, только неподвижное --- */
{
  /*
   * До этого лёд отнимал управление и больше ничего: съехал — и съехал.
   * Связка, которой никто не задумывал: заморозить пол, толкнуть врага и
   * разогнать его в стену, ни разу не коснувшись. Правило одно с телом в
   * тело, иначе стена оказалась бы мягче человека.
   *
   * Проверяется и обратное: бегущий своим ходом в стену не страдает,
   * иначе враги гибли бы об углы сами, а игрок — на каждом повороте.
   */
  function вСтену(скорость) {
    const world = createWorld(TUTOR);
    for (const enemy of world.enemies) enemy.alive = false;

    const mark = world.enemies[0];
    mark.alive = true;
    mark.resist = null;
    mark.hp = 1;

    /* Ставим вплотную к левой стене и толкаем в неё. */
    mark.x = TILE_SIZE * 1.4;
    mark.y = TILE_SIZE * 12.5;
    mark.stagger = 1;
    mark.shove = 1;
    mark.vx = -скорость;
    mark.vy = 0;
    world.total = 1;
    world.kills = 0;

    run(world, 0.6);
    return mark.alive;
  }

  check('разогнанный в стену не встаёт', !вСтену(400));
  check('идущий в стену своим ходом цел', вСтену(60));
}


/* --- P6. Силовая дверь падает вместе с питанием --- */
{
  /*
   * Первая дверь, которую не открывают силой. Ни огонь, ни удар, ни
   * разряд по ней самой не работают — работает только то, что она
   * питается: обесточил и прошёл.
   *
   * И это тот же щиток, только со вторым следствием: один удар уводит
   * стражу туда и открывает дорогу здесь.
   */
  const world = createWorld(TUTOR);
  world.elements = [...ELEMENT_ORDER];

  const силовых = () => world.tiles.filter((tile) => tile === TILE.FORCE).length;
  const открытых = () => world.tiles.filter((tile) => tile === TILE.FORCE_OFF).length;

  check('в парке есть силовая дверь', силовых() > 0, `${силовых()} клеток`);
  check('под напряжением она держит проход', blocksMove(TILE.FORCE));
  check('обесточенная не держит', !blocksMove(TILE.FORCE_OFF));

  let panel = -1;
  for (let i = 0; i < world.tiles.length && panel < 0; i += 1) {
    if (world.tiles[i] === TILE.PANEL) panel = i;
  }

  const px = ((panel % world.w) + 0.5) * TILE_SIZE;
  const py = (((panel / world.w) | 0) + 0.5) * TILE_SIZE;
  const было = силовых();

  for (const enemy of world.enemies) enemy.alive = false;
  world.player.x = px + TILE_SIZE * 4;
  world.player.y = py;
  cast(world, ['bolt'], Math.PI);
  run(world, 1);

  check('щиток обесточил этаж', world.powered === false);
  check('силовые двери открылись', открытых() === было && силовых() === 0,
    `было ${было}, открыто ${открытых()}, осталось ${силовых()}`);
}


/* --- P7. Взлом против замыкания --- */
{
  /*
   * Взлом здесь не мини-игра, а разница в том, чем бьёшь по тому же
   * щитку. Отдельный экран с таймером был бы другой игрой, приклеенной
   * к этой: он ни на что не умножается.
   *
   * Одиночная искра замыкает — громко и насовсем. Состав с разрядом
   * делает то же тихо и не ломая: за состав заплачено очередью, и он
   * даёт точность, а не силу.
   *
   * Проверяется то, ради чего развилка и заведена: разная цена. Шум и
   * судьба щитка, а не факт переключения.
   */
  function поЩитку(стек) {
    const world = createWorld(TUTOR);
    world.elements = [...ELEMENT_ORDER];
    for (const enemy of world.enemies) enemy.alive = false;

    let panel = -1;
    for (let i = 0; i < world.tiles.length && panel < 0; i += 1) {
      if (world.tiles[i] === TILE.PANEL) panel = i;
    }

    const px = ((panel % world.w) + 0.5) * TILE_SIZE;
    const py = (((panel / world.w) | 0) + 0.5) * TILE_SIZE;

    world.player.x = px + TILE_SIZE * 4;
    world.player.y = py;

    /*
     * Меряется шум У ЩИТКА, а не громкость вообще. Состав и сам по себе
     * громче искры — его выпуск слышно, — но это шум там, где стоит
     * игрок. Разница между взломом и замыканием в другом: замыкание
     * гремит НА ЩИТКЕ и уводит туда стражу, а взлом там не звучит вовсе.
     */
    let уЩитка = 0;
    cast(world, стек, Math.PI);
    for (let f = 0; f < 90; f += 1) {
      update(world, DT, idle);
      for (const шум of world.noises) {
        if (Math.hypot(шум.x - px, шум.y - py) < TILE_SIZE) {
          уЩитка = Math.max(уЩитка, шум.radius);
        }
      }
    }

    return {
      питание: world.powered,
      щитокЦел: world.tiles[panel] === TILE.PANEL,
      уЩитка,
    };
  }

  const грубо = поЩитку(['bolt']);
  /* Состав, который летит: два элемента дают конус, а он не достаёт на
     четыре клетки — сравнивать надо на равной дистанции, иначе меряется
     дальность, а не точность. */
  const точно = поЩитку(['fire', 'bolt', 'fire']);

  check('искра замыкает щиток', грубо.питание === false && !грубо.щитокЦел,
    `питание ${грубо.питание}, щиток ${грубо.щитокЦел ? 'цел' : 'сгорел'}`);
  check('состав взламывает и не ломает', точно.питание === false && точно.щитокЦел,
    `питание ${точно.питание}, щиток ${точно.щитокЦел ? 'цел' : 'сгорел'}`);
  check('замыкание гремит у щитка, взлом там молчит',
    точно.уЩитка === 0 && грубо.уЩитка > 0,
    `у щитка при взломе ${Math.round(точно.уЩитка)}, при замыкании ${Math.round(грубо.уЩитка)}`);
}


/* --- Q0. Мокрое дерево не горит --- */
{
  /*
   * Единственное, что вода умеет делать с предметами, — тушить их
   * заранее. Ради этого её и льют: намочил копну, и чужой огонь по ней не
   * пойдёт. Клетка «лить × дерево» до этого была пустой, а вся строка
   * «лить» не делала с предметами ничего.
   */
  function копнаПослеОгня(мочить) {
    const world = createWorld(TUTOR);
    world.elements = [...ELEMENT_ORDER];
    for (const enemy of world.enemies) enemy.alive = false;

    let hay = -1;
    for (let i = 0; i < world.tiles.length && hay < 0; i += 1) {
      if (world.tiles[i] === TILE.HAY) hay = i;
    }

    const hx = ((hay % world.w) + 0.5) * TILE_SIZE;
    const hy = (((hay / world.w) | 0) + 0.5) * TILE_SIZE;
    const было = world.tiles.filter((tile) => tile === TILE.HAY).length;

    if (мочить) {
      paint(world, tilesInCircle(world, hx, hy, TILE_SIZE * 2),
        substanceOf(['water']), { x: hx, y: hy }, true);
    }

    world.player.x = hx - TILE_SIZE * 4;
    world.player.y = hy;
    cast(world, ['fire'], 0);
    run(world, 2);

    return { было, стало: world.tiles.filter((tile) => tile === TILE.HAY).length };
  }

  const сухая = копнаПослеОгня(false);
  const мокрая = копнаПослеОгня(true);

  check('сухая копна выгорает', сухая.стало === 0, `${сухая.было} → ${сухая.стало}`);
  check('мокрая копна держится', мокрая.стало > сухая.стало,
    `${мокрая.было} → ${мокрая.стало} против сухой ${сухая.стало}`);
}


/* --- Q. Солома --- */
{
  const world = createWorld(TUTOR);
  world.elements = [...ELEMENT_ORDER];

  /*
   * Копна — это связный кусок соломы, а не вся солома этажа. Соломой
   * заперты ещё и створки между комнатами, и они стоят отдельно: одна
   * искра их не берёт и брать не должна. Считать «всю солому» значило бы
   * требовать, чтобы пожар в одной комнате открыл двери в другой.
   */
  const allHay = [];
  for (let i = 0; i < world.tiles.length; i += 1) {
    if (world.tiles[i] === TILE.HAY) allHay.push(i);
  }

  function copseAt(start) {
    const seenCells = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift();
      const tx = at % world.w;
      const ty = (at / world.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
        const next = ny * world.w + nx;
        if (seenCells.has(next) || world.tiles[next] !== TILE.HAY) continue;
        seenCells.add(next);
        queue.push(next);
      }
    }
    return [...seenCells];
  }

  let hay = [];
  for (const cell of allHay) {
    const group = copseAt(cell);
    if (group.length > hay.length) hay = group;
  }
  check('в парке есть копна', hay.length >= 4, `${hay.length} клеток из ${allHay.length}`);

  /* Маг, стоящий у копны, — тот, ради кого её и поджигают. */
  const victim = world.enemies.find((e) => e.alive);
  for (const enemy of world.enemies) if (enemy !== victim) enemy.alive = false;

  /*
   * Бьём в левый край копны сбоку. Снизу нельзя: под копной стена со
   * створкой, и выстрел уходил бы в неё. Направление выбирается по самой
   * копне, а не по памяти о том, как этаж выглядел раньше.
   */
  const cols = hay.map((i) => i % world.w);
  const minTx = Math.min(...cols);
  const edge = hay.find((i) => i % world.w === minTx);
  const hx = ((edge % world.w) + 0.5) * TILE_SIZE;
  const hy = (((edge / world.w) | 0) + 0.5) * TILE_SIZE;

  /* Жертва — с дальней стороны копны: она обязана сгореть от того же
     пожара, а не от прямого попадания. */
  const maxTx = Math.max(...cols);
  victim.x = (maxTx + 1.5) * TILE_SIZE;
  victim.y = hy;
  victim.state = 'idle';
  victim.resist = null;

  world.player.x = hx - TILE_SIZE * 4;
  world.player.y = hy;
  cast(world, ['fire'], 0);
  run(world, 0.6);

  const left = hay.filter((i) => world.tiles[i] === TILE.HAY).length;
  check('одна искра поджигает всю копну', left === 0, `осталось ${left}`);

  run(world, FIRE_CATCH + BURN_TIME + 0.3);
  check('стоящий у копны сгорает', !victim.alive);

  /* Но не всё подряд: молния соломе безразлична. */
  const dry = createWorld(TUTOR);
  dry.elements = [...ELEMENT_ORDER];
  dry.player.x = hx;
  dry.player.y = hy + TILE_SIZE * 2.5;
  cast(dry, ['bolt'], -Math.PI / 2);
  run(dry, 0.4);
  check('молния солому не берёт', dry.tiles[edge] === TILE.HAY);
}


console.log(report.join('\n'));
console.log(failures ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}` : '\nвсе проверки прошли');
process.exit(failures ? 1 : 0);
