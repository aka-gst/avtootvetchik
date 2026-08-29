/*
 * ТЕХНОМАГИЯ — магия: стихии, составы, формы.
 *
 * У заклинания две независимые оси, и это главное решение модуля.
 *
 *   СОСТАВ (какие стихии набраны) → ВЕЩЕСТВО: что именно прилетело.
 *   УЗОР   (в каком порядке)      → ФОРМА:    куда именно прилетело.
 *
 * Раньше стихии решали только цвет: «огонь+вода» и «огонь+ветер» летели
 * одинаково, и набирать их было незачем — узор всё равно один. Теперь
 * порядок задаёт форму, а набор — вещество, и обе оси врозь: стужу можно
 * выпустить плевком, конусом или лучом, и это три разных инструмента из
 * одной пары стрелок.
 *
 * Вещества не выписаны все подряд руками — это была бы таблица на 25
 * строк, в которой половина повторяет соседей. Каждая стихия несёт черты
 * (жжёт, мочит, толкает, ломает, бьёт разрядом), черты складываются, а
 * руками названы только те смеси, у которых есть собственное лицо: пар,
 * лава, стужа, гроза. Так новая стихия не требует переписывать таблицу —
 * она дописывает свои черты и свои пары.
 *
 * Стихий пять, и открываются они не сразу: см. ELEMENT_ORDER — порядок в
 * нём и есть порядок открытия.
 */

export const ELEMENTS = {
  fire:  { id: 'fire',  name: 'ОГОНЬ',  short: 'ОГ', key: '←', colour: '#ff5a1f' },
  water: { id: 'water', name: 'ВОДА',   short: 'ВД', key: '↑', colour: '#4de1ff' },
  wind:  { id: 'wind',  name: 'ВЕТЕР',  short: 'ВТ', key: '→', colour: '#76ff9f' },
  earth: { id: 'earth', name: 'ЗЕМЛЯ',  short: 'ЗМ', key: '↓', colour: '#d08a3e' },
  bolt:  { id: 'bolt',  name: 'МОЛНИЯ', short: 'МЛ', key: '⇧', colour: '#ffe14d' },
};

export const ELEMENT_ORDER = ['fire', 'water', 'wind', 'earth', 'bolt'];

/* С чего начинают. Остальное открывается по ходу — см. progress в main.js. */
export const STARTING_ELEMENTS = ['fire', 'water', 'wind'];

export const STACK_LIMIT = 3;

/*
 * Столько длится набор одной стихии — и столько игрок стоит замедленным.
 * Оружия у игрока нет вовсе, поэтому одиночный плевок — его базовый
 * ответ, и цена первой стихии заодно задаёт темп всей игры.
 */
export const CHARGE_STEP = 0.15;


/* =========================================================
   ФОРМА: куда прилетело
   ========================================================= */

/*
 * Урон везде один — смерть, — поэтому формы различаются тем, куда
 * приходится попадание: точка, конус, линия, круг. Дальше по списку —
 * дороже по времени набора.
 */
export const FORMS = {
  spit: {
    id: 'spit', name: 'ПЛЕВОК',
    kind: 'shot', speed: 660, life: 0.32, pierce: 0, noise: 170, cooldown: 0.12,
    hint: 'одна стихия — быстро и близко',
  },
  clot: {
    id: 'clot', name: 'СГУСТОК',
    kind: 'shot', speed: 800, life: 0.5, pierce: 1, noise: 260, cooldown: 0.16,
    hint: 'две одинаковые — дальше и сквозь одного',
  },
  cone: {
    id: 'cone', name: 'ВЫДОХ',
    kind: 'cone', reach: 124, arc: 1.0, noise: 380, cooldown: 0.2,
    hint: 'две разные — короткий конус перед собой',
  },
  shard: {
    id: 'shard', name: 'ЗАЛП',
    kind: 'fan', speed: 700, life: 0.42, spread: 0.22, pierce: 0, noise: 400, cooldown: 0.22,
    hint: 'две одинаковые и третья — веер из трёх',
  },
  beam: {
    id: 'beam', name: 'ЛУЧ',
    kind: 'beam', windup: 0.26, range: 900, noise: 520, cooldown: 0.3,
    hint: 'три одинаковые — линия через всю комнату, но с замахом',
  },
  pierce: {
    id: 'pierce', name: 'ПРОБОЙ',
    kind: 'shot', speed: 640, life: 1, pierce: 99, breaks: true, noise: 460, cooldown: 0.26,
    hint: 'по краям одинаковые — идёт сквозь тела и мебель',
  },
  nova: {
    id: 'nova', name: 'ВСПЫШКА',
    kind: 'nova', radius: 104, noise: 500, cooldown: 0.3,
    hint: 'три разные — круг вокруг себя, в тесноте достанет и тебя',
  },
};

