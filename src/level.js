/*
 * ТЕХНОМАГИЯ — формат уровня и код комнаты.
 *
 * Уровень целиком помещается в строку: сетка тайлов и список сущностей
 * пакуются в биты, биты — в base64url. Строка и есть код комнаты. Сервера
 * нет, потерять уровень некому: код, записанный на салфетке год назад,
 * откроется и завтра.
 *
 * Цена решения — длина. Код на 30×20 с десятком врагов выходит примерно
 * 120–200 символов: это не «A7K2QP», а абзац. Зато он самодостаточен.
 *
 * Раскладка потока (биты идут подряд, старшим вперёд):
 *
 *   версия        4    формат может расти, старые коды остаются читаемыми
 *   стихии        5    какие стихии даёт этаж (только с версии 2)
 *   ширина-1      6    1..64
 *   высота-1      6
 *   тема          3    палитра и обстановка
 *   трек          4    какой музыке играть
 *   старт X       6    клетка, откуда входит игрок
 *   старт Y       6
 *   старт угол    3    шаг 45°
 *   тайлы       RLE    пары (тип 3 или 4, длина-1 6), пока не наберётся w*h
 *                      с версии 3 тип занимает 4 бита: предметов стало
 *                      больше восьми, и трёх бит перестало хватать
 *   сущностей     7    0..127
 *   сущность     19    тип 4, X 6, Y 6, угол 3
 *   контроль      8    хвостовой байт: битый код должен падать сразу
 *
 * Тайлы и сущности нумеруются один раз и навсегда: добавлять новые типы
 * можно, менять номера существующих — нет, иначе чужие коды поедут.
 */

export const FORMAT_VERSION = 3;

/*
 * Порядок битов маски стихий заморожен навсегда — как номера тайлов.
 * Он намеренно свой, а не взятый из magic.js: там порядок может меняться
 * ради книги и подсказок, а здесь его изменение сломало бы чужие коды.
 *
 * Версия 1 маски не знала: её коды писались, когда стихий было три, и
 * читаются как «огонь, вода, ветер».
 */
export const ELEMENT_BITS = ['fire', 'water', 'wind', 'earth', 'bolt'];

/* Ширина типа клетки в потоке. Версии 1 и 2 писали три бита и читаются
   как есть: там предметов ещё не было. */
const TILE_BITS = 4;
const V1_ELEMENTS = ['fire', 'water', 'wind'];

export function elementMask(elements) {
  let mask = 0;
  for (let i = 0; i < ELEMENT_BITS.length; i += 1) {
    if (elements.includes(ELEMENT_BITS[i])) mask |= 1 << i;
  }
  return mask;
}

export function elementsFromMask(mask) {
  const out = ELEMENT_BITS.filter((id, i) => mask & (1 << i));
  /* Этаж без единой стихии пройти нельзя — считаем такой код старым. */
  return out.length ? out : V1_ELEMENTS;
}

/*
 * Размер клетки живёт здесь, а не в мире: на него смотрят и поле, и
 * отрисовка, и сам мир. Из level.js никто ничего не импортирует, поэтому
 * кольца импортов из-за этой константы не получится.
 */
export const TILE_SIZE = 32;

/* Пол проходим и прозрачен — всё остальное чем-нибудь да мешает. */
export const TILE = {
  FLOOR: 0,
  WALL: 1,
  DOOR: 2,   /* проходима, но не просматривается: створка закрыта */
  GLASS: 3,  /* видно насквозь, пройти нельзя, пуля разбивает */
  EXIT: 4,   /* выход, открывается после зачистки */
  TABLE: 5,  /* мебель: держит и тело, и пулю, но не взгляд */
  RUG: 6,    /* только вид */
  /*
   * Щиток. Единственный предмет в игре, который делает шум НЕ ТАМ, ГДЕ
   * игрок. Всё остальное, что гремит, гремит под ногами у того, кто это
   * устроил, — и потому годится, чтобы убивать, но не чтобы отвлекать.
   *
   * Разряд в щиток на другом конце комнаты уводит стражу туда, и это
   * первый способ пройти этаж, никого не убив.
   */
  PANEL: 7,

  /*
   * Предметы со своей стихией. Каждый ломается ровно одним веществом, и
   * это правило комнаты, а не боя: игрок читает форму предмета и понимает,
   * что набирать. Номера начинаются с восьми, поэтому с версии 3 тип
   * клетки занимает четыре бита.
   */
  BARREL: 8,   /* бочка с водой: вскрывается многим, вода разливается */
  BOULDER: 9,  /* валун: берёт только земля */
  CRYSTAL: 10, /* кристалл: берёт только молния, и сам бьёт разрядом */
  HAY: 11,     /* стог соломы: сквозь него не видно, и он горит */
};

