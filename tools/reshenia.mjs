/*
 * СКОЛЬКИМИ СПОСОБАМИ ПРОХОДИТСЯ КОМНАТА
 * =========================================================
 * Первое из трёх измерений приёмки: **решения существуют**. Оно не
 * заменяет живых людей — те проверяют, что решения ФИНДЯТ, — но отвечает
 * на предыдущий вопрос, и отвечает дёшево.
 *
 * Игрок здесь нарочно случайный, а не умный. Умный бот всегда играет
 * одинаково и даёт один след: он проверит, что комната проходима, и
 * ничего не скажет о числе решений. Ощущение «можно всё» рождается из
 * попадания наугад — значит и мерить надо тем, кто тычет наугад.
 *
 * Считаются не прохождения, а различные наборы сработавших правил:
 * канонический след из trace.js. Два прохождения с одним набором — одно
 * решение, как бы по-разному их ни играли.
 *
 * Запуск: node tools/reshenia.mjs [сколько прогонов]
 */

import { CAMPAIGN } from '../src/levels.js';
import { createWorld, update, TILE_SIZE } from '../src/world.js';
import { TILE, weakTo } from '../src/level.js';
import { ELEMENT_ORDER } from '../src/magic.js';
import { createTrace, traceEvent, traceKey } from '../src/trace.js';

const DT = 1 / 60;
const idle = { moveX: 0, moveY: 0, aimAngle: null, attack: false, charge: null };

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/* Всё, во что вообще можно целиться: живые и всё ломаемое. */
function цели(world) {
  const out = world.enemies.filter((enemy) => enemy.alive)
    .map((enemy) => ({ x: enemy.x, y: enemy.y }));

  for (let i = 0; i < world.tiles.length; i += 1) {
    if (!weakTo(world.tiles[i])) continue;
    out.push({
      x: ((i % world.w) + 0.5) * TILE_SIZE,
      y: (((i / world.w) | 0) + 0.5) * TILE_SIZE,
    });
  }

  return out;
}

function прогон(floor, seed, секунд = 60) {
  const rnd = seeded(seed);
  const было = Math.random;
  Math.random = rnd;

  try {
    const world = createWorld(floor);
    const trace = createTrace();
    let набор = [];

    for (let f = 0; f < секунд / DT && world.player.alive; f += 1) {
      const цель = цели(world);
      const intent = { ...idle };

      /* Набираем случайную стихию, пока очередь не полна, потом бьём в
         случайную цель. Ни тактики, ни памяти — только тыканье. */
      if (world.player.chargeLeft <= 0) {
        if (набор.length < 3 && rnd() < 0.06) {
          const id = world.elements[Math.floor(rnd() * world.elements.length)];
          intent.charge = id;
          набор.push(id);
        } else if (набор.length && цель.length && rnd() < 0.08) {
          const t = цель[Math.floor(rnd() * цель.length)];
          intent.aimAngle = Math.atan2(t.y - world.player.y, t.x - world.player.x);
          intent.attack = true;
          набор = [];
        }
      }

      /* И бродим, иначе половина целей никогда не окажется в досягаемости. */
      if (rnd() < 0.03) {
        const a = rnd() * Math.PI * 2;
        intent.moveX = Math.cos(a);
        intent.moveY = Math.sin(a);
      }

      update(world, DT, intent);
      for (const event of world.events) traceEvent(trace, event);
    }

    return { след: traceKey(trace), правил: trace.rules.size, убито: world.kills, жив: world.player.alive };
  } finally {
    Math.random = было;
  }
}

const сколько = Number(process.argv[2]) || 60;
const floor = CAMPAIGN[0];

const следы = new Map();
let живых = 0;

for (let i = 0; i < сколько; i += 1) {
  const r = прогон(floor, 20260830 + i * 7919);
  if (r.жив) живых += 1;
  if (!r.правил) continue;
  следы.set(r.след, (следы.get(r.след) || 0) + 1);
}

const всего = [...следы.values()].reduce((a, b) => a + b, 0);
const частый = Math.max(0, ...следы.values());

console.log(`этаж: ${floor.title}`);
console.log(`прогонов: ${сколько}, из них с хоть одним правилом: ${всего}, выжил в ${живых}`);
console.log(`различных решений: ${следы.size}`);
console.log(`доля самого частого: ${всего ? Math.round(частый / всего * 100) : 0}%`);
console.log('');

for (const [след, раз] of [...следы.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(String(раз).padStart(3), след);
}