/*
 * Узор очереди. Здесь узнаются и короткие очереди: игрок потратил время и
 * должен получить ответ, даже если набрал всего одну стихию.
 */
export function shapeOf(stack) {
  if (!stack || stack.length === 0) return null;

  const [a, b, c] = stack;

  if (stack.length === 1) return FORMS.spit;
  if (stack.length === 2) return a === b ? FORMS.clot : FORMS.cone;

  if (a === b && b === c) return FORMS.beam;
  if (a === c && a !== b) return FORMS.pierce;
  if (a !== b && b !== c && a !== c) return FORMS.nova;

  /* AAB и ABB — не узор, но и не пустота: веер. */
  return FORMS.shard;
}


/* =========================================================
   ВЕЩЕСТВО: что прилетело
   ========================================================= */

/*
 * Черты стихий. Каждая — глагол, а не число: жжёт, мочит, толкает,
 * ломает, бьёт разрядом. Числа рядом (reach, speed) правят полёт формы,
 * и по ним видно характер: земля летит коротко и тяжело, ветер — далеко
 * и быстро, молния почти мгновенно.
 */
const BASE = {
  fire:  { burn: 1 },
  water: { wet: 1, douse: 1 },
  wind:  { gust: 1, reach: 1.35, speed: 1.25 },
  earth: { crush: 1, reach: 0.75, speed: 0.8 },
  bolt:  { shock: 1, speed: 1.6 },
};

/*
 * Смеси с собственным лицом. Ключ — стихии по ELEMENT_ORDER через плюс.
 *
 * `traits` тут не дополняют сложенное, а заменяют его целиком: у пара нет
 * ни огня, ни воды, он не жжёт и не мочит — иначе «огонь+вода» осталось бы
 * механической суммой, а скрещивание должно давать третье, а не оба сразу.
 *
 * `ground` — что остаётся на полу, `cloud` — что повисает в воздухе. Это
 * и есть та часть, ради которой затевалось: вещество живёт после
 * попадания и встречается со следующим заклинанием.
 */