/*
 * Чем что ломается — списком, а не одной чертой.
 *
 * Тонкая бочка поддаётся многому: огню, разряду, тяжёлому удару землёй.
 * Валун и кристалл — ровно одному, и в этом их смысл: они не препятствие,
 * а вопрос «чем именно». Разница между «ломается многим» и «ломается
 * одним» и есть вся тактика вокруг предметов.
 *
 * Проверяется черта вещества, а не стихия: лаву и жар роднит огонь, и оба
 * вскрывают бочку. Перечислять составы поимённо значило бы переписывать
 * этот список при каждой новой смеси.
 */
export const TILE_WEAKNESS = {
  [TILE.BARREL]: ['burn', 'shock', 'crush'],
  [TILE.BOULDER]: ['crush'],
  [TILE.CRYSTAL]: ['shock'],
  [TILE.HAY]: ['burn'],

  /*
   * Дерево горит. Всё дерево, а не только солома.
   *
   * До этой строки огонь перекидывался по копне клетка за клеткой, а
   * деревянную скамью рядом не трогал — то есть мир отвечал «дерево
   * горит» и тут же «а вот это дерево нет». Исключение в правиле дороже
   * пустой клетки: пустая говорит «тут нечего делать», исключение
   * говорит «мир врёт», и игрок перестаёт пробовать вообще.
   */
  [TILE.TABLE]: ['burn', 'crush'],
  [TILE.DOOR]: ['burn', 'crush'],

  /* Стекло не горит и не давится — оно бьётся от резкого: разряда,
     удара и песка. Стояло в игре с самого начала и не ломалось ничем. */
  [TILE.GLASS]: ['shock', 'crush', 'shred'],

  /* Щиток замыкают разрядом. Ударом тоже — но это шумно вблизи, то есть
     ровно то, чего отвлекающий и не хочет. */
  [TILE.PANEL]: ['shock', 'crush'],
};

export const ENTITY = {
  THUG: 0,      /* с битой, идёт в лоб */
  SHOOTER: 1,   /* с пистолетом, держит дистанцию */
  DOG: 2,       /* зарезервировано */
  W_BAT: 3,     /* бита на полу */
  W_PISTOL: 4,  /* пистолет на полу */
  W_SHOTGUN: 5, /* зарезервировано */
  CIVIL: 6,     /* зарезервировано */

  /*
   * Носители щита. Номера добавлены после первых кодов — старые строки
   * от этого не поехали, потому что номер значит одно и то же навсегда.
   */
  CARRIER_FIRE: 7,
  CARRIER_WATER: 8,
  CARRIER_WIND: 9,
  CARRIER_EARTH: 10,
  CARRIER_BOLT: 11,
};

/* Экранный словарь для рисования уровней руками. */
const CHAR_TILE = {
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  ',': TILE.RUG,
  '+': TILE.DOOR,
  '|': TILE.GLASS,
  '=': TILE.TABLE,
  'X': TILE.EXIT,
  'o': TILE.BARREL,
  'O': TILE.BOULDER,
  '*': TILE.CRYSTAL,
  'h': TILE.HAY,
  'E': TILE.PANEL,
};

