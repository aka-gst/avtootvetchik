/*
 * ТЕХНОМАГИЯ — мир: тела, столкновения, оружие, смерть.
 *
 * Здесь нет ни отрисовки, ни ввода. Мир получает намерение игрока
 * (куда идти, куда смотреть, что нажал) и продвигает себя на dt.
 * Что рисовать — решает render.js, что делают враги — ai.js.
 *
 * Главное правило жанра: с одного удара умирают все, включая игрока.
 * Поэтому здоровья нет ни у кого, а есть только «жив» и «лежит».
 *
 * Оружия у игрока нет вовсе — только очередь демонов. Подобрать с пола
 * нечего, бросить нечего: всё, что он умеет, набирается стрелками. У
 * врагов оружие осталось: бита и пистолет — это их роль, а не инвентарь.
 */

import { TILE, TILE_SIZE, blocksMove, blocksSight, blocksShot, breakable, brokenBy } from './level.js';
import { thinkEnemy, buildFlowField } from './ai.js';
import {
  GROUND, createField, updateField, groundAt, groundIndex, burningAt,
  paint, tilesInCircle, tilesInCone, tilesAlongLine,
  conductedTiles, conducts, cloudsBlock, addCloud,
  SPILL, JOLT, FLARE, BURN_TIME, WET_TIME, CHAIN_HOP,
} from './field.js';
import { spellOf, STACK_LIMIT, CHARGE_STEP, colourOf, ELEMENT_ORDER } from './magic.js';

export { TILE_SIZE };

/* Радиус тела одинаков у всех: попадание должно читаться на глаз. */
export const BODY = 9;

/*
 * Чем воюют враги. Огнестрела здесь больше нет ни у кого: те, кто держал
 * дистанцию, швыряются той же магией, что и игрок, — только одной стихией
 * и без очереди. Так вся игра говорит на одном языке, и по цвету снаряда
 * сразу видно, чем этого брать нельзя.
 */
export const WEAPONS = {
  bat: {
    id: 'bat', name: 'БИТА', kind: 'melee',
    reach: 38, arc: 2.0, cooldown: 0.27, lethal: true, noise: 110,
  },
  hex: {
    id: 'hex', name: 'ПОРЧА', kind: 'gun',
    cooldown: 0.9, clip: 99, speed: 560, spread: 0.05, noise: 380,
  },
};

/*
 * Темп. Игра про то, что всё решается за секунду, поэтому разгон почти
 * мгновенный: между нажатием и движением не должно быть ничего, что
 * чувствуется. Враг бежит заметно медленнее игрока — убегать можно, но
 * от пули это не спасает.
 */
/*
 * Общий темп. Одно число на всех, кто ходит по этажу, и правится оно
 * только здесь: разъехавшись, скорости игрока и врагов ломают не
 * ощущение, а расчёт — расстояние, на котором успеваешь набрать очередь,
 * держится ровно на их отношении.
 *
 * Изометрия попросила сбавить. Сверху скорость читалась по клеткам, а в
 * ромбе тот же путь выглядит длиннее и проходится будто рывком: глаз не
 * успевает за фигурой, и бой превращается в дёрганье.
 */
const PACE = 0.76;

const PLAYER_SPEED = 252 * PACE;
const PLAYER_ACCEL = 3600 * PACE;
const ENEMY_WALK = 70 * PACE;
const ENEMY_RUN = 152 * PACE;
const DOWN_TIME = 2;
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

  /*
   * Пар и пыль прячут всех одинаково — и врагов от игрока тоже. Одна
   * дверь на всё зрение: конус врага, наводка, выдох и вспышка ходят
   * через неё же, поэтому «за паром не видно» не приходится помнить в
   * пяти местах, и своим же паром можно ослепить себя.
   */
  return !cloudsBlock(world, ax, ay, bx, by);
}

/*
 * Видно — не значит попадёшь. Мебель низкая: взгляд идёт поверх, снаряд
 * вязнет. Без отдельной проверки колдун за столом всю попытку целится в
 * игрока и расстреливает стол, потому что «видит» его прекрасно, — и это
 * не хитрость, а тупик, из которого он сам не выходит.
 */
export function hasShot(world, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;

  /*
   * Шаг тот же, что у снаряда, и это не мелочь. Проверка шагала вдвое
   * крупнее полёта и потому не замечала углов, которые снаряд задевал:
   * «выстрел свободен» — а он гибнет о скамью. Бот на этом выпустил
   * полторы тысячи зарядов в один и тот же угол, стоя в трёх шагах от
   * цели, и не понял почему. Живой бы решил, что игра сломана.
   */
  const steps = Math.ceil(Math.hypot(dx, dy) / 6);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (blocksShot(tileAt(world, ax + dx * t, ay + dy * t))) return false;
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

  /*
   * Шаги — не преступление. Пока этаж спокоен, на них никто не идёт
   * смотреть: иначе достаточно было пройти мимо, чтобы получить хвост, и
   * тихого прохода не существовало. Как только тревога поднята, шаги
   * снова слышны — тогда за тобой уже честно охотятся.
   */
  if (source === 'step' && !world.engaged) return;

  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.downed > 0) continue;

    const gap = Math.hypot(enemy.x - x, enemy.y - y);
    if (gap > radius) continue;
    if (enemy.state === 'chase') continue;

    /*
     * Услышанное место тем точнее, чем ближе слушатель. У самого звука
     * идут прямо на него; с края слышимости — примерно в ту сторону.
     * Отсюда и берётся выгода бить издалека: грохот слышали все, а куда
     * бежать, никто толком не знает, и обыск уходит мимо.
     */
    const blur = (gap / radius) * radius * 0.5;
    const away = Math.random() * Math.PI * 2;
    enemy.heard = {
      x: x + Math.cos(away) * blur * Math.random(),
      y: y + Math.sin(away) * blur * Math.random(),
    };
    enemy.state = 'alert';
    enemy.think = 0;
    if (source === 'player') enemy.suspicion = Math.min(1, enemy.suspicion + 0.6);
  }
}


/* =========================================================
   ЧАСТИЦЫ, КРОВЬ, ГИЛЬЗЫ
   ========================================================= */

/*
 * Брызги по краю растекающейся лужи. Вода в игре — не заливка клетки, а
 * событие: без летящих капель кольцо просто меняет цвет пола, и разлив
 * читается как переключение, а не как течение.
 */
