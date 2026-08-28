/*
 * АВТООТВЕТЧИК — сборка игры.
 *
 * Здесь живёт то, что связывает остальное: цикл кадра, камера, прицел,
 * экраны между попытками и перезапуск. Правил боя тут нет — они в
 * world.js, поведения врагов нет — оно в ai.js.
 */

import { CAMPAIGN } from './levels.js';
import { decode, encode } from './level.js';
import { createWorld, update, WEAPONS } from './world.js';
import { AIM_CONE, assistAim, closeThreat, meleeSnap, hasTargetUnderAim } from './aim.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createScore, readBest, writeBest } from './score.js';
import { ELEMENTS, ELEMENT_ORDER, STACK_LIMIT, formFor, colourOf } from './daemons.js';

const $ = (id) => document.getElementById(id);

const canvas = $('screen');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

const ui = {
  weapon: $('weapon'),
  ammo: $('ammo'),
  kills: $('kills'),
  clock: $('clock'),
  toast: $('toast'),
  veil: $('veil'),
  veilKicker: $('veilKicker'),
  veilTitle: $('veilTitle'),
  veilText: $('veilText'),
  veilStats: $('veilStats'),
  veilAction: $('veilAction'),
  veilSecond: $('veilSecond'),
  veilCode: $('veilCode'),
  codeBox: $('codeBox'),
  veilScore: $('veilScore'),
  rankLetter: $('rankLetter'),
  scoreLines: $('scoreLines'),
  scoreTotal: $('scoreTotal'),
  scoreBest: $('scoreBest'),
  score: $('score'),
  combo: $('combo'),
  stack: $('stack'),
  form: $('form'),
  mute: $('mute'),
  ghostMove: $('ghostMove'),
  ghostAim: $('ghostAim'),
};

/* Клавиши стихий: цифровой ряд слева, чтобы левая рука не уходила с WASD. */
const CHARGE_KEYS = { Digit1: 'therm', Digit2: 'ice', Digit3: 'surge' };

const SFX_BY_EVENT = {
  shot: 'shot',
  swing: 'swing',
  impact: 'impact',
  'charge-start': 'charge',
  'daemon-windup': 'beamup',
  shield: 'shield',
  knock: 'knock',
  kill: 'kill',
  death: 'death',
  pickup: 'pickup',
  dry: 'dry',
  glass: 'glass',
  spot: 'spot',
  cleared: 'exit',
};

let levelIndex = 0;
let custom = false;
let level = CAMPAIGN[0];
let world = null;
let score = null;
let levelCode = '';
let result = null;
let scene = 'call';          /* call → play → dead | clear, плюс pause */
let view = { x: 0, y: 0 };
let lastView = { zoom: 1, camX: 0, camY: 0 };
let toastTimer = 0;
let deathHold = 0;
let attempts = 0;


/* =========================================================
   ЧУЖОЙ ЭТАЖ ИЗ АДРЕСА
   ========================================================= */

/*
 * Уровень целиком лежит в ссылке. Редактора пока нет, но канал уже
 * рабочий: код из адресной строки проходит тот же путь, что пройдёт код
 * из чужих рук.
 */
