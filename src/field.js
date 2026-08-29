/*
 * ТЕХНОМАГИЯ — поле: что вещество оставляет после себя.
 *
 * Ради этого модуля затевалось скрещивание. Пока заклинание живёт только
 * до попадания, состав — это выбор снаряда; как только вещество остаётся
 * на полу, состав становится ходом: вода, вылитая пять секунд назад, — это
 * заготовка под молнию, а собственный пожар — стена, которую сам же и
 * поставил.
 *
 * Здесь только поле и правила встречи веществ. Смертей тут нет: кого
 * убило — решает world.js, потому что смерть тянет за собой счёт, трупы,
 * тревогу и тряску кадра, и тащить всё это сюда значило бы переписать
 * половину мира ради лужи.
 *
 * Пожар намеренно не расползается. Расползающийся огонь превращает бой в
 * лотерею: ты уже не знаешь, где будет безопасно через секунду, и любая
 * тактика вырождается в «беги от карты». Огонь остаётся там, куда его
 * положили, — и потому им можно пользоваться как стеной.
 */

import { TILE_SIZE, blocksMove } from './level.js';

export const GROUND = {
  NONE: 0,
  WATER: 1,  /* лужа: мочит, проводит молнию, тушит горящего */
  FIRE: 2,   /* пожар: поджигает всех, кто в нём стоит */
  ICE: 3,    /* лёд: не убивает, но по нему разгоняет и заносит */
  MUD: 4,    /* грязь: вязнут все, зато не горит */
};

export const GROUND_INFO = {
  [GROUND.WATER]: { name: 'ЛУЖА',  colour: '#2f7fa8', life: 12 },
  [GROUND.FIRE]:  { name: 'ПОЖАР', colour: '#ff6a2a', life: 6 },
  [GROUND.ICE]:   { name: 'ЛЁД',   colour: '#9fe8ff', life: 10 },
  [GROUND.MUD]:   { name: 'ГРЯЗЬ', colour: '#6d5c34', life: 14 },
};

/*
 * Пол разгорается не мгновенно. Без этой задержки вспышка с огнём в
 * составе была бы всегда самоубийством — вещество ложится в том числе под
 * ноги тому, кто её выпустил, — и игрок просто перестал бы набирать такие
 * составы. Треть секунды не спасает зеваку, но даёт уйти тому, кто знал,
 * что делает.
 */
export const FIRE_CATCH = 0.35;

/* Горящий бежит и умирает на бегу. Успеет добраться до воды — потушится. */
export const BURN_TIME = 0.7;

/* Сколько тело остаётся мокрым, выйдя из лужи. Мокрый не горит и проводит. */
export const WET_TIME = 3;

/* Дальше этого цепь не перескакивает: молния должна быть наградой за
   подготовленную лужу, а не бесплатной зачисткой этажа. */
export const CHAIN_HOP = TILE_SIZE * 2.2;
const CHAIN_TILES = 90;


/*
 * Вещества, которые рождаются не из очереди игрока. Бочка разливает воду,
 * кристалл бьёт разрядом — у обоих нет автора и нет состава, но правила
 * поля для них те же самые. Собраны как настоящие вещества, чтобы не
 * заводить второй путь для того же самого.
 */
export const SPILL = {
  id: 'spill', name: 'ВОДА', elements: ['water'], pure: false,
  colour: '#4de1ff', traits: { reach: 1, speed: 1, wet: 1, douse: 1 },
};

export const JOLT = {
  id: 'jolt', name: 'РАЗРЯД', elements: ['bolt'], pure: false,
  colour: '#ffe14d', traits: { reach: 1, speed: 1, shock: 1 },
};

export function createField(world) {
  const size = world.w * world.h;
  world.ground = new Uint8Array(size);
  world.groundLife = new Float32Array(size);
  world.groundAge = new Float32Array(size);
  world.clouds = [];
}

export function groundIndex(world, x, y) {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return -1;
  return ty * world.w + tx;
}

export function groundAt(world, x, y) {
  const at = groundIndex(world, x, y);
  return at < 0 ? GROUND.NONE : world.ground[at];
}

/* Горит по-настоящему только разгоревшееся: см. FIRE_CATCH. */
export function burningIndex(world, at) {
  if (at < 0 || world.ground[at] !== GROUND.FIRE) return false;
  return world.groundAge[at] >= FIRE_CATCH;
}

export function burningAt(world, x, y) {
  return burningIndex(world, groundIndex(world, x, y));
}


/* =========================================================
   ВСТРЕЧА ВЕЩЕСТВ
   ========================================================= */