function splash(world, x, y, radius) {
  for (let i = 0; i < 7; i += 1) {
    const a = Math.random() * 6.29;
    const r = radius * (0.7 + Math.random() * 0.35);
    world.particles.push({
      x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
      vx: Math.cos(a) * 26, vy: Math.sin(a) * 26 - 12,
      life: 0.3, max: 0.3, color: '#5fd6ff', size: 1 + Math.random() * 1.6,
    });
  }
}

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

/*
 * Кольцо удара. Расходящаяся окружность в точке касания — самый дешёвый
 * способ ответить на вопрос «попал или нет»: она появляется ровно там,
 * где удар что-то нашёл, и только тогда.
 */
function pop(world, x, y, radius, colour) {
  world.pops.push({ x, y, r: radius, max: radius * 2.4, life: 0.22, span: 0.22, colour });
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

    /* Какие стихии даёт этаж. Не свойство игрока, а свойство комнаты:
       чужой этаж по ссылке обязан открыться так же, как у автора. */
    elements: level.elements && level.elements.length ? [...level.elements] : [...ELEMENT_ORDER],

    player: {
      x: level.spawn.x * TILE_SIZE + TILE_SIZE / 2,
      y: level.spawn.y * TILE_SIZE + TILE_SIZE / 2,
      vx: 0, vy: 0,
      angle: (level.spawn.angle || 0) * (Math.PI / 4),
      alive: true,
      cooldown: 0,
      swing: 0,
      step: 0,

      /* Очередь демонов: что набрано, что набирается, что вот-вот вылетит. */
      stack: [],
      charging: null,
      chargeLeft: 0,
      windup: 0,
      pending: null,
    },

    enemies: [],
    bullets: [],
    particles: [],
    pops: [],
    blasts: [],
    decals: [],
    casings: [],
    noises: [],
    corpses: [],

    /*
     * Этаж спит, пока смерть не заметили. Не «пока никто не умер»: убитый
     * в стороне, которого никто не видел и не слышал, тревоги не поднимает.
     * Именно это и делает тихую фазу игрой, а не паузой перед боем — см.
     * witnessed() ниже и thinkEnemy: до тревоги враги не гонятся.
     */
    engaged: false,

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
    beats: [],
    charged: null,
    events: [],
  };

  /* Носители: те же громилы, но со своей стихией — она их и защищает. */
  const SHIELD_BY_TYPE = { 7: 'fire', 8: 'water', 9: 'wind', 10: 'earth', 11: 'bolt' };

  for (const entity of level.entities) {
    const x = entity.x * TILE_SIZE + TILE_SIZE / 2;
    const y = entity.y * TILE_SIZE + TILE_SIZE / 2;

    if (SHIELD_BY_TYPE[entity.type]) {
      world.enemies.push({
        kind: 'carrier',
        weapon: 'bat',
        ammo: 0,
        element: SHIELD_BY_TYPE[entity.type],
        resist: SHIELD_BY_TYPE[entity.type],
        x, y, vx: 0, vy: 0,
        home: { x, y },
        angle: (entity.angle || 0) * (Math.PI / 4),
        alive: true,
        downed: 0,
        stagger: 0,
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

    if (entity.type === 0 || entity.type === 1) {
      /*
       * Стихия дальнобойного берётся из его клетки, а не из случая: этаж
       * должен выглядеть одинаково при каждом заходе, иначе выученная
       * комната перестаёт быть выученной.
       */
      /*
       * Стихия дальнобойного берётся из стихий этажа, а не из всех пяти:
       * иначе на первом этаже в игрока летит молния, которой он ещё не
       * видел, и цвет снаряда перестаёт быть инструкцией.
       */
      const palette = world.elements;
      const element = palette[(entity.x + entity.y * 2) % palette.length];

      world.enemies.push({
        kind: entity.type === 0 ? 'thug' : 'caster',
        weapon: entity.type === 0 ? 'bat' : 'hex',
        element: entity.type === 0 ? null : element,
        /* Своя стихия не берёт: чем светится, тем его не убить. */
        resist: entity.type === 0 ? null : element,
        ammo: 99,
        x, y, vx: 0, vy: 0,
        home: { x, y },
        angle: (entity.angle || 0) * (Math.PI / 4),
        alive: true,
        downed: 0,
        stagger: 0,
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

    /* Типы 3 и 4 — оружие на полу из старых кодов. Подбирать нечего,
       поэтому они просто пропускаются: чужой код всё равно откроется. */
  }

  createField(world);
  world.flow = buildFlowField(world, world.player.x, world.player.y);
  return world;
}


/* =========================================================
   ОРУЖИЕ
   ========================================================= */

function fireGun(world, shooter, from) {
  const weapon = WEAPONS[shooter.weapon];
  const angle = shooter.angle + rand(-weapon.spread, weapon.spread) * (from === 'enemy' ? 2.4 : 1);
  const start = muzzle(world, shooter.x, shooter.y, shooter.angle);

  world.bullets.push({
    x: start.x,
    y: start.y,
    vx: Math.cos(angle) * weapon.speed,
    vy: Math.sin(angle) * weapon.speed,
    from,
    weapon: shooter.weapon,
    /* Порча летит своей стихией: по цвету снаряда видно, чем этого не взять.
       Заодно она не убивает союзника той же стойкости — и это честно. */
    elements: shooter.element ? [shooter.element] : [],
    colour: shooter.element ? colourOf(shooter.element) : null,
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

  const candidates = from === 'player'
    ? world.enemies.filter((e) => e.alive)
    : [world.player].filter((p) => p.alive);

  attacker.swingHit = 0;

  /*
   * Взмах достаётся одному — ближайшему в секторе.
   *
   * Раньше он доставал всем сразу, и это поймал прогон: бита выносила
   * троих за один кадр, а очередь демонов, стоящая почти секунду
   * уязвимости, оказывалась строго хуже бесплатного удара. Толпа обязана
   * быть проблемой, которую решают чем-то другим, — иначе это «другое»
   * незачем набирать.
   */
  let target = null;
  let best = Infinity;

  for (const candidate of candidates) {
    const dist = Math.hypot(candidate.x - attacker.x, candidate.y - attacker.y);
    if (dist > weapon.reach + BODY || dist >= best) continue;
    const toTarget = Math.atan2(candidate.y - attacker.y, candidate.x - attacker.x);
    if (Math.abs(angleDelta(attacker.angle, toTarget)) > weapon.arc / 2) continue;
    if (!hasSight(world, attacker.x, attacker.y, candidate.x, candidate.y)) continue;
    best = dist;
    target = candidate;
  }

  const connected = Boolean(target);

  if (target) {
    const toTarget = Math.atan2(target.y - attacker.y, target.x - attacker.x);

    if (target === world.player) {
      killPlayer(world, toTarget);
    } else if (!resisted(world, target, toTarget)) {
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
  }

  /*
   * Попадание должно ощущаться иначе, чем промах, — и не одним звуком.
   * Кадр замирает, экран вздрагивает, камера коротко наезжает, а дуга
   * удара наливается белым. Промах не делает ничего из этого.
   */
  if (connected) {
    world.fx.hitstop = Math.max(world.fx.hitstop, 0.08);
    world.fx.shake = Math.max(world.fx.shake, 7);
    world.fx.punch = 1;
    attacker.swingHit = 0.2;
    world.events.push({ type: 'impact', lethal: weapon.lethal, from });
  }
}

/*
 * Стойкость. Не здоровье и не щит с зарядами: враг просто не берётся
 * своей же стихией. Огнём по огненному — он её отобьёт, хоть одной, хоть
 * тремя подряд; нужен любой другой цвет, и в смешанной очереди хватает
 * одного чужого.
 *
 * Через эту дверь проходят все смертельные пути — удар, чужая порча,
 * форма демона, — иначе правило однажды забыли бы в одном из них.
 */
/*
 * Кто заметил смерть.
 *
 * Видел — если живой смотрит в ту сторону и между ними нет стены. Слышал —
 * если он ближе, чем падает тело. Второе намеренно куда короче первого:
 * иначе «тихо» не существовало бы, а на маленьком этаже слышно было бы
 * всё и всегда.
 */
const WITNESS_SIGHT = 300;
const WITNESS_HEAR = 130;

function witnessed(world, victim) {
  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy === victim) continue;

    const dist = Math.hypot(enemy.x - victim.x, enemy.y - victim.y);
    if (dist < WITNESS_HEAR) return true;
    if (dist < WITNESS_SIGHT && hasSight(world, enemy.x, enemy.y, victim.x, victim.y)) {
      return true;
    }
  }

  return false;
}

export function resists(enemy, elements) {
  if (!enemy.resist) return false;
  if (!elements || !elements.length) return false; /* железо стойкость не разбирает */
  return elements.every((element) => element === enemy.resist);
}

export function resisted(world, enemy, angle, source = {}) {
  if (!resists(enemy, source.elements)) return false;

  enemy.hitFlash = 0.12;
  enemy.blocked = 0.3;
  pop(world, enemy.x, enemy.y, 15, '255,255,255');
  spark(world, enemy.x, enemy.y, angle + Math.PI, 1.4, 8, colourOf(enemy.resist), 160);
  world.events.push({ type: 'resist', element: enemy.resist });
  return true;
}

export function knockDown(world, enemy, angle) {
  enemy.downed = DOWN_TIME;
  enemy.state = 'down';
  enemy.vx += Math.cos(angle) * 260;
  enemy.vy += Math.sin(angle) * 260;
  enemy.hitFlash = 0.16;
  spark(world, enemy.x, enemy.y, angle, 1.2, 9, '#ffffff', 150);
  pop(world, enemy.x, enemy.y, 14, '255,255,255');
  world.events.push({ type: 'knock' });
}

export function killEnemy(world, enemy, angle, cause, source = {}) {
  if (!enemy.alive) return;
  enemy.alive = false;
  world.kills += 1;

  /*
   * Тело падает — и это слышно. Шум идёт всегда, даже когда тревоги нет:
   * услышавший пойдёт посмотреть, что упало, и это единственная плата за
   * убийство в стороне.
   */
  emitNoise(world, enemy.x, enemy.y, 140, 'body');

  /* Тревогу поднимает не смерть, а замеченная смерть. */
  if (!world.engaged && witnessed(world, enemy)) {
    world.engaged = true;
    world.events.push({ type: 'engaged' });
  }

  bleed(world, enemy.x, enemy.y, angle, cause === 'bullet' ? 260 : 190);
  pop(world, enemy.x, enemy.y, 16, '255,20,80');

  world.corpses.push({
    x: enemy.x + Math.cos(angle) * 6,
    y: enemy.y + Math.sin(angle) * 6,
    angle: enemy.angle,
    kind: enemy.kind,
    twitch: 0.5,
  });

  world.fx.hitstop = Math.max(world.fx.hitstop, 0.045);
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
  world.fx.hitstop = Math.max(world.fx.hitstop, 0.16);
  world.fx.shake = 11;
  world.events.push({ type: 'death' });
}


/* =========================================================
   ДЕМОНЫ
   =========================================================
   Набор стоит времени, и это единственная его цена: пока идёт
   набор, игрок замедлен и стек видно над головой. Всё, что
   вылетает, убивает одинаково — разной бывает только форма.
   ========================================================= */

function releaseStack(world) {
  const player = world.player;
  const spell = spellOf(player.stack);
  if (!spell) return;

  player.stack = [];

  /* У луча замах: линию видно заранее, и уйти с неё успевают обе стороны. */
  if (spell.form.kind === 'beam') {
    player.windup = spell.form.windup;
    player.pending = spell;
    world.events.push({ type: 'daemon-windup', form: spell.form.id });
    return;
  }

  castForm(world, spell);
}

/*
 * Заклинание ходит по миру целиком, а не разобранным на форму и список
 * стихий: вещество нужно всем — оно решает цвет, что останется на полу и
 * кого возьмёт попадание. Разбирать его на входе значило бы собирать
 * обратно в каждой из пяти функций ниже.
 */
function castForm(world, spell) {
  const player = world.player;
  const angle = player.angle;
  const { form, substance } = spell;

  player.cooldown = form.cooldown || 0.22;
  emitNoise(world, player.x, player.y, form.noise, 'player');
  world.fx.shake = Math.max(world.fx.shake, form.kind === 'nova' ? 9 : 4.5);
  world.fx.punch = 1;
  world.events.push({
    type: 'daemon',
    form: form.id,
    elements: spell.elements,
    substance: substance.id,
    signature: spell.signature ? spell.signature.id : null,
  });

  if (form.kind === 'shot') {
    spawnDaemon(world, angle, spell);
  } else if (form.kind === 'fan') {
    for (const shift of [-form.spread, 0, form.spread]) {
      spawnDaemon(world, angle + shift, spell);
    }
  } else if (form.kind === 'cone') {
    castCone(world, spell, angle);
  } else if (form.kind === 'beam') {
    castBeam(world, spell, angle);
  } else if (form.kind === 'nova') {
    castNova(world, spell);
  }
}

/*
 * Откуда вылетает снаряд. Обычно — на шаг впереди, чтобы он не рождался
 * внутри собственного тела. Но если этот шаг попадает в мебель, снаряд
 * гибнет в стволе: каждый выстрел уходит в ничто, а игрок видит, что
 * стреляет, и не понимает, почему не попадает.
 *
 * Поймано прогоном: бот, встав углом к скамье, выпустил полторы тысячи
 * зарядов подряд и не убил стоящего в трёх шагах. У живого это выглядело
 * бы поломкой игры, а не мебелью.
 */
function muzzle(world, x, y, angle) {
  const ahead = { x: x + Math.cos(angle) * 14, y: y + Math.sin(angle) * 14 };
  if (blocksShot(tileAt(world, ahead.x, ahead.y))) return { x, y };
  return ahead;
}

function spawnDaemon(world, angle, spell) {
  const player = world.player;
  const { form, substance } = spell;
  const from = muzzle(world, player.x, player.y, angle);

  world.bullets.push({
    x: from.x,
    y: from.y,
    vx: Math.cos(angle) * form.speed,
    vy: Math.sin(angle) * form.speed,
    from: 'player',
    weapon: 'daemon',
    ox: player.x,
    oy: player.y,
    elements: spell.elements,
    substance,
    trail: Boolean(spell.signature && spell.signature.trail),
    pierce: form.pierce || 0,
    breaks: Boolean(form.breaks),
    colour: substance.colour,
    life: form.life,
  });
}

function castCone(world, spell, angle) {
  const player = world.player;
  const { form, substance } = spell;
  const elements = spell.elements;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    if (Math.hypot(dx, dy) > form.reach + BODY) continue;
    const toEnemy = Math.atan2(dy, dx);
    if (Math.abs(angleDelta(angle, toEnemy)) > form.arc / 2) continue;
    if (!hasSight(world, player.x, player.y, enemy.x, enemy.y)) continue;
    if (resisted(world, enemy, toEnemy, { elements })) continue;
    killEnemy(world, enemy, toEnemy, 'daemon', { by: 'player', weapon: 'daemon', elements });
  }

  world.blasts.push({
    kind: 'cone', x: player.x, y: player.y, angle,
    reach: form.reach, arc: form.arc,
    life: 0.2, span: 0.2, colour: substance.colour,
  });

  land(world, tilesInCone(world, player.x, player.y, angle, form.reach, form.arc), substance, {
    x: player.x + Math.cos(angle) * form.reach * 0.6,
    y: player.y + Math.sin(angle) * form.reach * 0.6,
    r: form.reach * 0.55,
  });

  applySignature(world, spell, { x: player.x, y: player.y });
}

function castBeam(world, spell, angle) {
  const player = world.player;
  const { form, substance } = spell;
  const elements = spell.elements;
  const step = 6;
  let distance = 0;

  /* Луч идёт по шагам: так он честно останавливается о стену и по дороге
     выносит витрины, а не телепортируется в конец комнаты. */
  while (distance < form.range) {
    const x = player.x + Math.cos(angle) * distance;
    const y = player.y + Math.sin(angle) * distance;
    const tile = tileAt(world, x, y);

    if (breakable(tile)) {
      world.tiles[tileIndex(world, x, y)] = TILE.FLOOR;
      world.rebake = true;
      spark(world, x, y, angle, 2.2, 10, '#9be7ff', 200);
    } else if (blocksShot(tile)) {
      /* Луч проходит сквозь предмет, который ему по силам, и идёт дальше. */
      if (!shatter(world, tileIndex(world, x, y), substance)) break;
    }

    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      if (Math.hypot(enemy.x - x, enemy.y - y) > BODY + 2) continue;
      if (resisted(world, enemy, angle, { elements })) continue;
      killEnemy(world, enemy, angle, 'daemon', { by: 'player', weapon: 'daemon', elements });
    }

    distance += step;
  }

  world.blasts.push({
    kind: 'beam',
    x: player.x, y: player.y,
    x2: player.x + Math.cos(angle) * distance,
    y2: player.y + Math.sin(angle) * distance,
    life: 0.26, span: 0.26, colour: substance.colour,
  });

  /* Полоса начинается на шаг вперёд: луч огня, кладущий пожар себе под
     ноги, наказывал бы за самую очевидную очередь из трёх одинаковых. */
  const from = 26;
  const sign = spell.signature;

  if (distance > from) {
    land(world,
      tilesAlongLine(world,
        player.x + Math.cos(angle) * from, player.y + Math.sin(angle) * from,
        player.x + Math.cos(angle) * distance, player.y + Math.sin(angle) * distance),
      substance,
      { x: player.x + Math.cos(angle) * distance, y: player.y + Math.sin(angle) * distance },
      Boolean(sign && sign.paintBeam));
  }

  /* РАЗРЯДНИК бьёт не в конце линии, а с каждого её шага: луч, идущий
     над лужей, поднимает всю лужу разом. */
  if (sign && sign.chainAlong) {
    for (let along = from; along < distance; along += TILE_SIZE) {
      discharge(world, player.x + Math.cos(angle) * along, player.y + Math.sin(angle) * along,
        substance);
    }
  }

  applySignature(world, spell, { x: player.x, y: player.y });
}

/*
 * Вспышка бьёт по кругу и не разбирает своих. В тесноте она отражается от
 * стен и достаёт того, кто её выпустил, — это не наказание, а плата за
 * кнопку паники, и в игре, где смерть стоит полсекунды, такая смерть
 * скорее смешная, чем обидная.
 */
/*
 * Вспышка. Без ветра в составе она рвёт там, где стоишь, — и в тесноте
 * достаёт своего же.
 *
 * С ветром её уносит вперёд, и это не поблажка, а следствие правила
 * «состав решает вещество». Тройной состав всегда даёт вспышку — узор
 * «три разные» другой формы не знает, — и без этого десять самых
 * интересных веществ оказывались одной и той же кнопкой паники: ГРОЗУ и
 * БУРЮ нельзя было бросить, только подорвать под ногами. Носителем стал
 * ветер, потому что он и так отвечает за дальность: чему быть унесённым,
 * видно прямо по составу, а не по заученному списку.
 */
function castNova(world, spell) {
  const player = world.player;

  if (spell.substance.traits.gust) {
    const angle = player.angle;
    world.bullets.push({
      x: muzzle(world, player.x, player.y, angle).x,
      y: muzzle(world, player.x, player.y, angle).y,
      vx: Math.cos(angle) * 430,
      vy: Math.sin(angle) * 430,
      from: 'player',
      weapon: 'daemon',
      ox: player.x,
      oy: player.y,
      elements: spell.elements,
      substance: spell.substance,
      nova: spell,
      pierce: 0,
      breaks: Boolean(spell.form.breaks),
      colour: spell.substance.colour,
      life: 0.55,
    });
    world.events.push({ type: 'nova-thrown' });
    return;
  }

  novaAt(world, spell, player.x, player.y, true);
}

function novaAt(world, spell, x, y, atFeet) {
  const player = world.player;
  const { form, substance } = spell;
  const elements = spell.elements;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    if (Math.hypot(dx, dy) > form.radius) continue;
    if (!hasSight(world, x, y, enemy.x, enemy.y)) continue;
    const toEnemy = Math.atan2(dy, dx);
    if (resisted(world, enemy, toEnemy, { elements })) continue;
    killEnemy(world, enemy, toEnemy, 'daemon', { by: 'player', weapon: 'daemon', elements });
  }

  /*
   * Кого достало — решается до того, как вещество ляжет на пол. Иначе
   * вспышка ставит облако пара и им же закрывает себе проверку попадания:
   * брошенный в упор ТУМАН оставлял бросившего живым, потому что тот
   * оказывался за собственным паром. Свой дым не защищает от своего удара.
   */
  const caughtSelf = !atFeet && player.alive
    && Math.hypot(player.x - x, player.y - y) <= form.radius
    && hasSight(world, x, y, player.x, player.y);

  world.blasts.push({
    kind: 'nova', x, y,
    radius: form.radius, life: 0.3, span: 0.3, colour: '#ffffff', tint: substance.colour,
  });

  land(world, tilesInCircle(world, x, y, form.radius), substance,
    { x, y, r: form.radius * 0.8 });

  applySignature(world, spell, { x, y });

  /*
   * Брошенная вспышка своих не разбирает так же, как и та, что рвётся под
   * ногами: подошёл слишком близко к месту разрыва — сам виноват. Без
   * этого «унести ветром» превращалось бы в способ обойти единственную
   * цену, которая у вспышки есть.
   */
  if (!atFeet) {
    if (caughtSelf) {
      world.events.push({ type: 'backfire' });
      killPlayer(world, Math.atan2(player.y - y, player.x - x));
    }
    return;
  }

  /*
   * Отражение считается по соседним клеткам, а не лучами: восемь соседей
   * вокруг той клетки, где стоишь. Четыре стены и больше — теснота, волну
   * возвращает. Коридор и дверной проём набирают четыре и шесть, угол
   * комнаты — три, и поэтому в углу вспышка безопасна.
   *
   * Считаются только стены: мебель низкая, волна идёт поверх, и смерть от
   * стола выглядела бы случайной, а не заслуженной.
   */
  const cx = Math.floor(x / TILE_SIZE);
  const cy = Math.floor(y / TILE_SIZE);
  let walls = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      const tile = (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h)
        ? TILE.WALL
        : world.tiles[ny * world.w + nx];
      if (tile === TILE.WALL) walls += 1;
    }
  }

  if (walls >= 4) {
    world.events.push({ type: 'backfire' });
    killPlayer(world, Math.random() * Math.PI * 2);
  }
}


/* =========================================================
   СЛЕД ВЕЩЕСТВА
   =========================================================
   Заклинание не заканчивается попаданием. Всё, что вещество
   умеет после — лужа, пожар, лёд, пар, разряд по воде, —
   собрано здесь, а сами правила встречи живут в field.js.
   ========================================================= */

/*
 * Вещество ложится на пол там, где форма закончилась. Точку даёт форма,
 * потому что только она знает, где закончилась: снаряд — где упал, выдох —
 * по всему конусу, луч — вдоль линии.
 */
function land(world, tiles, substance, at, force = false) {
  /* Сперва предметы: бочка обязана вскрыться до того, как на её клетку
     ляжет вещество, иначе вода разольётся под целой бочкой. */
  for (const idx of tiles) shatter(world, idx, substance);

  paint(world, tiles, substance, at, force);
  if (substance.traits.shock && at) discharge(world, at.x, at.y, substance);
}

/*
 * Предмет ломается только своим веществом — и ломается насовсем, оставляя
 * после себя не пустоту, а последствие. В этом весь смысл: бочка не
 * «препятствие, которое убрали», а способ налить воды туда, куда сам не
 * дотянешься.
 *
 * Проверяется черта, а не стихия. Лаву и жар роднит огонь, и оба вскрывают
 * бочку; перечислять составы поимённо значило бы править этот список при
 * каждой новой смеси.
 */
/*
 * ОТЛОЖЕННЫЕ ШАГИ
 * =========================================================
 * Цепочка из бочки — главный ход игры: одно нажатие, три следствия.
 * Пока все три случались в одном кадре, игрок видел только результат:
 * все умерли. Причина была не видна, а значит и не читалась как своя
 * заслуга. Поэтому следствия разложены по времени и идут по очереди:
 * бочку вскрыло, вода разошлась, разряд добежал, тела задёргались.
 *
 * Очередь живёт внутри мира и умирает вместе с ним: перезапуск этажа
 * не может донести до нового мира чужой взрыв.
 */
/* Скорость, с которой разряд бежит по воде, и сколько тело дёргается,
   прежде чем упасть. Обе величины про читаемость, а не про баланс: ниже
   них цепочка снова слипается в один кадр. */
const ARC_SPEED = 900;
const STUN_TIME = 0.18;

function schedule(world, delay, run) {
  world.beats.push({ left: delay, run });
}

function runBeats(world, dt) {
  if (!world.beats.length || dt <= 0) return;

  /* Шаг может поставить следующий — он попадёт уже в новый кадр. */
  const due = [];
  world.beats = world.beats.filter((beat) => {
    beat.left -= dt;
    if (beat.left > 0) return true;
    due.push(beat);
    return false;
  });

  for (const beat of due) beat.run();
}

function shatter(world, at, substance) {
  if (at < 0 || at >= world.tiles.length) return false;

  const tile = world.tiles[at];
  if (!substance || !brokenBy(tile, substance.traits)) return false;

  const x = ((at % world.w) + 0.5) * TILE_SIZE;
  const y = (((at / world.w) | 0) + 0.5) * TILE_SIZE;

  world.tiles[at] = TILE.FLOOR;
  world.rebake = true;
  world.fx.shake = Math.max(world.fx.shake, 5);

  if (tile === TILE.BARREL) {
    /* Сначала — только грохот и осколки. Воды ещё нет. */
    spark(world, x, y, 0, 3.2, 14, '#7fe6ff', 150);
    emitNoise(world, x, y, 260, 'barrel');
    world.events.push({ type: 'barrel', x, y });
    world.fx.hitstop = Math.max(world.fx.hitstop, 0.05);

    /*
     * Вода расходится двумя кольцами, а не появляется готовой лужей:
     * игрок должен успеть увидеть, что она течёт под ноги врагу. Льётся
     * она на соседние клетки, а не только на свою — лужа в одну клетку
     * никого не поймает, и бочка была бы просто мусором.
     */
    for (let ring = 0; ring < 4; ring += 1) {
      const radius = TILE_SIZE * (0.55 + ring * 0.4);
      schedule(world, 0.09 + ring * 0.09, () => {
        paint(world, tilesInCircle(world, x, y, radius), SPILL, { x, y }, true);
        splash(world, x, y, radius);
        if (ring === 3) world.events.push({ type: 'spill', x, y });
      });
    }

    /*
     * Разряд, вскрывший бочку, идёт по той воде, которую сам и вылил, —
     * но идёт последним, когда воде уже есть где стоять. Это тот самый
     * ход, ради которого бочка в игре и стоит: одно нажатие, три
     * следствия, и все три видно по очереди.
     */
    /*
     * Разряд ждёт, пока вода дотечёт. Кольца ложатся до 0.36 секунды, и
     * удар раньше этого бил по недоразлитой луже: крайние оставались
     * сухими и выживали. Порядок здесь не украшение — он и есть правило.
     */
    if (substance.traits.shock) {
      schedule(world, 0.5, () => discharge(world, x, y, substance));
    }
    return true;
  }

  if (tile === TILE.HAY) {
    /*
     * Стог не просто исчезает — он загорается, и вместе с ним всё вокруг.
     * В этом его смысл: солома стоит там, где за ней прячутся, и укрытие
     * превращается в костёр вместе со стоящими рядом.
     *
     * И солома поджигает солому: одной искры в край копны хватает, чтобы
     * занялась вся. Без этого копна была бы девятью отдельными кустами, а
     * поджог — девятью выстрелами; с этим она становится одной ловушкой,
     * которую готовят заранее. Рекурсия конечна: клетка гасится в пол до
     * того, как разойдётся дальше.
     */
    paint(world, tilesInCircle(world, x, y, TILE_SIZE * 1.3), FLARE, { x, y }, true);
    spark(world, x, y, 0, 3.2, 16, '#ffb347', 200);
    emitNoise(world, x, y, 300, 'hay');
    world.events.push({ type: 'hay', x, y });

    const tx = at % world.w;
    const ty = (at / world.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      shatter(world, ny * world.w + nx, FLARE);
    }
    return true;
  }

  if (tile === TILE.CRYSTAL) {
    /* Кристалл берёт молния — и сам отдаёт её обратно: разряд идёт по
       всему, что рядом мокрое. Это ловушка, работающая на обе стороны. */
    spark(world, x, y, 0, 3.2, 16, '#fff2a8', 220);
    emitNoise(world, x, y, 320, 'crystal');
    world.events.push({ type: 'crystal', x, y });
    discharge(world, x, y, JOLT);
    return true;
  }

  spark(world, x, y, 0, 3.2, 12, '#c9a27a', 170);
  emitNoise(world, x, y, 240, 'boulder');
  world.events.push({ type: 'boulder', x, y });
  return true;
}

/*
 * Толчок сигнатуры. Тела двигает через ту же оглушку, что и сорванный
 * щит: у неё уже есть и трение, и проверка стен, а второй способ двигать
 * тело означал бы второй способ пройти сквозь стену.
 *
 * Игрока толчок не трогает: он тут центр, а не цель. Своя же ХВАТКА,
 * стягивающая самого себя, читалась бы как поломка, а не как цена.
 */
function impulse(world, x, y, radius, strength) {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius || dist < 1) continue;
    if (!hasSight(world, x, y, enemy.x, enemy.y)) continue;

    /* Ближних кидает сильнее — иначе дальний край работает так же, как
       вплотную, и у заклинания пропадает форма. */
    const fall = 1 - dist / radius;
    const push = (strength * (0.45 + fall * 0.55)) / dist;
    enemy.vx = dx * push;
    enemy.vy = dy * push;
    enemy.stagger = Math.max(enemy.stagger || 0, 0.35);
    enemy.shove = 0.35;
  }
}

