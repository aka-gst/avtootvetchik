/*
 * ТЕХНОМАГИЯ — картинки.
 *
 * Правило одно: **картинка ничего не обязана**. Не приехал файл, не
 * нашёлся, браузер отказался читать — рисуется то же, что рисовалось
 * раньше, фигурами. Поэтому здесь нет ни ожидания загрузки, ни экрана
 * «идёт загрузка», ни единого await: кадр не имеет права зависеть от сети.
 *
 * Три вещи, которые модуль умеет помимо загрузки, и все три — про то, как
 * из одного файла достать нужный кусок:
 *
 *   автосборка   набор 4×4 из шестнадцати клеток, номер клетки считается
 *                по соседям: где сосед такой же — край гладкий, где нет —
 *                кайма. Без этого лужа была бы квадратной, а забор — рядом
 *                отдельных столбов.
 *
 *   направления  лист мага: строки — восемь сторон света, столбцы — кадры.
 *                Спрайт не вращается: вращаемая фигура не может иметь ни
 *                света сверху, ни ирокеза, ни асимметрии.
 *
 *   перекраска   белый спрайт в цвете стихии. Красится только то, у чего
 *                цвет действительно разный: искры, дым, кольца, значки.
 *                У лужи и льда цвет свой и навсегда — их красить нечем.
 */

const IMAGES = [
  'icon-fire', 'icon-water', 'icon-wind', 'icon-earth', 'icon-bolt',

  'wall-fence', 'wall-concrete',

  'floor-asphalt-1', 'floor-asphalt-2', 'floor-asphalt-3',
  'floor-grass-1', 'floor-grass-2', 'floor-grass-3',
  'floor-paint-1', 'floor-paint-2',

  'field-water', 'field-ice', 'field-mud', 'field-fire',

  'prop-barrel', 'prop-barrel-broken', 'prop-canister', 'prop-canister-broken',
  'prop-junk', 'prop-junk-broken', 'prop-block', 'prop-block-broken',
  'prop-neon', 'prop-neon-broken', 'prop-fridge', 'prop-fridge-broken',
  'prop-wreck', 'prop-wreck-broken', 'prop-bench',

  'mage-player-idle', 'mage-player-walk', 'mage-player-cast',
  'mage-punk-idle', 'mage-punk-walk', 'mage-punk-swing',
  'mage-sparker-idle', 'mage-sparker-walk', 'mage-sparker-cast',
  'mage-warden-idle', 'mage-warden-walk',
  'mage-corpse',

  'field-flame', 'fx-spark', 'fx-smoke', 'fx-ring',
];

const loaded = new Map();
const tints = new Map();

/* Грузим все разом и молча. Ошибка загрузки — не ошибка: такой картинки
   просто нет, и на её месте останется фигура. */
export function loadArt(base = 'art') {
  if (typeof Image === 'undefined') return;

  for (const name of IMAGES) {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => loaded.set(name, image);
    image.src = `${base}/${name}.png`;
  }
}

export function art(name) {
  return loaded.get(name) || null;
}

export function hasArt(name) {
  return loaded.has(name);
}


/* =========================================================
   АВТОСБОРКА
   =========================================================
   Набор 4×4. Номер клетки — сумма битов соседей:
   верх 1, право 2, низ 4, лево 8. Первая клетка стоит сама
   по себе, шестнадцатая окружена со всех сторон.
   ========================================================= */

export function neighbourMask(world, tx, ty, same, outside) {
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return outside;
    return same(world.tiles[y * world.w + x], y * world.w + x);
  };

  return (at(tx, ty - 1) ? 1 : 0)
    | (at(tx + 1, ty) ? 2 : 0)
    | (at(tx, ty + 1) ? 4 : 0)
    | (at(tx - 1, ty) ? 8 : 0);
}

export function drawAuto(g, image, mask, x, y, size) {
  const step = image.width / 4;
  g.drawImage(image, (mask % 4) * step, ((mask / 4) | 0) * step, step, step,
    x, y, size, size);
}


/* =========================================================
   ЛИСТЫ КАДРОВ
   ========================================================= */

/* Восемь сторон света начиная с «вправо» и по часовой стрелке — тот же
   порядок, что в задании на графику. */
export function directionRow(angle) {
  const step = Math.PI / 4;
  const at = Math.round(angle / step) % 8;
  return at < 0 ? at + 8 : at;
}

/*
 * Кадр из листа «строки — направления, столбцы — кадры». Размер кадра
 * берётся из высоты: кадры квадратные, и второго списка с числами кадров
 * заводить незачем — ему негде было бы не разъехаться с файлами.
 */
export function drawDirFrame(g, image, angle, frame, x, y, size) {
  const cell = image.height / 8;
  const columns = Math.max(1, Math.round(image.width / cell));
  const row = directionRow(angle);
  const column = ((frame % columns) + columns) % columns;

  g.drawImage(image, column * cell, row * cell, cell, cell,
    x - size / 2, y - size / 2, size, size);
}

/* Полоса без направлений: кадры в ряд, слева направо. */
export function drawFrame(g, image, frame, x, y, size) {
  const columns = Math.max(1, Math.round(image.width / image.height));
  const step = image.width / columns;
  const at = ((frame % columns) + columns) % columns;

  g.drawImage(image, at * step, 0, step, image.height,
    x - size / 2, y - size / 2, size, size);
}


/* =========================================================
   ПЕРЕКРАСКА
   ========================================================= */

/*
 * Белый спрайт в цвете стихии. Перекраска стоит целого холста, поэтому
 * каждая пара «картинка + цвет» считается один раз за игру.
 */
export function tinted(name, colour) {
  const image = loaded.get(name);
  if (!image) return null;

  const key = `${name}|${colour}`;
  const have = tints.get(key);
  if (have) return have;

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext('2d');

  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, canvas.width, canvas.height);

  tints.set(key, canvas);
  return canvas;
}