function levelFromHash() {
  const match = location.hash.match(/^#l=(.+)$/);
  if (!match) return null;

  try {
    const outside = decode(decodeURIComponent(match[1]));
    outside.title = 'ЧУЖОЙ ЭТАЖ';
    outside.call = 'Код прислали снаружи. Кто там внутри — автоответчик не уточнил.';
    return outside;
  } catch (error) {
    setToast(`КОД НЕ ОТКРЫЛСЯ: ${error.message}`, 5);
    return null;
  }
}


/* =========================================================
   ЭКРАНЫ
   ========================================================= */

function showVeil(config) {
  ui.veilKicker.textContent = config.kicker || '';
  ui.veilTitle.textContent = config.title || '';
  ui.veilText.textContent = config.text || '';
  ui.veilStats.innerHTML = config.stats || '';
  ui.veilAction.textContent = config.action || 'ДАЛЬШЕ';
  ui.veilSecond.textContent = config.second || '';
  ui.veilSecond.hidden = !config.second;
  ui.veilCode.hidden = !config.code;
  if (config.code) ui.codeBox.value = config.code;

  ui.veilScore.hidden = !config.result;
  if (config.result) fillScore(config.result, config.best, config.record);
  ui.veil.hidden = false;
  ui.veil.dataset.tone = config.tone || 'call';
  audio.setMenu(true);
}

function hideVeil() {
  ui.veil.hidden = true;
  audio.setMenu(false);
}

/*
 * Разбор забега. Строки приходят из score.js уже посчитанными — здесь
 * только вёрстка, чтобы правила начисления жили в одном месте.
 */
function fillScore(final, best, record) {
  ui.veilScore.dataset.rank = final.rank;
  ui.rankLetter.textContent = final.rank;

  ui.scoreLines.innerHTML = final.lines
    .map((line) => `<li><span>${line.label}</span><b>${line.value ? '+' + line.value : '—'}</b></li>`)
    .join('');

  ui.scoreTotal.textContent = final.total;

  if (record) {
    ui.scoreBest.textContent = 'НОВЫЙ РЕКОРД ЭТАЖА';
    ui.scoreBest.dataset.record = '1';
  } else if (best) {
    ui.scoreBest.textContent = `ЛУЧШЕЕ: ${best.total} · РАНГ ${best.rank}`;
    ui.scoreBest.dataset.record = '0';
  } else {
    ui.scoreBest.textContent = '';
    ui.scoreBest.dataset.record = '0';
  }
}

function setToast(text, seconds = 2) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  toastTimer = seconds;
}

function controlsHint() {
  return input.isTouch() || matchMedia('(pointer: coarse)').matches
    ? 'ЛЕВЫЙ ПАЛЕЦ ВЕДЁТ, ПРАВЫЙ ЦЕЛИТ И БЬЁТ. ЦВЕТНЫЕ КНОПКИ НАБИРАЮТ ДЕМОНОВ — УДАР ИХ ВЫПУСКАЕТ.'
    : 'WASD — ИДТИ, СТРЕЛКИ — ЦЕЛИТЬ, ПРОБЕЛ — БИТЬ. 1/2/3 НАБИРАЮТ ДЕМОНОВ, УДАР ИХ ВЫПУСКАЕТ. E — ВЗЯТЬ, Q — БРОСИТЬ, R — ЗАНОВО.';
}


/* =========================================================
   ЗАПУСК ЭТАЖА
   ========================================================= */

function startLevel(next, { silent } = {}) {
  const changed = next && next !== level;
  level = next || level;
  if (changed || !levelCode) levelCode = encode(level);

  world = createWorld(level);
  view = { x: world.player.x, y: world.player.y };
  renderer.invalidate();
  scene = 'play';
  hideVeil();
  attempts += 1;
  result = null;
  score = createScore(level, attempts);
  if (!silent) audio.playTrack(level.track || 0);
  updateHud(true);
}

function callScreen() {
  scene = 'call';
  const best = readBest(levelCode);

  showVeil({
    tone: 'call',
    kicker: 'СООБЩЕНИЕ · 03:14',
    title: level.title,
    text: level.call,
    stats: `<span>${controlsHint()}</span>`
      + (best ? `<span>ЛУЧШЕЕ ЗДЕСЬ: ${best.total} · РАНГ ${best.rank} · ${formatTime(best.time)}</span>` : ''),
    action: 'ВЗЯТЬ КЛЮЧИ',
  });
}

function deathScreen() {
  scene = 'dead';
  showVeil({
    tone: 'dead',
    kicker: `ПОПЫТКА ${attempts}`,
    title: 'ТЕБЯ УБИЛИ',
    text: 'Здесь умирают с одного удара — и ты, и они. Разница только в том, кто ударил первым.',
    stats: `<span>ВЫРЕЗАНО ${world.kills} ИЗ ${world.total}</span><span>${formatTime(world.time)}</span>`
      + `<span>СГОРЕЛО ОЧКОВ: ${score.state.score}</span>`,
    action: 'ЗАНОВО',
  });
}

