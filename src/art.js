/*
 * ТЕХНОМАГИЯ — картинки.
 *
 * До этого модуля вся игра рисовалась фигурами, и это было её свойством:
 * ничего не грузится, ничего не ждётся, нечему не приехать. Свойство
 * сохраняется и с картинками — просто иначе.
 *
 * Правило одно: **картинка ничего не обязана**. Если файл не приехал,
 * не нашёлся или браузер отказался его читать, рисуется то же, что
 * рисовалось раньше, — фигурами. Поэтому здесь нет ни ожидания загрузки,
 * ни экрана «идёт загрузка», ни единого await: кадр не имеет права
 * зависеть от сети.
 *
 * Белые спрайты (иконки стихий, лужи, пламя, искры) красятся на лету:
 * игра тонирует их цветом стихии. Перекрашенная копия кэшируется — иначе
 * каждый кадр пришлось бы заново заливать холст.
 */

const IMAGES = [
  'icon-fire', 'icon-water', 'icon-wind', 'icon-earth', 'icon-bolt',

  'prop-barrel', 'prop-barrel-broken', 'prop-hay', 'prop-hay-burnt',
  'prop-boulder', 'prop-boulder-broken', 'prop-crystal', 'prop-crystal-broken',
  'prop-bench',

  'mage-player-idle_x2', 'mage-player-walk_x4', 'mage-player-cast_x2',
  'mage-thug-idle_x2', 'mage-thug-walk_x4', 'mage-thug-swing_x2',
  'mage-caster-idle_x2', 'mage-caster-walk_x4', 'mage-caster-cast_x2',
  'mage-carrier-idle_x2', 'mage-carrier-walk_x4',
  'mage-corpse',

  'floor-grass-1', 'floor-grass-2', 'floor-grass-3',
  'floor-path-1', 'floor-path-2',
  'floor-data-1', 'floor-data-2',

  'field-water', 'field-ice', 'field-mud', 'field-fire_x4',
  'fx-spark', 'fx-smoke', 'fx-ring',
];

const loaded = new Map();
const tints = new Map();

/*
 * Грузим все разом и молча. Ошибка загрузки — не ошибка: такой картинки
 * просто нет, и на её месте останется фигура.
 */
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

/* Сколько кадров в полосе — прямо из имени. Имя и есть описание файла,
   и второму списку с числами кадров разъезжаться было бы негде. */
export function frames(name) {
  const at = name.lastIndexOf('_x');
  return at < 0 ? 1 : Number(name.slice(at + 2)) || 1;
}

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

/*
 * Кадр из полосы. Полоса горизонтальная, кадры равной ширины — так
 * записано в задании на графику, и ничего, кроме ширины, знать не нужно.
 */
export function drawFrame(g, image, index, x, y, size) {
  const count = Math.max(1, Math.round(image.width / image.height));
  const step = image.width / count;
  const at = ((index % count) + count) % count;
  g.drawImage(image, at * step, 0, step, image.height,
    x - size / 2, y - size / 2, size, size);
}