/*
 * Что кладёт на пол вещество — по чертам, а не по имени: так новая смесь
 * получает след сама, стоит ей заявить черту.
 *
 * Одна стихия своего не оставляет. Это поймал прогон: пока чистый огонь
 * клал пожар с каждого плевка, самый дешёвый и самый частый ответ засеивал
 * смертью ту самую дорогу, по которой игрок и шёл дальше, — бот сгорел в
 * своём же следе на второй минуте. Отсюда правило, и оно же оказалось тем,
 * ради чего затевалось скрещивание:
 *
 *   одна стихия — это удар, две и больше — вещество.
 *
 * Менять то, что уже лежит, одной стихии по-прежнему хватает: вода тушит
 * пожар, огонь выпаривает лужу и топит лёд. Не хватает — только чтобы
 * оставить своё.
 */
function groundFor(substance) {
  if (substance.pure) return GROUND.NONE;
  return groundForced(substance);
}

/*
 * То же самое, но без запрета на чистую стихию. Сюда ходят только
 * сигнатуры: найденное заклинание имеет право быть исключением из
 * общего правила — на том и держится смысл искать.
 */
function groundForced(substance) {
  const t = substance.traits;
  if (t.freeze) return GROUND.ICE;
  if (t.mire) return GROUND.MUD;
  if (t.burn) return GROUND.FIRE;
  if (t.wet) return GROUND.WATER;
  return GROUND.NONE;
}

/*
 * Главная таблица игры: что происходит, когда вещество ложится на то, что
 * уже лежит. Читается как правило природы, а не как список исключений, —
 * и именно поэтому её можно не заучивать: огонь и вода дают пар, мороз
 * превращает лужу в лёд, огонь растапливает лёд обратно в лужу.
 *
 * Возвращает новый тип клетки; облако (если родилось) уходит вызывающему.
 */
function meet(was, laid, substance) {
  const t = substance.traits;

  /* Тушит всё, что гасит огонь: вода, грязь, мороз и сам пар. */
  const douses = t.douse || t.wet || t.mire || t.freeze;

  if (was === GROUND.FIRE && douses) return { ground: laid === GROUND.FIRE ? GROUND.NONE : laid, steam: true };
  if (was === GROUND.FIRE && t.steam) return { ground: GROUND.NONE, steam: true };

  if (was === GROUND.WATER && t.burn) return { ground: GROUND.NONE, steam: true };
  if (was === GROUND.WATER && t.freeze) return { ground: GROUND.ICE, steam: false };

  if (was === GROUND.ICE && t.burn) return { ground: GROUND.WATER, steam: true };

  /* Грязь не горит — этим она и полезна: полосой грязи закрывают проход
     от чужого огня, и это единственное укрытие от него в игре. */
  if (was === GROUND.MUD && laid === GROUND.FIRE) return { ground: GROUND.MUD, steam: false };

  if (laid === GROUND.NONE) return { ground: was, steam: false };
  return { ground: laid, steam: false };
}

/*
 * Нанести вещество на клетки. Вызывающий даёт список клеток — круг,
 * конус или линию он посчитал сам, потому что форму он и так знает.
 */
export function paint(world, tiles, substance, at = null, force = false) {
  const laid = force ? groundForced(substance) : groundFor(substance);
  const t = substance.traits;

  /*
   * Уйти сразу можно только тому, кто не умеет ни оставить своё, ни
   * изменить чужое: ветер, земля и молния по голому полу проходят
   * бесследно. Огонь без смеси своего не оставит, но лужу выпарит и лёд
   * растопит — и потому до таблицы встреч он обязан дойти.
   */
  const reacts = t.burn || t.douse || t.wet || t.mire || t.freeze || t.steam;
  if (laid === GROUND.NONE && !reacts) return;

  let steamed = false;

  for (const idx of tiles) {
    if (idx < 0 || idx >= world.ground.length) continue;
    if (blocksMove(world.tiles[idx])) continue;

    const result = meet(world.ground[idx], laid, substance);
    if (result.steam) steamed = true;

    if (result.ground === world.ground[idx] && result.ground !== GROUND.NONE) {
      /* Своё на своём — не новый слой, а продление: лужа поверх лужи
         должна освежать лужу, а не мигать. */
      world.groundLife[idx] = Math.max(world.groundLife[idx], lifeOf(result.ground, substance));
      continue;
    }

    world.ground[idx] = result.ground;
    world.groundLife[idx] = result.ground === GROUND.NONE ? 0 : lifeOf(result.ground, substance);
    world.groundAge[idx] = 0;
  }

  if ((steamed || (t.steam && !substance.pure)) && at) {
    addCloud(world, at.x, at.y, at.r || TILE_SIZE * 1.6, 'steam');
  } else if (t.shred && at) {
    addCloud(world, at.x, at.y, at.r || TILE_SIZE * 1.4, 'dust');
  }
}

function lifeOf(ground, substance) {
  const base = GROUND_INFO[ground] ? GROUND_INFO[ground].life : 0;
  /* Лава и вулкан горят вдвое дольше — за то и платят дальностью. */
  return substance.traits.lasting ? base * 2 : base;
}