const CHAR_ENTITY = {
  t: ENTITY.THUG,
  s: ENTITY.SHOOTER,
  b: ENTITY.W_BAT,
  p: ENTITY.W_PISTOL,
  f: ENTITY.CARRIER_FIRE,
  w: ENTITY.CARRIER_WATER,
  v: ENTITY.CARRIER_WIND,
  e: ENTITY.CARRIER_EARTH,
  l: ENTITY.CARRIER_BOLT,
};

export function blocksMove(tile) {
  return tile === TILE.WALL || tile === TILE.GLASS || tile === TILE.TABLE
    || tile === TILE.BARREL || tile === TILE.BOULDER || tile === TILE.CRYSTAL;
}

/*
 * Солому не видно насквозь, но пройти сквозь неё можно — и в этом весь
 * смысл стога: он укрытие, в котором стоят. Тем страшнее, когда он
 * загорается вместе со стоящими.
 */
export function blocksSight(tile) {
  return tile === TILE.WALL || tile === TILE.DOOR || tile === TILE.BOULDER
    || tile === TILE.HAY;
}

export function blocksShot(tile) {
  return tile === TILE.WALL || tile === TILE.DOOR || tile === TILE.TABLE
    || tile === TILE.BARREL || tile === TILE.BOULDER || tile === TILE.CRYSTAL;
}

/* Стекло не останавливает пулю — оно от неё рассыпается. */
export function breakable(tile) {
  return tile === TILE.GLASS;
}

/* Чем ломается предмет: список черт или null, если ничем. */
export function weakTo(tile) {
  return TILE_WEAKNESS[tile] || null;
}

/* Возьмёт ли это вещество этот предмет. Одна дверь на все места, где
   спрашивают, — иначе правило разъедется по трём файлам. */
export function brokenBy(tile, traits) {
  const need = TILE_WEAKNESS[tile];
  if (!need || !traits) return false;
  return need.some((trait) => traits[trait]);
}


/* =========================================================
   БИТОВЫЙ ПОТОК
   ========================================================= */

function writer() {
  const bytes = [];
  let acc = 0;
  let used = 0;

  return {
    write(value, width) {
      for (let i = width - 1; i >= 0; i -= 1) {
        acc = ((acc << 1) | ((value >> i) & 1)) & 0xff;
        used += 1;
        if (used === 8) { bytes.push(acc); acc = 0; used = 0; }
      }
    },
    finish() {
      if (used) { bytes.push((acc << (8 - used)) & 0xff); acc = 0; used = 0; }
      return bytes;
    },
  };
}

function reader(bytes) {
  let bit = 0;

  return {
    read(width) {
      let value = 0;
      for (let i = 0; i < width; i += 1) {
        const byte = bytes[bit >> 3];
        if (byte === undefined) throw new Error('код обрывается на середине');
        value = (value << 1) | ((byte >> (7 - (bit & 7))) & 1);
        bit += 1;
      }
      return value;
    },
  };
}

/*
 * Хвостовой байт. Сложение со сдвигом, а не простая сумма: перестановка
 * двух символов в коде должна ломать контроль, иначе проверка бесполезна.
 */
function checksum(bytes) {
  let sum = 0x1f;
  for (const byte of bytes) {
    sum = (sum + byte) & 0xff;
    sum = ((sum << 1) | (sum >> 7)) & 0xff;
  }
  return sum;
}

function toBase64Url(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const normal = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}


/* =========================================================
   КОД КОМНАТЫ
   ========================================================= */

export function encode(level) {
  const bits = writer();

  bits.write(FORMAT_VERSION, 4);
  bits.write(elementMask(level.elements || ELEMENT_BITS), 5);
  bits.write(level.w - 1, 6);
  bits.write(level.h - 1, 6);
  bits.write(level.theme || 0, 3);
  bits.write(level.track || 0, 4);
  bits.write(level.spawn.x, 6);
  bits.write(level.spawn.y, 6);
  bits.write(level.spawn.angle || 0, 3);

  /* Полы идут длинными полосами — без RLE код был бы вчетверо длиннее. */
  let run = 0;
  let value = level.tiles[0];
  for (let i = 0; i <= level.tiles.length; i += 1) {
    const tile = level.tiles[i];
    if (tile === value && run < 64 && i < level.tiles.length) { run += 1; continue; }
    bits.write(value, TILE_BITS);
    bits.write(run - 1, 6);
    value = tile;
    run = 1;
  }

  const list = level.entities.slice(0, 127);
  bits.write(list.length, 7);
  for (const entity of list) {
    bits.write(entity.type, 4);
    bits.write(entity.x, 6);
    bits.write(entity.y, 6);
    bits.write(entity.angle || 0, 3);
  }

  const payload = bits.finish();
  return toBase64Url(payload.concat([checksum(payload)]));
}

