/*
 * ТЕХНОМАГИЯ — ввод.
 *
 * Одна игра, два разных тела управления:
 *
 *   клавиатура и мышь — WASD ведёт, курсор целит, кнопка бьёт;
 *   палец — два плавающих стика и три крупные кнопки.
 *
 * Стик «плавающий»: он появляется там, где палец коснулся экрана, а не
 * в нарисованном кружке. На телефоне попадать в нарисованный кружок,
 * не глядя на него, невозможно — а глядеть некогда.
 *
 * Модуль отдаёт только сырое состояние. Куда смотрит игрок в мировых
 * координатах, считает main.js: там есть камера.
 */

const DEAD_ZONE = 12;
const STICK_RANGE = 46;

/*
 * У мыши есть срок годности. На ноутбуке курсор один раз задели ладонью —
 * и он навсегда перехватил бы прицел, хотя игрок давно перешёл на клавиши.
 * Поэтому мышь целит, только пока ей недавно двигали.
 */
const MOUSE_MEMORY = 2500;

export function createInput(surface) {
  const keys = new Set();
  const pressed = new Set();

  const mouse = { x: 0, y: 0, down: false, used: false, movedAt: -Infinity, moved: false };

  /*
   * Тап по полю — выбор цели.
   *
   * Пальцем нельзя нажать Tab, а выбирать, во что прилетит, нужно не
   * меньше, чем с клавиатуры: половина игры в том, чтобы ударить в бочку,
   * а не в того, кто рядом с ней. Тап — единственный жест, который на
   * сенсоре свободен: короткое касание без ведения ничего больше не значит.
   *
   * Отличается он от стика двумя числами: не сдвинулся дальше пальца и
   * отпущен быстрее, чем за треть секунды. Всё остальное — стик.
   */
  const TAP_SLIDE = 14;
  const TAP_TIME = 320;
  let tap = null;

  const sticks = {
    move: { id: null, baseX: 0, baseY: 0, dx: 0, dy: 0, active: false },
    aim: { id: null, baseX: 0, baseY: 0, dx: 0, dy: 0, active: false },
  };

  const buttons = { attack: false, pickup: false, throw: false };

  let touchMode = false;

  /* ======================= КЛАВИАТУРА ======================= */

  window.addEventListener('keydown', (event) => {
    /*
     * Пока курсор в поле ввода, клавиши принадлежат полю. Без этой
     * оговорки ник «Борис» открывал книгу на «Б», а «Рома» перезапускал
     * этаж на «Р»: игра слушала клавиатуру поверх формы.
     */
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.isContentEditable)) return;

    /* Код клавиши, а не символ: на русской раскладке WASD остаётся WASD. */
    if (!event.repeat) pressed.add(event.code);
    keys.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) {
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  /* ======================= МЫШЬ ======================= */

  surface.addEventListener('mousemove', (event) => {
    const rect = surface.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    mouse.used = true;
    mouse.movedAt = performance.now();
    touchMode = false;
  });

  surface.addEventListener('mousedown', (event) => {
    if (event.button === 0) { mouse.down = true; pressed.add('Fire'); }
    if (event.button === 2) pressed.add('Throw');
    mouse.used = true;
    mouse.movedAt = performance.now();
    touchMode = false;
  });

  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) mouse.down = false;
  });

  surface.addEventListener('contextmenu', (event) => event.preventDefault());

  /* ======================= ПАЛЕЦ ======================= */

  function stickFor(x) {
    return x < surface.clientWidth / 2 ? sticks.move : sticks.aim;
  }

  surface.addEventListener('touchstart', (event) => {
    touchMode = true;
    const rect = surface.getBoundingClientRect();

    for (const touch of event.changedTouches) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      const stick = stickFor(x);
      if (stick.id !== null) continue;
      stick.id = touch.identifier;
      stick.baseX = x;
      stick.baseY = y;
      stick.dx = 0;
      stick.dy = 0;
      stick.active = true;
      stick.startX = x;
      stick.startY = y;
      stick.startAt = performance.now();
    }

    event.preventDefault();
  }, { passive: false });

  surface.addEventListener('touchmove', (event) => {
    const rect = surface.getBoundingClientRect();

    for (const touch of event.changedTouches) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      for (const stick of [sticks.move, sticks.aim]) {
        if (stick.id !== touch.identifier) continue;
        let dx = x - stick.baseX;
        let dy = y - stick.baseY;
        const len = Math.hypot(dx, dy);

        /*
         * Палец уезжает за пределы стика — база едет следом. Иначе через
         * полминуты боя стик оказывается у края экрана и игрок не может
         * повернуть в одну из сторон.
         */
        if (len > STICK_RANGE) {
          stick.baseX += dx * (1 - STICK_RANGE / len);
          stick.baseY += dy * (1 - STICK_RANGE / len);
          dx *= STICK_RANGE / len;
          dy *= STICK_RANGE / len;
        }

        stick.dx = dx;
        stick.dy = dy;
      }
    }

    event.preventDefault();
  }, { passive: false });

  function endTouch(event) {
    const rect = surface.getBoundingClientRect();

    for (const touch of event.changedTouches) {
      for (const stick of [sticks.move, sticks.aim]) {
        if (stick.id !== touch.identifier) continue;

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        const slid = Math.hypot(x - stick.startX, y - stick.startY);
        const held = performance.now() - stick.startAt;

        if (slid < TAP_SLIDE && held < TAP_TIME) tap = { x, y };

        stick.id = null;
        stick.dx = 0;
        stick.dy = 0;
        stick.active = false;
      }
    }
  }

  surface.addEventListener('touchend', endTouch);
  surface.addEventListener('touchcancel', endTouch);

  /* Экранные кнопки живут в DOM: им нужна крупная зона и подсветка нажатия. */
  function bindButton(element, name) {
    if (!element) return;

    /* Имя кнопки прямо переводится в имя нажатия — новые кнопки не требуют
       правок в этом месте. */
    const CODE = {
      attack: 'Fire',
      pickup: 'Pickup',
      throw: 'Throw',
      fire: 'Digit1',
      water: 'Digit2',
      wind: 'Digit3',
      earth: 'Digit4',
      bolt: 'Digit5',
    };

    const press = (event) => {
      event.preventDefault();
      event.stopPropagation();
      touchMode = true;
      buttons[name] = true;
      pressed.add(CODE[name] || name);
      element.classList.add('is-held');
    };

    const release = (event) => {
      event.preventDefault();
      buttons[name] = false;
      element.classList.remove('is-held');
    };

    element.addEventListener('touchstart', press, { passive: false });
    element.addEventListener('touchend', release);
    element.addEventListener('touchcancel', release);
    element.addEventListener('mousedown', press);
    element.addEventListener('mouseup', release);
    element.addEventListener('mouseleave', release);
  }

  /* ======================= СНИМОК ======================= */

  function axis(negative, positive) {
    return (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);
  }

  function read() {
    const state = {
      moveX: 0,
      moveY: 0,
      aimStick: null,
      attackHeld: mouse.down || buttons.attack
        || keys.has('Space') || keys.has('Enter') || keys.has('KeyJ'),
      touch: touchMode,
      mouse,
      sticks,
    };

    /*
     * Руки разведены по половинам клавиатуры: левая только ведёт (WASD),
     * правая занята предметами и набором демонов (стрелки и пробел).
     * Целиться в этой схеме нечем — и не нужно: прицел ведёт автонаводка,
     * а мышь, если её трогают, перехватывает его на себя.
     */
    state.moveX = axis('KeyA', 'KeyD');
    state.moveY = axis('KeyW', 'KeyS');

    /* Зажатая кнопка — тоже работа мышью: во время стрельбы курсор не
       двигается, и без этой оговорки прицел уехал бы за ногами игрока. */
    mouse.moved = mouse.down || performance.now() - mouse.movedAt < MOUSE_MEMORY;

    if (sticks.move.active) {
      const len = Math.hypot(sticks.move.dx, sticks.move.dy);
      if (len > DEAD_ZONE) {
        const scale = Math.min(1, (len - DEAD_ZONE) / (STICK_RANGE - DEAD_ZONE));
        state.moveX = (sticks.move.dx / len) * scale;
        state.moveY = (sticks.move.dy / len) * scale;
      }
    }

    if (sticks.aim.active) {
      const len = Math.hypot(sticks.aim.dx, sticks.aim.dy);
      if (len > DEAD_ZONE) state.aimStick = Math.atan2(sticks.aim.dy, sticks.aim.dx);
    }

    const length = Math.hypot(state.moveX, state.moveY);
    if (length > 1) { state.moveX /= length; state.moveY /= length; }

    return state;
  }

  /* Тап читается один раз: он событие, а не состояние. */
  function tookTap() {
    const at = tap;
    tap = null;
    return at;
  }

  function tookKey(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  }

  function endFrame() { pressed.clear(); }

  return { read, tookKey, tookTap, endFrame, bindButton, keys, isTouch: () => touchMode };
}
