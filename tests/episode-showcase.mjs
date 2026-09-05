/* Детерминированная сцена настоящего эпизода: движение -> огонь -> шум -> ловушка. */

import { EVGENY_SANDBOX } from '../src/evgeny-sandbox.js';
import * as showcaseModule from '../src/showcase.js';

let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const createEpisodeShowcase = showcaseModule.createEpisodeShowcase;
check('у операции есть отдельная сцена эпизода', typeof createEpisodeShowcase === 'function');

if (typeof createEpisodeShowcase === 'function') {
  const renderer = { draw() {} };
  const portrait = createEpisodeShowcase(EVGENY_SANDBOX, renderer, { width: 390, height: 844 });
  check('вертикальная сцена отодвигает камеру и оставляет обоих в кадре',
    portrait.world.zoomOverride <= 2.1, String(portrait.world.zoomOverride));
  const untouched = createEpisodeShowcase(EVGENY_SANDBOX, renderer);
  check('сцена начинает детерминированный отсчёт с нуля', untouched.state().секунд === 0);
  untouched.render();
  const before = untouched.state();
  check('отрисовка без шагов не разыгрывает цепь',
    !before.стогСгорел && !before.наблюдение && before.игрокЖив,
    JSON.stringify(before));

  const scene = createEpisodeShowcase(EVGENY_SANDBOX, renderer);
  let frames = 0;
  while (!scene.state().наблюдение && frames < 360) {
    scene.step(1 / 60);
    frames += 1;
  }
  const after = scene.state();

  check('сцена доходит до последствия, а не до номера кадра',
    after.наблюдение && frames < 360, `${frames}/${JSON.stringify(after)}`);
  check('реальный ход сжигает стог и заводит живого охранника в огонь',
    after.стогСгорел && after.охранникЖив && after.охранникГорит,
    JSON.stringify(after));
  check('игрок переживает демонстрацию без поднятой тревоги',
    after.игрокЖив && after.тревог === 0, JSON.stringify(after));
}

process.exit(failures ? 1 : 0);