/* Сигнатура — набор флагов; здесь они превращаются в действие. */
function applySignature(world, spell, at) {
  const sign = spell.signature;
  if (!sign) return;

  const player = world.player;
  const reach = spell.form.reach || spell.form.radius || 140;

  if (sign.pull) impulse(world, player.x, player.y, reach * 3, -sign.pull);
  if (sign.push) impulse(world, player.x, player.y, reach * 2.6, sign.push);
  if (sign.bigCloud) {
    addCloud(world, player.x, player.y, reach * sign.bigCloud, 'steam');
  }
}

/*
 * Разряд по воде. Сначала под током оказывается вся связная лужа, потом
 * ток перескакивает на мокрых рядом и с них дальше.
 *
 * Своих цепь не разбирает — как и вспышка. Стоять в собственной луже,
 * пуская в неё молнию, это ровно то решение, за которое игра обязана
 * спросить: иначе «намочи и ударь» превратилось бы в бесплатную кнопку.
 */
function discharge(world, x, y, substance) {
  const live = conductedTiles(world, x, y);
  const bodies = [world.player, ...world.enemies].filter((body) => body.alive);
  const hit = new Set();
  const queue = [{ x, y }];

  for (const body of bodies) {
    if (live.has(groundIndex(world, body.x, body.y))) { hit.add(body); queue.push(body); }
  }

  while (queue.length) {
    const from = queue.shift();
    for (const body of bodies) {
      if (hit.has(body) || !conducts(world, body)) continue;
      if (Math.hypot(body.x - from.x, body.y - from.y) > CHAIN_HOP) continue;
      hit.add(body);
      queue.push(body);
    }
  }

  if (!hit.size) return;

  /* Треск идёт сразу: он и есть предупреждение тем, кто стоит в воде. */
  world.events.push({ type: 'chain', size: hit.size });
  world.fx.flash = Math.max(world.fx.flash, 0.2);

  /*
   * Сначала светится земля. Ток идёт по воде, а не по воздуху, и порядок
   * «залило → зарядило → ударило» игрок должен видеть глазами, а не
   * достраивать в уме: без светящейся лужи посередине выходит, что
   * молния убила троих через полкомнаты неизвестно как.
   *
   * Фронт бежит наружу от точки удара с той же скоростью, с какой
   * назначены удары по телам, — поэтому свет добегает до врага ровно
   * тогда, когда врага бьёт.
   */
  world.charged = { tiles: live, x, y, life: 0.5, max: 0.5 };

  for (const body of hit) {
    const angle = Math.atan2(body.y - y, body.x - x);

    /*
     * Разряд не возникает всюду разом — он добегает. Дальний в луже
     * дёргается позже ближнего, и по этой задержке видно, что убило их
     * одно и то же, а не пять отдельных случайностей.
     */
    const travel = Math.min(0.3, Math.hypot(body.x - x, body.y - y) / ARC_SPEED);

    schedule(world, travel, () => {
      if (!body.alive) return;

      /*
       * Сначала бьёт — тело дёргается. Смерть приходит следом.
       * Оглушение берётся то же самое, что у сорванного щита: оно уже
       * выключает управление, и врага не должно тянуть стрелять в момент,
       * когда его бьёт током.
       */
      body.zap = Math.max(body.zap || 0, STUN_TIME);
      if (body !== world.player) {
        body.stagger = Math.max(body.stagger || 0, STUN_TIME);
      }
      spark(world, body.x, body.y, angle, 2.4, 9, '#9fe8ff', 130);
      world.fx.shake = Math.max(world.fx.shake, 3);

      schedule(world, STUN_TIME, () => {
        if (!body.alive) return;
        if (body === world.player) {
          world.events.push({ type: 'shocked-self' });
          killPlayer(world, angle);
          return;
        }
        if (resisted(world, body, angle, { elements: substance.elements })) return;
        killEnemy(world, body, angle, 'chain',
          { by: 'player', weapon: 'daemon', elements: substance.elements });
      });
    });
  }
}