const MIXES = {
  /* --- пары --- */
  'fire+water': {
    name: 'ПАР', colour: '#cfe9ff', cloud: 'steam',
    traits: { steam: 1, douse: 1, reach: 1.1 },
    note: 'слепит и гасит пожар, но никого не жжёт',
  },
  'fire+wind': {
    name: 'ЖАР', colour: '#ff8a2b', ground: 'fire',
    traits: { burn: 1, gust: 1, reach: 1.5, speed: 1.4 },
    note: 'раздутый огонь: дальше всех и оставляет пожар',
  },
  'fire+earth': {
    name: 'ЛАВА', colour: '#ff6a2a', ground: 'fire',
    traits: { burn: 1, crush: 1, reach: 0.7, speed: 0.7, lasting: 1 },
    note: 'тяжёлая и близкая, зато горит долго',
  },
  'fire+bolt': {
    name: 'ПЛАЗМА', colour: '#ffb648',
    traits: { burn: 1, shock: 1, speed: 1.7 },
    note: 'быстрая и поджигает',
  },
  'water+wind': {
    name: 'СТУЖА', colour: '#9fe8ff', ground: 'ice',
    traits: { freeze: 1, douse: 1, reach: 1.2 },
    note: 'морозит тела и стелет лёд под ноги',
  },
  'water+earth': {
    name: 'ГРЯЗЬ', colour: '#8d7a4a', ground: 'mud',
    traits: { wet: 1, douse: 1, mire: 1, reach: 0.8, speed: 0.75 },
    note: 'вязкая: кто в ней, тот еле идёт',
  },
  'water+bolt': {
    name: 'РАЗРЯД', colour: '#8ff0ff', ground: 'water',
    traits: { wet: 1, shock: 2, speed: 1.5 },
    note: 'сам себе лужа — цепь бьёт всегда',
  },
  'wind+earth': {
    name: 'ПЕСОК', colour: '#d8b46a', cloud: 'dust',
    traits: { crush: 1, gust: 1, shred: 1, reach: 1.1 },
    note: 'сечёт мебель и стекло, поднимает пыль',
  },
  'wind+bolt': {
    name: 'ГРОМ', colour: '#fff2a8',
    traits: { shock: 1, gust: 1, deafen: 1, reach: 1.3, speed: 1.5 },
    note: 'слышно на весь этаж, и это его беда',
  },
  'earth+bolt': {
    name: 'МАГНИТ', colour: '#c8c04a',
    traits: { pull: 1, crush: 1, speed: 0.9 },
    note: 'стягивает тела в кучу — дальше решай сам',
  },

  /* --- тройки --- */
  'fire+water+wind': {
    name: 'ТУМАН', colour: '#e2f2ff', cloud: 'steam',
    traits: { steam: 1, gust: 1, douse: 1, reach: 1.6 },
    note: 'пар по всей комнате: этаж слепнет',
  },
  'fire+water+earth': {
    name: 'ГЕЙЗЕР', colour: '#bcd8d0', cloud: 'steam',
    traits: { steam: 1, crush: 1, launch: 1 },
    note: 'бьёт снизу и подкидывает',
  },
  'fire+water+bolt': {
    name: 'ПЕРЕГРЕВ', colour: '#ffd9a8', cloud: 'steam',
    traits: { steam: 1, shock: 1, speed: 1.4 },
    note: 'пар под током',
  },
  'fire+wind+earth': {
    name: 'ПЕПЕЛ', colour: '#b08a68', ground: 'fire', cloud: 'dust',
    traits: { burn: 1, gust: 1, crush: 1 },
    note: 'жжёт и застит',
  },
  'fire+wind+bolt': {
    name: 'СМЕРЧ', colour: '#ffc25a',
    traits: { burn: 1, gust: 1, shock: 1, pull: 1, reach: 1.4 },
    note: 'стягивает и жжёт разом',
  },
  'fire+earth+bolt': {
    name: 'ВУЛКАН', colour: '#ff7d3a', ground: 'fire',
    traits: { burn: 1, crush: 1, shock: 1, lasting: 1, speed: 0.8 },
    note: 'долгий пожар и разряд',
  },
  'water+wind+earth': {
    name: 'МЕТЕЛЬ', colour: '#cfe6f2', ground: 'ice',
    traits: { freeze: 1, gust: 1, crush: 1, reach: 1.3 },
    note: 'лёд широкой полосой',
  },
  'water+wind+bolt': {
    name: 'ГРОЗА', colour: '#a8f0ff', ground: 'water',
    traits: { wet: 1, shock: 2, gust: 1, reach: 1.4 },
    note: 'мочит всех и бьёт по мокрым',
  },
  'water+earth+bolt': {
    name: 'ЗЫБУН', colour: '#9a9a5a', ground: 'mud',
    traits: { mire: 1, wet: 1, shock: 1 },
    note: 'вязнут и получают разряд',
  },
  'wind+earth+bolt': {
    name: 'БУРЯ', colour: '#d9cf8a', cloud: 'dust',
    traits: { gust: 1, crush: 1, shock: 1, shred: 1, reach: 1.4 },
    note: 'всё, что летит, летит в них',
  },
};

