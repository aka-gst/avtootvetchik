/*
 * АВТООТВЕТЧИК — прогон ввода без браузера.
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

/* --- клавиатура --- */
fire(windowListeners, 'keydown', { code: 'KeyD', repeat: false });
let state = input.read();
check('D ведёт вправо', state.moveX === 1 && state.moveY === 0, `${state.moveX},${state.moveY}`);

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

console.log(failures ? `\nПРОВАЛЕНО: ${failures}` : '\nввод работает');
process.exit(failures ? 1 : 0);