function hasNextFloor() {
  return !custom && levelIndex + 1 < CAMPAIGN.length;
}

function clearScreen() {
  scene = 'clear';

  result = score.finish(world);
  const record = writeBest(levelCode, result, world.time);
  const more = hasNextFloor();

  showVeil({
    tone: 'clear',
    kicker: 'ЭТАЖ СДАН',
    title: more ? 'СЛЕДУЮЩЕЕ СООБЩЕНИЕ' : 'ТИХО',
    text: more
      ? 'Автоответчик уже мигает. Очки платят за темп: цепочка обрывается через четыре секунды без убийства.'
      : 'Автоответчик молчит. Дальше — только чище и быстрее, чем в прошлый раз.',
    stats: `<span>ВРЕМЯ ${formatTime(world.time)}</span><span>ПОПЫТОК ${attempts}</span>`,
    action: more ? 'СЛЕДУЮЩИЙ ЭТАЖ' : 'ПРОЙТИ ЧИЩЕ',
    second: more ? 'ПРОЙТИ ЭТОТ ЧИЩЕ' : 'ВЫЙТИ В МЕНЮ',
    result,
    best: record.best,
    record: record.record,
  });
}

function pauseScreen() {
  scene = 'pause';
  showVeil({
    tone: 'pause',
    kicker: 'ПАУЗА',
    title: level.title,
    text: 'Этаж целиком помещается в эту строку. Скопируй её — и тот, кому дашь, откроет ровно этот же этаж.',
    stats: `<span>${controlsHint()}</span>`,
    action: 'ПРОДОЛЖИТЬ',
    second: 'НАЧАТЬ ЭТАЖ ЗАНОВО',
    code: levelCode,
  });
}