/*
 * Что пол делает с телом. Лёд не убивает, но отнимает управление —
 * поэтому он ценен обеим сторонам: по нему одинаково несёт и врага, и
 * того, кто его настелил.
 */
function footing(world, body) {
  const ground = groundAt(world, body.x, body.y);
  if (ground === GROUND.MUD) return { pace: 0.55, grip: 1 };
  if (ground === GROUND.ICE) return { pace: 1.12, grip: 0.16 };
  return { pace: 1, grip: 1 };
}

/*
 * Мокрое и горящее. Огонь не убивает мгновенно: горящий бежит и умирает
 * на бегу, и всё это время у него есть выход — лужа. Мгновенная смерть от
 * пола была бы честнее по букве правила «все умирают с одного касания», но
 * отняла бы у воды единственное применение, ради которого её набирают.
 */
function scorch(world, body, dt) {
  body.wet = Math.max(0, (body.wet || 0) - dt);

  const ground = groundAt(world, body.x, body.y);

  if (ground === GROUND.WATER || ground === GROUND.MUD) {
    body.wet = WET_TIME;
    if (body.burning > 0) {
      body.burning = 0;
      addCloud(world, body.x, body.y, TILE_SIZE, 'steam');
      world.events.push({ type: 'doused' });
    }
  }

  /* Стойкий к огню в огне не горит: это та же стойкость, просто пол. */
  if (!body.burning && !body.wet && burningAt(world, body.x, body.y)
      && !resists(body, ['fire'])) {
    body.burning = BURN_TIME;
    world.events.push({ type: 'ignite', player: body === world.player });
  }

  if (body.burning > 0) {
    body.burning -= dt;
    if (body.burning <= 0) {
      body.burning = 0;
      const angle = Math.random() * Math.PI * 2;
      if (body === world.player) killPlayer(world, angle);
      else killEnemy(world, body, angle, 'fire',
        { by: 'player', weapon: 'daemon', elements: ['fire'] });
    }
  }
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

  runBeats(world, dt);

  if (world.charged) {
    world.charged.life -= dt;
    if (world.charged.life <= 0) world.charged = null;
  }

  /* Метка «бьёт током» гаснет сама — её носят и живые, и игрок. */
  world.player.zap = Math.max(0, (world.player.zap || 0) - dt);
  for (const enemy of world.enemies) enemy.zap = Math.max(0, (enemy.zap || 0) - dt);

  if (world.state === 'play') world.time += dt;

  updateField(world, dt);
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

  /*
   * Набор демона стоит скорости, замах луча — почти всей. Это и есть та
   * ставка, ради которой очередь вообще нужна: чем длиннее, тем дольше
   * стоишь на виду.
   */
  const stand = footing(world, player);
  scorch(world, player, dt);
  if (!player.alive) return;

  const pace = (player.windup > 0 ? 0.35 : (player.chargeLeft > 0 ? 0.55 : 1)) * stand.pace;
  const speed = PLAYER_SPEED * pace;

  const wish = Math.hypot(intent.moveX, intent.moveY);
  const targetX = wish > 0.001 ? (intent.moveX / Math.max(1, wish)) * speed : 0;
  const targetY = wish > 0.001 ? (intent.moveY / Math.max(1, wish)) * speed : 0;

  const accel = PLAYER_ACCEL * stand.grip;
  player.vx += clamp(targetX - player.vx, -accel * dt, accel * dt);
  player.vy += clamp(targetY - player.vy, -accel * dt, accel * dt);

  moveBody(world, player, player.vx * dt, player.vy * dt);

  player.step += Math.hypot(player.vx, player.vy) * dt;
  if (player.step > 26) {
    player.step = 0;
    emitNoise(world, player.x, player.y, 58, 'step');
    world.events.push({ type: 'step' });
  }

  if (intent.aimAngle !== null && intent.aimAngle !== undefined) {
    player.angle = intent.aimAngle;
  } else if (wish > 0.1) {
    player.angle = turnToward(player.angle, Math.atan2(player.vy, player.vx), dt * 14);
  }

  player.cooldown = Math.max(0, player.cooldown - dt);
  player.swing = Math.max(0, player.swing - dt);
  player.swingHit = Math.max(0, (player.swingHit || 0) - dt);
  player.flash = Math.max(0, (player.flash || 0) - dt);

  /* Луч на замахе: линию уже видно, отменить нельзя. */
  if (player.windup > 0) {
    player.windup -= dt;
    if (player.windup <= 0 && player.pending) {
      const pending = player.pending;
      player.pending = null;
      castForm(world, pending);
    }
    return;
  }

  /* Сброс набранного: время уже потрачено, но выпустить не туда — хуже. */
  if (intent.dump && (player.stack.length || player.chargeLeft > 0)) {
    player.stack = [];
    player.charging = null;
    player.chargeLeft = 0;
    world.events.push({ type: 'dump' });
  }

  /* Стихии, которой этаж не даёт, у игрока просто нет. Молча — плохо:
     он решит, что кнопка не сработала, а не что стихия не его. */
  if (intent.charge && !world.elements.includes(intent.charge)) {
    world.events.push({ type: 'locked', element: intent.charge });
    intent.charge = null;
  }

  if (intent.charge && player.stack.length < STACK_LIMIT && player.chargeLeft <= 0) {
    player.charging = intent.charge;
    player.chargeLeft = CHARGE_STEP;
    world.events.push({ type: 'charge-start', element: intent.charge });
  }

  if (player.chargeLeft > 0) {
    player.chargeLeft -= dt;
    if (player.chargeLeft <= 0) {
      player.stack.push(player.charging);
      player.charging = null;
      world.events.push({ type: 'charge', size: player.stack.length });
    }
  }

  if (intent.attack && player.cooldown <= 0) {
    /*
     * Удар при наборе бросает недобранную стихию и выпускает то, что уже
     * есть: остаться без ответа из-за собственного набора — худшее, что
     * тут может случиться.
     */
    if (player.chargeLeft > 0) {
      player.chargeLeft = 0;
      player.charging = null;
    }

    if (player.stack.length) {
      releaseStack(world);
    } else {
      /* Пустая очередь — единственный случай, когда удар ничего не делает. */
      player.cooldown = 0.18;
      world.events.push({ type: 'dry' });
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
  enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - dt);
  enemy.blocked = Math.max(0, (enemy.blocked || 0) - dt);

  /* Сорванный щит выключает носителя на треть секунды — окно для добивания. */
  if (enemy.stagger > 0) {
    enemy.stagger -= dt;

    /*
     * Отброшенное тело тормозит медленнее оглушённого. Разница поймана
     * прогоном: на общем торможении ХВАТКА сдвигала врага на два десятка
     * пикселей — меньше собственного роста, — и найденное заклинание не
     * делало ничего заметного. Толчок обязан быть виден, иначе его незачем
     * искать.
     */
    const drag = (enemy.shove || 0) > 0 ? 0.93 : 0.82;
    enemy.shove = Math.max(0, (enemy.shove || 0) - dt);
    enemy.vx *= drag;
    enemy.vy *= drag;
    moveBody(world, enemy, enemy.vx * dt, enemy.vy * dt);
    return;
  }

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

  const stand = footing(world, enemy);
  scorch(world, enemy, dt);
  if (!enemy.alive) return;

  const move = thinkEnemy(world, enemy, dt,
    { walk: ENEMY_WALK * stand.pace, run: ENEMY_RUN * stand.pace });

  enemy.vx = lerp(enemy.vx, move.vx, clamp(dt * 9 * stand.grip, 0, 1));
  enemy.vy = lerp(enemy.vy, move.vy, clamp(dt * 9 * stand.grip, 0, 1));
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

      /*
       * Проходимое ломается на лету. Стог не держит снаряд — сквозь него
       * можно и пройти, и выстрелить, — поэтому поджечь его можно только
       * так: проверкой на каждом шагу полёта, а не в точке остановки.
       */
      if (bullet.substance) shatter(world, tileIndex(world, bullet.x, bullet.y), bullet.substance);

      /*
       * Сигнатура следа: вещество ложится на каждом шагу полёта, а не
       * только там, где снаряд встал. Первые полторы клетки пропускаются —
       * иначе БОРОЗДА поджигает пол ровно под ногами того, кто её нашёл, и
       * награда за находку оказывается смертельной ловушкой.
       */
      if (bullet.trail && bullet.substance
        && Math.hypot(bullet.x - bullet.ox, bullet.y - bullet.oy) > TILE_SIZE * 1.5) {
        paint(world, tilesInCircle(world, bullet.x, bullet.y, TILE_SIZE * 0.6),
          bullet.substance, null);
      }

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
        /* Предмет своей стихии не держит снаряд: он от него и ломается. */
        if (bullet.substance
          && shatter(world, tileIndex(world, bullet.x, bullet.y), bullet.substance)) {
          continue;
        }

        /* Пробой сносит мебель и идёт дальше — на то он и пробой. */
        if (bullet.breaks && tile === TILE.TABLE) {
          world.tiles[tileIndex(world, bullet.x, bullet.y)] = TILE.FLOOR;
          world.rebake = true;
          spark(world, bullet.x, bullet.y, Math.atan2(sy, sx), 2, 10, '#ff9b52', 190);
          continue;
        }
        spark(world, bullet.x, bullet.y, Math.atan2(-sy, -sx), 1.1, 5, '#ffe06b', 150);
        pop(world, bullet.x, bullet.y, 5, bullet.colour ? '255,255,255' : '255,224,107');
        bullet.life = 0;
        break;
      }

      const angle = Math.atan2(sy, sx);

      if (bullet.from === 'player') {
        for (const enemy of world.enemies) {
          if (!enemy.alive) continue;
          if (Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) >= BODY + 1) continue;

          if (!resisted(world, enemy, angle, { elements: bullet.elements })) {
            killEnemy(world, enemy, angle, bullet.weapon === 'daemon' ? 'daemon' : 'bullet',
              { by: 'player', weapon: bullet.weapon, elements: bullet.elements });
          }

          if (bullet.pierce > 0) { bullet.pierce -= 1; continue; }
          bullet.life = 0;
          break;
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
          if (Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) >= BODY + 1) continue;
          if (!resisted(world, enemy, angle, { elements: bullet.elements })) {
            killEnemy(world, enemy, angle, 'bullet', { by: 'enemy', weapon: bullet.weapon });
          }
          bullet.life = 0;
        }
      }
    }

    bullet.life -= dt;

    /*
     * Снаряд кончился — вещество осталось. Одна дверь на все способы
     * кончиться (стена, тело, время), иначе половина попаданий не
     * оставляла бы следа, и правило «вещество живёт после удара»
     * работало бы через раз.
     */
    if (bullet.substance && bullet.life <= 0 && !bullet.landed) {
      bullet.landed = true;

      if (bullet.nova) {
        novaAt(world, bullet.nova, bullet.x, bullet.y, false);
      } else {
        const reach = bullet.substance.traits.reach || 1;
        land(world, tilesInCircle(world, bullet.x, bullet.y, TILE_SIZE * 0.9 * reach),
          bullet.substance, { x: bullet.x, y: bullet.y, r: TILE_SIZE * 1.2 });
      }
    }
  }

  world.bullets = world.bullets.filter((b) => b.life > 0);
}


function updateLoose(world, dt) {
  for (const ring of world.pops) ring.life -= dt;
  world.pops = world.pops.filter((ring) => ring.life > 0);

  for (const blast of world.blasts) blast.life -= dt;
  world.blasts = world.blasts.filter((blast) => blast.life > 0);

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
