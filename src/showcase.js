/*
 * СЦЕНА ДЛЯ ВИТРИНЫ
 * =========================================================
 * Игра даёт снаряд, витрина стреляет. Здесь ставится сцена и отдаются
 * рычаги: шаг, отрисовка, состояние. Снимает её другой.
 *
 * Что показываем — решено не вкусом. На карточке сейчас пустое зелёное
 * поле с фигурой в двенадцать пикселей, по которому нельзя понять, во что
 * играют. А отличает эту игру от всех соседних по витрине ровно одно:
 * следствие остаётся в мире и работает дальше само. Вода растекается,
 * разряд идёт по разлитой воде, тела падают по очереди.
 *
 * Статичный кадр этого показать не может в принципе: там нечего снимать,
 * пока не пошло время. Петля может.
 *
 * Сцена детерминирована: свой сид, руками расставленные участники,
 * остановленный цикл игры. Два прогона дают одинаковые кадры — без этого
 * нельзя отступить назад и переснять тот же момент.
 */

import { createWorld, update, TILE_SIZE } from './world.js';
import { TILE } from './level.js';

/* Свой источник случайности на время съёмки. Тот же сид — тот же кадр. */
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/*
 * Сцена ставится своими руками на свободном месте, а не подстраивается под
 * то, как расставлен этаж. Первая попытка брала бочку прямо с уровня — и
 * та стояла у самой стены: половина кадра уходила в пустой газон, а игрок
 * не помещался вовсе. Композиция — часть сцены, а не то, что достанется.
 *
 * Место ищется, а не вбивается: прямоугольник чистого пола ближе к
 * середине карты. Вбитые координаты пережили бы ровно одну правку этажа.
 */
function openSpot(world, wide, tall) {
  const midX = world.w / 2;
  const midY = world.h / 2;
  let best = null;
  let bestGap = Infinity;

  for (let ty = 1; ty + tall < world.h - 1; ty += 1) {
    for (let tx = 1; tx + wide < world.w - 1; tx += 1) {
      let clear = true;
      for (let y = ty; y < ty + tall && clear; y += 1) {
        for (let x = tx; x < tx + wide && clear; x += 1) {
          if (world.tiles[y * world.w + x] !== TILE.FLOOR) clear = false;
        }
      }
      if (!clear) continue;

      const gap = Math.hypot(tx + wide / 2 - midX, ty + tall / 2 - midY);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = { tx, ty };
    }
  }

  return best;
}

export function createShowcase(level, renderer, hooks = {}) {
  const world = createWorld(level);

  const spot = openSpot(world, 7, 5);
  if (!spot) throw new Error('на этаже нет чистого места под сцену');

  /* Бочка в середине найденного места, трое под ней, игрок слева. */
  const bx = (spot.tx + 3.5) * TILE_SIZE;
  const by = (spot.ty + 1.5) * TILE_SIZE;
  world.tiles[(spot.ty + 1) * world.w + spot.tx + 3] = TILE.BARREL;
  world.rebake = true;

  const cast = world.enemies.filter((enemy) => enemy.alive).slice(0, 3);
  if (cast.length < 3) throw new Error('на этаже некого поставить в сцену');
  for (const enemy of world.enemies) enemy.alive = cast.includes(enemy);

  cast.forEach((enemy, i) => {
    /*
     * Плотнее, чем кажется нужным. При шаге в клетку и полутора клетках
     * от бочки крайний оказывался за краем лужи и оставался сухим: цепь
     * забирала двоих из трёх, и правило в кадре читалось как «иногда
     * работает». Лужа расходится на одну и три четверти клетки — все
     * трое обязаны стоять внутри.
     */
    enemy.x = bx + (i - 1) * TILE_SIZE * 0.9;
    enemy.y = by + TILE_SIZE * 0.9;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.state = 'idle';
    enemy.resist = null;
    enemy.hp = 1;
    enemy.angle = Math.PI / 2;
  });

  world.elements = ['fire', 'water', 'wind', 'earth', 'bolt'];

  /*
   * Этаж спит, и это не поблажка сцене, а её правда: никто ещё не умер,
   * а тревогу поднимает замеченная смерть. Поднятая тревога рассыпала
   * постановку за секунду — трое бросались на игрока и уходили с того
   * места, куда сейчас разольётся вода, и цепь забирала двоих вместо
   * троих. «Сцена детерминирована» оказывалось неправдой ровно там, где
   * это важнее всего.
   */
  world.engaged = false;
  world.total = 3;
  world.kills = 0;

  /*
   * Игрок стоит слева и близко: видно, чьих рук дело, и он не заслоняет
   * цепь. Дальше двух клеток расстояние в кадре начинает занимать место,
   * а показывать ему нечего.
   */
  world.player.x = bx - TILE_SIZE * 2.2;
  /*
   * Ровно на линии бочки. Первая постановка ставила игрока в один ряд с
   * тройкой — и выстрел уходил в них, минуя бочку: цепь не случалась
   * вовсе, а по кадру это выглядело как обычное попадание. Сцена должна
   * показывать правило, а не его отсутствие.
   */
  world.player.y = by;
  world.player.angle = 0;

  /* Крупный план: фигура около полусотни пикселей на месте показа.
     Двенадцать не читаются ничем, сколько ни правь свет. */
  world.zoomOverride = 3.6;

  const view = { x: bx - TILE_SIZE * 0.3, y: by + TILE_SIZE * 0.8 };

  const idle = { moveX: 0, moveY: 0, aimAngle: null, attack: false, charge: null };
  let elapsed = 0;
  let fired = false;

  function step(dt) {
    elapsed += dt;

    /*
     * Один ход, и дальше мир играет сам. Молния в бочку: вода разливается,
     * разряд идёт по ней, трое падают по очереди. Ждём полсекунды до
     * выстрела, чтобы в петлю попал и замах, а не одни последствия.
     */
    if (!fired && elapsed >= 0.5) {
      fired = true;
      world.player.stack = ['bolt'];
      update(world, dt, { ...idle, aimAngle: 0, attack: true });
      return;
    }

    update(world, dt, { ...idle, aimAngle: world.player.angle });
  }

  function render() {
    renderer.draw(world, view);
  }

  /*
   * Состояние для ловли момента по признаку, а не по времени. «Снять на
   * второй секунде» — надежда; «крутить, пока не упали двое» — адрес.
   */
  function state() {
    return {
      секунд: Number(elapsed.toFixed(2)),
      выстрел: fired,
      живых: world.enemies.filter((enemy) => enemy.alive).length,
      упавших: world.corpses.length,
      мокрых: world.enemies.filter((enemy) => (enemy.wet || 0) > 0).length,
      подТоком: Boolean(world.charged),
      частиц: world.particles.length,
    };
  }

  return { world, view, step, render, state, hooks };
}

