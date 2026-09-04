/* Физические наблюдения при выборе цели — без браузера. */

import { createWorld } from '../src/world.js';
import { EVGENY_SANDBOX } from '../src/evgeny-sandbox.js';
import { TILE } from '../src/level.js';
import { keepPicked } from '../src/aim.js';

const observations = await import('../src/observations.js').catch(() => ({}));
const physicalHint = observations.physicalHint;
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

check('модуль даёт физическое наблюдение для выбранной цели',
  typeof physicalHint === 'function');

if (typeof physicalHint === 'function') {
  const world = createWorld(EVGENY_SANDBOX);
  const tileTarget = (tile) => {
    const at = world.tiles.findIndex((value) => value === tile);
    return { prop: at, x: (at % world.w + 0.5) * 32, y: (Math.floor(at / world.w) + 0.5) * 32 };
  };
  const candle = world.props.find((prop) => prop.kind === 'candle');
  const targets = [
    { name: 'свеча', target: { worldProp: candle, x: candle.x, y: candle.y } },
    { name: 'бочка', target: tileTarget(TILE.BARREL) },
    { name: 'кристалл', target: tileTarget(TILE.CRYSTAL) },
    { name: 'щиток', target: tileTarget(TILE.PANEL) },
    { name: 'тело', target: world.enemies[0] },
  ];
  const lines = targets.map(({ target }) => physicalHint(world, target));

  check('пять классов цели дают ровно по одной непустой строке',
    lines.length === 5 && lines.every((line) => typeof line === 'string'
      && line.trim().length > 0 && !line.includes('\n')),
    JSON.stringify(lines));
  check('наблюдения не называют рецепт или команду',
    lines.every((line) => !/(огонь|молни|fire|bolt|нажми|кинь|брось|стреляй)/i.test(line)),
    JSON.stringify(lines));

  const unlit = physicalHint(world, targets[0].target);
  candle.lit = true;
  const lit = physicalHint(world, targets[0].target);
  check('состояние зажжённой свечи меняет наблюдение',
    lit !== unlit && /(горит|пламя)/i.test(lit), `${unlit} -> ${lit}`);
  check('зажжённая свеча остаётся выбранной, чтобы состояние успели прочитать',
    keepPicked(world, targets[0].target)?.worldProp === candle);
  check('без выбранной цели строка исчезает', physicalHint(world, null) === '');
}

process.exit(failures ? 1 : 0);