/* =========================================================
   НАБОРЫ КЛЕТОК ПОД ФОРМЫ
   ========================================================= */

export function tilesInCircle(world, cx, cy, radius) {
  const out = [];
  const r = Math.ceil(radius / TILE_SIZE);
  const tx = Math.floor(cx / TILE_SIZE);
  const ty = Math.floor(cy / TILE_SIZE);

  for (let y = ty - r; y <= ty + r; y += 1) {
    for (let x = tx - r; x <= tx + r; x += 1) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const px = x * TILE_SIZE + TILE_SIZE / 2;
      const py = y * TILE_SIZE + TILE_SIZE / 2;
      if (Math.hypot(px - cx, py - cy) > radius) continue;
      out.push(y * world.w + x);
    }
  }

  return out;
}

export function tilesInCone(world, cx, cy, angle, reach, arc) {
  const out = [];
  for (const idx of tilesInCircle(world, cx, cy, reach)) {
    const x = (idx % world.w) * TILE_SIZE + TILE_SIZE / 2;
    const y = ((idx / world.w) | 0) * TILE_SIZE + TILE_SIZE / 2;
    let d = Math.atan2(y - cy, x - cx) - angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= arc / 2) out.push(idx);
  }
  return out;
}

export function tilesAlongLine(world, x1, y1, x2, y2, width = TILE_SIZE * 0.7) {
  const seen = new Set();
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (TILE_SIZE / 2)));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    for (const idx of tilesInCircle(world, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width)) {
      seen.add(idx);
    }
  }

  return [...seen];
}


/* =========================================================
   ЦЕПЬ
   ========================================================= */

/*
 * Разряд идёт по воде. Сначала растекается по связной луже — вся она под
 * током разом, — потом перескакивает на мокрых рядом и с них дальше.
 *
 * Кого убило, решает world.js: сюда возвращается только список тел.
 */
export function conductedTiles(world, x, y) {
  const start = groundIndex(world, x, y);
  const hit = new Set();
  if (start < 0 || world.ground[start] !== GROUND.WATER) return hit;

  const queue = [start];
  hit.add(start);

  while (queue.length && hit.size < CHAIN_TILES) {
    const at = queue.shift();
    const ax = at % world.w;
    const ay = (at / world.w) | 0;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ax + dx;
      const ny = ay + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const idx = ny * world.w + nx;
      if (hit.has(idx) || world.ground[idx] !== GROUND.WATER) continue;
      hit.add(idx);
      queue.push(idx);
    }
  }

  return hit;
}

/* Мокрое тело или тело в луже — проводник. Сухой на сухом полу цепь рвёт. */
export function conducts(world, body) {
  return (body.wet || 0) > 0 || groundAt(world, body.x, body.y) === GROUND.WATER;
}


/* =========================================================
   ОБЛАКА
   ========================================================= */

/*
 * Пар и пыль не убивают — они прячут. В игре, где враг стреляет, едва
 * увидев, «тебя не видно» стоит дороже урона, и это единственное, что
 * умеет вещество без смертельной черты.
 */
export function addCloud(world, x, y, r, kind) {
  world.clouds.push({ x, y, r, kind, life: kind === 'dust' ? 2.6 : 4.2, span: kind === 'dust' ? 2.6 : 4.2 });
}

export function cloudsBlock(world, ax, ay, bx, by) {
  if (!world.clouds.length) return false;

  for (const cloud of world.clouds) {
    if (cloud.life < 0.5) continue;      /* редеющее облако уже не прячет */

    /* Расстояние от центра облака до отрезка взгляда. */
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((cloud.x - ax) * dx + (cloud.y - ay) * dy) / len2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;

    if (Math.hypot(cloud.x - px, cloud.y - py) < cloud.r * 0.8) return true;
  }

  return false;
}


/* =========================================================
   ШАГ ПОЛЯ
   ========================================================= */

export function updateField(world, dt) {
  const ground = world.ground;

  for (let i = 0; i < ground.length; i += 1) {
    if (!ground[i]) continue;
    world.groundAge[i] += dt;
    world.groundLife[i] -= dt;
    if (world.groundLife[i] <= 0) {
      /* Лёд не исчезает, а тает: после него остаётся лужа, и следующая
         молния об этом помнит. Так поле живёт дольше одного заклинания. */
      const melts = ground[i] === GROUND.ICE;
      ground[i] = melts ? GROUND.WATER : GROUND.NONE;
      world.groundLife[i] = melts ? GROUND_INFO[GROUND.WATER].life * 0.5 : 0;
      world.groundAge[i] = 0;
    }
  }

  for (const cloud of world.clouds) cloud.life -= dt;
  world.clouds = world.clouds.filter((cloud) => cloud.life > 0);
}