/*
 * СЦЕНА ЦЕЛЬНОГО ЭПИЗОДА
 * ---------------------------------------------------------
 * Ничего не переставляет и не выдаёт результат руками. Игрок обычным
 * вводом проходит две клетки, заряжает огонь и стреляет в настоящий
 * стартовый стог; ближайший настоящий охранник приходит на шум. Сцена
 * замирает на последствии, пока охранник ещё жив и горит.
 */
export function createEpisodeShowcase(level, renderer, frame = {}) {
  const world = createWorld(level);
  const startX = world.player.x;
  const startY = world.player.y;

  let hayAt = -1;
  let hayGap = Infinity;
  for (let i = 0; i < world.tiles.length; i += 1) {
    if (world.tiles[i] !== TILE.HAY) continue;
    const x = (i % world.w + 0.5) * TILE_SIZE;
    const y = (Math.floor(i / world.w) + 0.5) * TILE_SIZE;
    const gap = Math.hypot(x - startX, y - startY);
    if (gap >= hayGap) continue;
    hayGap = gap;
    hayAt = i;
  }
  if (hayAt < 0) throw new Error('в операции нет стартового стога');

  const hayX = (hayAt % world.w + 0.5) * TILE_SIZE;
  const hayY = (Math.floor(hayAt / world.w) + 0.5) * TILE_SIZE;
  const guard = world.enemies.reduce((nearest, enemy) => (
    Math.hypot(enemy.x - hayX, enemy.y - hayY)
      < Math.hypot(nearest.x - hayX, nearest.y - hayY) ? enemy : nearest
  ), world.enemies[0]);
  if (!guard) throw new Error('у стартового стога нет охранника');

  world.zoomOverride = frame.width && frame.height && frame.width < frame.height
    ? 2.1
    : 3.4;
  const view = {
    x: (startX + guard.x) / 2,
    y: (startY + hayY) / 2,
  };
  const idle = { moveX: 0, moveY: 0, aimAngle: 0, attack: false, charge: null };
  let approachFrames = 0;
  let charging = false;
  let fired = false;
  let observed = false;
  let elapsed = 0;

  function step(dt) {
    if (observed) return;
    elapsed += dt;

    const aimAngle = Math.atan2(hayY - world.player.y, hayX - world.player.x);
    if (approachFrames < 20) {
      approachFrames += 1;
      update(world, dt, { ...idle, moveX: 1, aimAngle });
    } else if (!charging) {
      charging = true;
      update(world, dt, { ...idle, aimAngle, charge: 'fire' });
    } else if (world.player.chargeLeft > 0) {
      update(world, dt, { ...idle, aimAngle });
    } else if (!fired) {
      fired = true;
      update(world, dt, { ...idle, aimAngle, attack: true });
    } else {
      update(world, dt, { ...idle, aimAngle });
    }

    observed ||= world.events.some((event) => event.type === 'world-observation'
      && event.id === 'noise-fire');
  }

  function render() {
    renderer.draw(world, view);
  }

  function state() {
    return {
      секунд: elapsed,
      этап: observed ? 'наблюдение' : fired ? 'ловушка' : charging ? 'заряд' : 'подход',
      стогСгорел: world.tiles[hayAt] === TILE.FLOOR,
      охранникЖив: guard.alive,
      охранникГорит: (guard.burning || 0) > 0,
      наблюдение: observed,
      игрокЖив: world.player.alive,
      тревог: world.operation?.alerts || 0,
    };
  }

  return { world, view, step, render, state };
}

/* Сид держится ровно на время съёмки и возвращается назад: подменять
   случайность у всей страницы навсегда — способ получить необъяснимые
   отчёты через час. */
export function withSeed(seed, run) {
  const real = Math.random;
  Math.random = seeded(seed);
  try {
    return run();
  } finally {
    Math.random = real;
  }
}
