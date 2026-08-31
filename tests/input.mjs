import { readFileSync } from 'node:fs';
import { quietFrom } from '../src/audio.js';
/*
 * ТЕХНОМАГИЯ — прогон ввода без браузера.
 *
 *   node avto/tests/input.mjs
 *
 * Модуль ввода — единственное место, где игра разговаривает с двумя
 * разными телами управления сразу. Здесь ему подставляется поддельный
 * DOM и проверяется то, что на глаз не видно: не залипают ли клавиши,
 * едет ли база стика за пальцем, срабатывает ли нажатие ровно один раз.
 */

/* Поддельный DOM: модуль ввода не знает, что окна нет. */
const windowListeners = {};
globalThis.window = {
  addEventListener: (type, fn) => (windowListeners[type] ||= []).push(fn),
};

const surfaceListeners = {};
const surface = {
  clientWidth: 800,
  clientHeight: 600,
  addEventListener: (type, fn) => (surfaceListeners[type] ||= []).push(fn),
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
};

const fire = (map, type, event) => (map[type] || []).forEach((fn) => fn({
  preventDefault() {}, stopPropagation() {}, ...event,
}));

const { createInput } = await import('../src/input.js');
const input = createInput(surface);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

/* --- клавиатура: левая рука ведёт, правая занята предметами и набором --- */
fire(windowListeners, 'keydown', { code: 'KeyD', repeat: false });
let state = input.read();
check('D ведёт вправо', state.moveX === 1 && state.moveY === 0, `${state.moveX},${state.moveY}`);

fire(windowListeners, 'keydown', { code: 'ArrowUp', repeat: false });
state = input.read();
check('стрелка не вмешивается в ход',
  state.moveX === 1 && state.moveY === 0, `${state.moveX},${state.moveY}`);
check('стрелка приходит нажатием, а не осью', input.tookKey('ArrowUp') === true);
fire(windowListeners, 'keyup', { code: 'ArrowUp' });

fire(windowListeners, 'keyup', { code: 'KeyD' });
fire(windowListeners, 'keydown', { code: 'ArrowLeft', repeat: false });
state = input.read();
check('стрелки не ходят даже без WASD',
  state.moveX === 0 && state.moveY === 0, `${state.moveX},${state.moveY}`);
fire(windowListeners, 'keyup', { code: 'ArrowLeft' });
input.endFrame();

/* Удар вернулся на пробел: он под большим пальцем правой руки. */
fire(windowListeners, 'keydown', { code: 'Space', repeat: false });
state = input.read();
check('пробел держит удар', state.attackHeld === true);
check('пробел приходит и нажатием', input.tookKey('Space') === true);
fire(windowListeners, 'keyup', { code: 'Space' });
state = input.read();
check('отпущенный пробел удар отпускает', state.attackHeld === false);

fire(windowListeners, 'keydown', { code: 'Enter', repeat: false });
state = input.read();
check('ввод держит удар', state.attackHeld === true);
fire(windowListeners, 'keyup', { code: 'Enter' });
state = input.read();
check('отпущенный ввод удар отпускает', state.attackHeld === false);

fire(windowListeners, 'keydown', { code: 'KeyD', repeat: false });
state = input.read();

fire(windowListeners, 'keydown', { code: 'KeyW', repeat: false });
state = input.read();
check('диагональ не быстрее прямой',
  Math.abs(Math.hypot(state.moveX, state.moveY) - 1) < 0.001,
  Math.hypot(state.moveX, state.moveY).toFixed(3));

fire(windowListeners, 'keyup', { code: 'KeyD' });
fire(windowListeners, 'keyup', { code: 'KeyW' });
state = input.read();
check('отпущенные клавиши не залипают', state.moveX === 0 && state.moveY === 0);

input.endFrame();
fire(windowListeners, 'keydown', { code: 'KeyE', repeat: false });
check('одиночное нажатие срабатывает ровно один раз',
  input.tookKey('KeyE') === true && input.tookKey('KeyE') === false);
check('после кадра нажатие не воскресает',
  (input.endFrame(), input.tookKey('KeyE') === false));

/* --- палец: левая половина ведёт, правая целит --- */
fire(surfaceListeners, 'touchstart', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 400 }] });
fire(surfaceListeners, 'touchmove', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 340 }] });
state = input.read();
check('левый стик ведёт вверх', state.moveY < -0.5 && Math.abs(state.moveX) < 0.2,
  `${state.moveX.toFixed(2)},${state.moveY.toFixed(2)}`);

fire(surfaceListeners, 'touchstart', { changedTouches: [{ identifier: 2, clientX: 600, clientY: 400 }] });
fire(surfaceListeners, 'touchmove', { changedTouches: [{ identifier: 2, clientX: 640, clientY: 400 }] });
state = input.read();
check('правый стик целит вправо', Math.abs(state.aimStick) < 0.01, String(state.aimStick));