export function decode(code) {
  let bytes;
  try {
    bytes = fromBase64Url(code);
  } catch (error) {
    throw new Error('это не похоже на код уровня');
  }
  if (bytes.length < 6) throw new Error('код слишком короткий');

  const payload = bytes.subarray(0, bytes.length - 1);
  if (checksum(payload) !== bytes[bytes.length - 1]) {
    throw new Error('код повреждён — потерялся символ при копировании');
  }

  const bits = reader(payload);
  const version = bits.read(4);
  if (version < 1 || version > FORMAT_VERSION) {
    throw new Error(`код версии ${version}, а игра понимает ${FORMAT_VERSION}`);
  }

  /* Старый код читается новой игрой: в этом весь смысл поля версии. */
  const elements = version >= 2 ? elementsFromMask(bits.read(5)) : V1_ELEMENTS;

  const w = bits.read(6) + 1;
  const h = bits.read(6) + 1;
  const theme = bits.read(3);
  const track = bits.read(4);
  const spawn = { x: bits.read(6), y: bits.read(6), angle: bits.read(3) };

  const tiles = new Uint8Array(w * h);
  const tileBits = version >= 3 ? TILE_BITS : 3;
  let filled = 0;
  while (filled < tiles.length) {
    const tile = bits.read(tileBits);
    const run = bits.read(6) + 1;
    for (let i = 0; i < run && filled < tiles.length; i += 1) tiles[filled++] = tile;
  }

  const count = bits.read(7);
  const entities = [];
  for (let i = 0; i < count; i += 1) {
    entities.push({
      type: bits.read(4),
      x: bits.read(6),
      y: bits.read(6),
      angle: bits.read(3),
    });
  }

  return { w, h, theme, track, spawn, tiles, entities, elements };
}


/* =========================================================
   УРОВНИ, НАРИСОВАННЫЕ РУКАМИ
   ========================================================= */

/*
 * Карта пишется картинкой, а не массивом чисел: этаж видно глазами, и
 * ошибка в планировке заметна раньше, чем игра запустится.
 */
export function fromAscii(rows, meta = {}) {
  const h = rows.length;
  const w = rows[0].length;
  for (const row of rows) {
    if (row.length !== w) throw new Error('строки карты разной длины');
  }

  const tiles = new Uint8Array(w * h);
  const entities = [];
  let spawn = null;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const char = rows[y][x];

      if (char === '@') {
        spawn = { x, y, angle: meta.spawnAngle ?? 6 };
        tiles[y * w + x] = TILE.FLOOR;
        continue;
      }

      if (char in CHAR_ENTITY) {
        entities.push({ type: CHAR_ENTITY[char], x, y, angle: 0 });
        tiles[y * w + x] = TILE.FLOOR;
        continue;
      }

      const tile = CHAR_TILE[char];
      if (tile === undefined) throw new Error(`неизвестный символ карты: ${char}`);
      tiles[y * w + x] = tile;
    }
  }

  if (!spawn) throw new Error('на карте нет входа игрока (@)');

  return {
    w, h, tiles, entities, spawn,
    theme: meta.theme || 0,
    track: meta.track || 0,
    /* Этаж, ничего не сказавший про стихии, даёт все: молчание автора
       не должно означать запрет. Кампания говорит про каждый этаж. */
    elements: meta.elements || [...ELEMENT_BITS],
    title: meta.title || '',
    call: meta.call || '',
  };
}