/* Имя для смеси без собственного лица — из имён стихий. Такое бывает
   только у чистых составов, потому что все смешанные названы руками. */
function nameFor(elements) {
  return elements.map((id) => ELEMENTS[id].name).join('-');
}

/*
 * Множители складываются умножением, а не сложением: две «дальнобойные»
 * черты должны усиливать друг друга, а не давать 2.7 клетки на ровном
 * месте. Флаги-глаголы берутся по максимуму — черта либо есть, либо нет.
 */
function mergeTraits(elements) {
  const traits = { reach: 1, speed: 1 };

  for (const id of elements) {
    for (const [key, value] of Object.entries(BASE[id])) {
      if (key === 'reach' || key === 'speed') traits[key] *= value;
      else traits[key] = Math.max(traits[key] || 0, value);
    }
  }

  return traits;
}

const cache = new Map();

/*
 * Вещество по составу. Порядок в очереди сюда не попадает намеренно:
 * порядок — это форма, а состав — это вещество. Иначе игроку пришлось бы
 * помнить, что «вода-ветер» и «ветер-вода» — разные жидкости, а такое
 * знание не выводится, а зубрится.
 */
export function substanceOf(stack) {
  if (!stack || !stack.length) return null;

  const elements = ELEMENT_ORDER.filter((id) => stack.includes(id));
  const key = elements.join('+');
  if (cache.has(key)) return cache.get(key);

  const mix = MIXES[key];
  const traits = mix
    ? { reach: 1, speed: 1, ...mix.traits }
    : mergeTraits(elements);

  const substance = {
    id: key,
    name: mix ? mix.name : nameFor(elements),
    note: mix ? mix.note : '',
    elements,
    traits,
    ground: mix ? (mix.ground || null) : (elements[0] === 'fire' ? 'fire' : elements[0] === 'water' ? 'water' : null),
    cloud: mix ? (mix.cloud || null) : null,
    colour: mix ? mix.colour : ELEMENTS[elements[0]].colour,
    pure: elements.length === 1,
  };

  cache.set(key, substance);
  return substance;
}

/*
 * Все вещества разом — для книги заклинаний и для прогонов. Порядок: сперва
 * чистые, потом пары, потом тройки. Не ради красоты: в книге это ряд
 * коротких составов над рядами длинных, и по ней сразу видно, где ты уже
 * всё нашёл, а где начинается неизведанное.
 */
export function allSubstances() {
  const order = ELEMENT_ORDER;
  const pure = [];
  const pairs = [];
  const triples = [];

  for (let a = 0; a < order.length; a += 1) {
    pure.push(substanceOf([order[a]]));
    for (let b = a + 1; b < order.length; b += 1) {
      pairs.push(substanceOf([order[a], order[b]]));
      for (let c = b + 1; c < order.length; c += 1) {
        triples.push(substanceOf([order[a], order[b], order[c]]));
      }
    }
  }

  return [...pure, ...pairs, ...triples];
}


/* =========================================================
   ЗАКЛИНАНИЕ: форма плюс вещество
   ========================================================= */

/*
 * Форма — общая таблица, одна на всех, поэтому править её числа под
 * вещество нельзя: изменение осталось бы навсегда. Здесь собирается
 * копия с учтёнными множителями, и она живёт ровно один выстрел.
 */
function tune(form, traits) {
  const tuned = { ...form };
  const reach = traits.reach || 1;
  const speed = traits.speed || 1;

  if (tuned.speed) tuned.speed *= speed;
  if (tuned.life) tuned.life *= reach;
  if (tuned.reach) tuned.reach *= reach;
  if (tuned.range) tuned.range *= reach;
  if (tuned.radius) tuned.radius *= reach;
  if (traits.crush) tuned.breaks = true;
  if (traits.shred) tuned.breaks = true;

  return tuned;
}