/* База стика едет за пальцем, если тот ушёл далеко. */
fire(surfaceListeners, 'touchmove', { changedTouches: [{ identifier: 2, clientX: 900, clientY: 400 }] });
state = input.read();
check('стик не упирается в край экрана', Math.abs(state.aimStick) < 0.01, String(state.aimStick));

fire(surfaceListeners, 'touchend', { changedTouches: [{ identifier: 1 }, { identifier: 2 }] });
state = input.read();
check('пальцы убраны — движение прекращается',
  state.moveX === 0 && state.moveY === 0 && state.aimStick === null);

/* --- экранная кнопка --- */
const fakeButton = {
  classList: { add() {}, remove() {} },
  listeners: {},
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
};
input.bindButton(fakeButton, 'attack');
fire(fakeButton.listeners, 'touchstart', {});
state = input.read();
check('кнопка БИТЬ держит удар', state.attackHeld === true);
check('она же даёт одиночное нажатие', input.tookKey('Fire') === true);
fire(fakeButton.listeners, 'touchend', {});
state = input.read();
check('отпущенная кнопка отпускает удар', state.attackHeld === false);

/* --- Целость main.js ---------------------------------------------------
 *
 * main.js не проверяется прогоном: он трогает документ, а его в узле нет.
 * Из-за этого целый класс поломок доезжает до браузера незамеченным —
 * и один раз доехал: правка, менявшая обучалку по диапазону строк,
 * заодно вырезала блок с подколами, а вызовы jab() остались. Синтаксис
 * при этом верный, тесты зелёные, а игра падает на первом же самоподжоге.
 *
 * Поэтому файл читается как текст и проверяется на то, что все свои
 * помощники, которых он зовёт, в нём же и объявлены. Это не замена
 * прогону, но ровно ту ошибку ловит.
 */
{
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  const helpers = [
    'jab', 'pulse', 'iconTag', 'setToast', 'vibrate', 'byTouch',
    'tutorStart', 'tutorFeed', 'syncElementButtons', 'renderTome',
    'showVeil', 'hideVeil', 'startLevel', 'deathScreen', 'clearScreen',
  ];

  for (const name of helpers) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(main)) continue;
    const declared = new RegExp(`function ${name}\\b`).test(main)
      || new RegExp(`\\b(?:const|let)\\s+${name}\\b`).test(main)
      || new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`).test(main);
    check(`main.js: ${name} объявлен там, где вызывается`, declared);
  }

  /* И у каждой подколки должен быть свой список: опечатка в имени вида
     jab('shocked') молча вернула бы undefined и показала пустую строку. */
  const kinds = [...main.matchAll(/jab\('([a-z]+)'/g)].map((m) => m[1]);
  for (const kind of new Set(kinds)) {
    check(`main.js: у подколки «${kind}» есть свой список`,
      new RegExp(`\\n\\s{2}${kind}:\\s*\\[`).test(main));
  }
}

/* --- Немой запуск: оба написания, включая закодированное --- */
{
  /*
   * Проверка появилась после того, как поломку нашли замером звука на
   * бою, а не здесь: разбор адреса жил внутри createAudio, трогал
   * `window` и был недоступен из узла. Непроверяемое место — это не
   * «пока не покрыто», а слепое пятно, куда доезжает что угодно при
   * зелёных наборах.
   */
  const случаи = [
    ['?тихо', '', true, 'кириллица как есть'],
    ['?%D1%82%D0%B8%D1%85%D0%BE', '', true, 'кириллица закодированная'],
    ['?quiet', '', true, 'латиница'],
    ['?tiho', '', true, 'латиницей на слух'],
    ['?ТИХО', '', true, 'заглавными'],
    ['?тихо&debug', '', true, 'не последним в строке'],
    ['?debug&тихо', '', true, 'не первым в строке'],
    ['?тихо=1', '', true, 'со значением'],
    ['', '#тихо', true, 'в решётке'],
    ['?тихонько', '', false, 'часть другого слова — не флаг'],
    ['?disquiet', '', false, 'хвост другого слова — не флаг'],
    ['?%', '', false, 'битый процент не роняет и не включает'],
    ['', '', false, 'пустой адрес'],
  ];

  let плохих = 0;
  for (const [search, hash, ждём, зачем] of случаи) {
    if (quietFrom(search, hash) !== ждём) {
      плохих += 1;
      check(`немой флаг: ${зачем}`, false, `${JSON.stringify(search + hash)}`);
    }
  }
  check(`немой флаг разбирается верно во всех ${случаи.length} случаях`, плохих === 0);
}

console.log(failures ? `\nПРОВАЛЕНО: ${failures}` : '\nввод работает');
process.exit(failures ? 1 : 0);