function formatTime(seconds) {
  const total = Math.floor(seconds * 10) / 10;
  const minutes = Math.floor(total / 60);
  const rest = (total - minutes * 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${rest}`;
}


/* =========================================================
   ПРИЦЕЛ
   ========================================================= */

function buildIntent(raw) {
  const player = world.player;
  const intent = {
    moveX: raw.moveX,
    moveY: raw.moveY,
    aimAngle: null,
    attack: false,
    charge: null,
    pickup: input.tookKey('KeyE') || input.tookKey('Pickup'),
    throw: input.tookKey('KeyQ') || input.tookKey('Throw'),
  };

  /* Забираем все три нажатия, а не первое: иначе непрочитанное всплывёт кадром позже. */
  for (const code of Object.keys(CHARGE_KEYS)) {
    if (input.tookKey(code)) intent.charge = CHARGE_KEYS[code];
  }

  if (raw.aimStick !== null) {
    intent.aimAngle = assistAim(world, raw.aimStick, AIM_CONE.stick);
  } else if (raw.aimKeys) {
    intent.aimAngle = assistAim(world, Math.atan2(raw.aimKeys.y, raw.aimKeys.x), AIM_CONE.keys);
  } else if (!raw.touch && raw.mouse.moved) {
    const worldX = lastView.camX + (raw.mouse.x - canvas.clientWidth / 2) / lastView.zoom;
    const worldY = lastView.camY + (raw.mouse.y - canvas.clientHeight / 2) / lastView.zoom;
    intent.aimAngle = assistAim(world, Math.atan2(worldY - player.y, worldX - player.x), AIM_CONE.mouse);
  } else if (raw.moveX || raw.moveY) {
    /*
     * Ни мыши, ни стрелок — целимся туда, куда бежим, и доводим до цели.
     * Это и есть игра «чисто с кнопок»: одной рукой на WASD и пробеле.
     */
    intent.aimAngle = assistAim(world, Math.atan2(raw.moveY, raw.moveX), AIM_CONE.run);
  } else {
    intent.aimAngle = closeThreat(world);
  }

  /* Удержание — это очередь ударов, а не один: темп задаёт откат оружия. */
  const fired = input.tookKey('Fire') || input.tookKey('Space') || input.tookKey('KeyJ');
  intent.attack = fired || raw.attackHeld;

  /*
   * Палец не умеет одновременно целиться стиком и жать кнопку: это один и
   * тот же большой палец. Поэтому наведённый на цель стик бьёт сам —
   * но только когда цель действительно под прицелом, иначе обойма
   * уходит в стену за две секунды.
   */
  if (!intent.attack && raw.aimStick !== null && intent.aimAngle !== null) {
    intent.attack = hasTargetUnderAim(world, intent.aimAngle);
  }

  if (intent.attack) {
    const snapped = meleeSnap(world, intent.aimAngle === null ? player.angle : intent.aimAngle);
    if (snapped !== null) intent.aimAngle = snapped;
  }

  return intent;
}

/* =========================================================
   HUD
   ========================================================= */

function updateHud(force) {
  const player = world.player;
  const weapon = WEAPONS[player.weapon];

  if (force || ui.weapon.textContent !== weapon.name) ui.weapon.textContent = weapon.name;

  if (weapon.kind === 'gun') {
    ui.ammo.innerHTML = '<i></i>'.repeat(Math.max(0, player.ammo));
    ui.ammo.dataset.empty = player.ammo === 0 ? '1' : '0';
  } else {
    ui.ammo.innerHTML = '';
    ui.ammo.dataset.empty = '0';
  }

  const player2 = world.player;
  const loaded = formFor(player2.stack);
  const key = player2.stack.join('') + (player2.charging || '') + (player2.chargeLeft > 0 ? '+' : '');

  if (force || ui.stack.dataset.key !== key) {
    ui.stack.dataset.key = key;
    let slots = '';
    for (let i = 0; i < STACK_LIMIT; i += 1) {
      const element = player2.stack[i];
      if (element) {
        slots += `<i style="background:${colourOf(element)};box-shadow:0 0 8px ${colourOf(element)}"></i>`;
      } else if (i === player2.stack.length && player2.chargeLeft > 0) {
        slots += `<i class="is-charging" style="border-color:${colourOf(player2.charging)}"></i>`;
      } else {
        slots += '<i></i>';
      }
    }
    ui.stack.innerHTML = slots;
    ui.form.textContent = loaded ? loaded.form.name : '';
    ui.form.hidden = !loaded;
  }

  ui.kills.textContent = `${world.kills}/${world.total}`;
  ui.clock.textContent = formatTime(world.time);

  ui.score.textContent = score.state.score;

  const combo = score.state.combo;
  if (combo > 1) {
    if (ui.combo.hidden || ui.combo.dataset.value !== String(combo)) {
      ui.combo.hidden = false;
      ui.combo.dataset.value = String(combo);
      ui.combo.firstElementChild.textContent = `×${combo}`;
      /* Пересборка анимации: без неё каждое следующее убийство не «щёлкает». */
      ui.combo.style.animation = 'none';
      void ui.combo.offsetWidth;
      ui.combo.style.animation = '';
    }
    ui.combo.lastElementChild.style.transform = `scaleX(${Math.max(0, score.state.comboLeft / 4)})`;
  } else if (!ui.combo.hidden) {
    ui.combo.hidden = true;
    ui.combo.dataset.value = '';
  }
}

function drainEvents() {
  for (const event of world.events) {
    const name = SFX_BY_EVENT[event.type];
    if (name) audio.sfx(name);

    if (event.type === 'daemon') {
      audio.sfx(event.form === 'beam' ? 'beam' : event.form === 'nova' ? 'nova' : 'zap');
      if (event.form === 'nova') vibrate(30);
    } else if (event.type === 'backfire') {
      setToast('ВСПЫШКА В ТЕСНОТЕ — СВОИМ ЖЕ', 2.4);
    } else if (event.type === 'shield') {
      setToast('ЩИТ СОРВАН', 1.2);
    }

    if (event.type === 'kill') {
      vibrate(12);
    } else if (event.type === 'death') {
      vibrate([40, 30, 90]);
      deathHold = 0.32;
    } else if (event.type === 'cleared') {
      setToast('ЭТАЖ ЧИСТ — К ВЫХОДУ', 3);
    } else if (event.type === 'dry') {
      setToast('ПУСТО', 1.2);
    } else if (event.type === 'pickup') {
      setToast(WEAPONS[world.player.weapon].name, 1.2);
    } else if (event.type === 'exit') {
      clearScreen();
    }
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (error) { /* браузер против */ }
  }
}


/* =========================================================
   КАДР
   ========================================================= */

let previous = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;

  resize();

  const raw = input.read();

  if (input.tookKey('Escape') || input.tookKey('KeyP')) {
    if (scene === 'play') pauseScreen();
    else if (scene === 'pause') { hideVeil(); scene = 'play'; }
  }

  if (input.tookKey('KeyM')) toggleMute();

  if (scene === 'play') {
    const intent = buildIntent(raw);
    update(world, dt, intent);
    score.feed(world.events);
    score.update(dt);
    drainEvents();

    const alerted = world.enemies.filter((e) => e.alive && e.state === 'chase').length;
    audio.setIntensity(world.total ? alerted / world.total : 0);

    if (world.state === 'dead') {
      deathHold = 0.32;
      scene = 'dying';
    }

    updateHud(false);
  } else if (scene === 'dying') {
    update(world, dt, { moveX: 0, moveY: 0, aimAngle: null, attack: false });
    drainEvents();
    deathHold -= dt;
    if (deathHold <= 0) deathScreen();
  } else if (world && scene !== 'call') {
    /* На паузе и после смерти мир не двигается, но кадр всё равно рисуем. */
    update(world, 0, { moveX: 0, moveY: 0, aimAngle: null, attack: false });
  }

  /* R перезапускает этаж откуда угодно, кроме экрана звонка. */
  const restart = input.tookKey('KeyR');
  if (scene === 'dead' || scene === 'dying') {
    /* После смерти перезапускает всё, что под рукой: R, пробел, удар. */
    if (restart || input.tookKey('Fire') || input.tookKey('Space') || input.tookKey('KeyJ')) {
      startLevel(level, { silent: true });
    }
  } else if (restart && (scene === 'play' || scene === 'pause')) {
    startLevel(level, { silent: true });
  }

  if (world) {
    /* Камера смотрит чуть вперёд по прицелу и догоняет быстро: на этой
       скорости мягкое слежение отстаёт и игрок упирается в край кадра. */
    const player = world.player;
    const lead = 52;
    view.x += (player.x + Math.cos(player.angle) * lead - view.x) * Math.min(1, dt * 11);
    view.y += (player.y + Math.sin(player.angle) * lead - view.y) * Math.min(1, dt * 11);
    lastView = renderer.draw(world, view);

    /*
     * Сколько мира влезло в экран — знает только камера, а нужно это ИИ.
     * Кладём радиус в мир: стрелки не станут бить из невидимого.
     */
    world.viewRadius = Math.min(
      canvas.clientWidth / (2 * lastView.zoom),
      canvas.clientHeight / (2 * lastView.zoom),
    ) - 24;
    drawSticks(raw);
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.hidden = true;
  }

  input.endFrame();
  requestAnimationFrame(frame);
}


/* Призраки стиков: палец должен видеть, что игра его поняла. */
function drawSticks(raw) {
  for (const [ghost, stick] of [[ui.ghostMove, raw.sticks.move], [ui.ghostAim, raw.sticks.aim]]) {
    if (!stick.active) { ghost.hidden = true; continue; }
    ghost.hidden = false;
    ghost.style.left = `${stick.baseX}px`;
    ghost.style.top = `${stick.baseY}px`;
    ghost.firstElementChild.style.transform = `translate(${stick.dx}px, ${stick.dy}px)`;
  }
}


/* =========================================================
   ОБВЯЗКА
   ========================================================= */

function toggleMute() {
  audio.setMuted(!audio.isMuted());
  ui.mute.dataset.off = audio.isMuted() ? '1' : '0';
  ui.mute.textContent = audio.isMuted() ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ';
}

/*
 * Размер сверяется каждый кадр, а не только по событию resize: в Safari
 * адресная строка меняет высоту окна без события, а в фоновой вкладке
 * окно какое-то время сообщает нули.
 */
function resize() {
  const width = window.innerWidth || document.documentElement.clientWidth;
  const height = window.innerHeight || document.documentElement.clientHeight;
  if (width < 1 || height < 1) return;
  /* Повтор ничего не стоит: холст сам отбросит вызов, если размер тот же. */
  renderer.resize(width, height, window.devicePixelRatio || 1);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

ui.veilAction.addEventListener('click', (event) => {
  audio.unlock();
  audio.sfx('ui');
  /* Снимаем фокус: иначе пробел в бою повторно нажимал бы эту кнопку. */
  event.currentTarget.blur();

  if (scene === 'call') startLevel(level);
  else if (scene === 'dead') startLevel(level, { silent: true });
  else if (scene === 'clear') {
    attempts = 0;
    if (hasNextFloor()) {
      levelIndex += 1;
      level = CAMPAIGN[levelIndex];
      levelCode = encode(level);
      world = createWorld(level);
      score = createScore(level, 0);
      view = { x: world.player.x, y: world.player.y };
      renderer.invalidate();
      updateHud(true);
      callScreen();
    } else {
      startLevel(level, { silent: true });
    }
  } else if (scene === 'pause') { hideVeil(); scene = 'play'; }
});

ui.veilSecond.addEventListener('click', (event) => {
  audio.sfx('ui');
  event.currentTarget.blur();
  if (scene === 'pause') startLevel(level, { silent: true });
  else if (scene === 'clear') { attempts = 0; startLevel(level, { silent: true }); }
});

ui.codeBox.addEventListener('focus', () => ui.codeBox.select());

$('copyCode').addEventListener('click', async () => {
  ui.codeBox.select();
  try {
    await navigator.clipboard.writeText(ui.codeBox.value);
    setToast('КОД СКОПИРОВАН', 1.6);
  } catch (error) {
    document.execCommand('copy');
  }
});

ui.mute.addEventListener('click', () => {
  audio.unlock();
  toggleMute();
});

for (const element of ELEMENT_ORDER) input.bindButton($(`btn-${element}`), element);
input.bindButton($('btnAttack'), 'attack');
input.bindButton($('btnPickup'), 'pickup');
input.bindButton($('btnThrow'), 'throw');

document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'play') pauseScreen();
});

/* Первое касание экрана разрешает звук: без жеста браузер его не пустит. */
const wake = () => { audio.unlock(); window.removeEventListener('pointerdown', wake); };
window.addEventListener('pointerdown', wake);

/*
 * Диагностический вход. Через него проверяется то, что не проверить
 * снаружи: дошло ли нажатие до мира и в каком состоянии игра. Ничего не
 * меняет — только отдаёт ссылки на живые объекты.
 */
window.avto = {
  get world() { return world; },
  get scene() { return scene; },
  get level() { return level; },
};

const fromHash = levelFromHash();
if (fromHash) { level = fromHash; custom = true; }

resize();
levelCode = encode(level);
world = createWorld(level);
score = createScore(level, 0);
view = { x: world.player.x, y: world.player.y };
updateHud(true);
callScreen();
ui.mute.dataset.off = audio.isMuted() ? '1' : '0';
ui.mute.textContent = audio.isMuted() ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ';
requestAnimationFrame(frame);