/* =========================================================
   СИГНАТУРЫ: то, что ищут
   =========================================================
   Именные заклинания. Не третья ось и не исключение из двух
   первых: сигнатура — это конкретная пара «вещество · форма»,
   у которой есть своё имя и своя добавка. С рук игрока она
   набирается как точная последовательность — огонь-земля-огонь
   даёт БОРОЗДУ, а огонь-огонь-земля уже нет, потому что это
   другая форма.

   Ключ — пара, а не сама последовательность: одну и ту же пару
   даёт несколько порядков (земля-огонь-огонь и огонь-огонь-земля
   оба дают залп лавы), и требовать от игрока угадать, какой из
   двух «настоящий», было бы издевательством.

   Добавки объявляются флагами, а не кодом: мир умеет пять вещей —
   стелить след по всему пути, тянуть, толкать, бить разрядом вдоль
   луча и класть вещество там, где чистая стихия его не кладёт.
   Одиннадцатая сигнатура не потребует править мир, если обойдётся
   этими пятью.
   ========================================================= */

export const SIGNATURES = {
  'fire+earth|pierce': {
    id: 'furrow', name: 'БОРОЗДА', trail: true,
    note: 'лава ложится по всему пути, а не там, где встала',
  },
  'water+wind|pierce': {
    id: 'icebound', name: 'ЛЕДОСТАВ', trail: true,
    note: 'ледяная полоса через всю комнату',
  },
  'wind+earth|pierce': {
    id: 'sandblast', name: 'ПЕСКОСТРУЙ', trail: true,
    note: 'сносит мебель и стекло на всей линии',
  },
  'earth+bolt|cone': {
    id: 'grip', name: 'ХВАТКА', pull: 900,
    note: 'стягивает всех перед собой в кучу',
  },
  'wind+bolt|cone': {
    id: 'repel', name: 'ОТБОЙ', push: 1000,
    note: 'сдувает всех перед собой',
  },
  'bolt|beam': {
    id: 'arrester', name: 'РАЗРЯДНИК', chainAlong: true,
    note: 'бьёт по воде из каждой точки луча',
  },
  'water|beam': {
    id: 'channel', name: 'РУСЛО', paintBeam: true,
    note: 'чистая вода стелет русло — заготовка под молнию',
  },
  'fire|beam': {
    id: 'burnline', name: 'ПАЛ', paintBeam: true,
    note: 'чистый огонь оставляет за собой пожар',
  },
  'water+wind+bolt|nova': {
    id: 'storm', name: 'ШТОРМ', push: 780,
    note: 'мочит, бьёт и расшвыривает разом',
  },
  'fire+water+wind|nova': {
    id: 'veil', name: 'ЗАВЕСА', bigCloud: 2.6,
    note: 'пар на полкомнаты: этаж перестаёт тебя видеть',
  },
};

export function signatureKey(substance, form) {
  return `${substance.id}|${form.id}`;
}

/*
 * Всё, что нужно миру для выстрела. Возвращается и вещество целиком:
 * дальше по нему решают, что останется на полу и кого это возьмёт.
 */
export function spellOf(stack) {
  const form = shapeOf(stack);
  if (!form) return null;

  const substance = substanceOf(stack);
  const signature = SIGNATURES[signatureKey(substance, form)] || null;

  return {
    form: tune(form, substance.traits),
    base: form,
    substance,
    signature,
    elements: substance.elements,
    name: signature ? signature.name : `${substance.name} · ${form.name}`,
  };
}

/* Старое имя: мир и прогоны звали его так, и ломать их незачем. */
export const formFor = spellOf;

export function colourOf(element) {
  return (ELEMENTS[element] || ELEMENTS.fire).colour;
}
