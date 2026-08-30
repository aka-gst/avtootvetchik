/*
 * ТЕХНОМАГИЯ — книга заклинаний без браузера.
 *
 *   node tests/book.mjs
 *
 * Книга — это обещание игроку: «то, что ты нашёл, записано, а ненайденное
 * видно как пробел». Обещание держится на трёх вещах, и все три проверяются
 * здесь: находка объявляется один раз, сигнатура узнаётся по точной паре
 * «вещество · форма», а не по одному составу, и ненайденное не выдаёт себя
 * раньше времени.
 */

/* Хранилища в Node нет — подкладываем то же, что даёт браузер. */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { loadBook, noteSpell, bookPages, bookCount } = await import('../src/book.js');
const { spellOf, SIGNATURES } = await import('../src/magic.js');

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

/* То, что мир кладёт в событие после выпуска. */
function eventOf(stack) {
  const spell = spellOf(stack);
  return {
    substance: spell.substance.id,
    signature: spell.signature ? spell.signature.id : null,
  };
}

/* --- A. Сигнатура — это пара, а не состав --- */
{
  check('точная последовательность даёт именное',
    spellOf(['fire', 'earth', 'fire']).signature?.name === 'БОРОЗДА');

  /*
   * Тот же состав, другой порядок — другая форма и никакой сигнатуры.
   * Ради этой строки сигнатуры и сделаны парой: если бы хватало состава,
   * искать было бы нечего, порядок ничего бы не решал, и вся вторая ось
   * оказалась бы декорацией.
   */
  check('тот же состав в другом порядке именного не даёт',
    spellOf(['fire', 'fire', 'earth']).signature === null,
    spellOf(['fire', 'fire', 'earth']).name);

  /* А вот другой порядок с той же формой — даёт: игрок ищет форму, а не
     заученную строку из трёх слов. */
  check('другой порядок с той же формой даёт то же именное',
    spellOf(['earth', 'water', 'earth']).signature
      === spellOf(['earth', 'water', 'earth']).signature);

  check('у каждой сигнатуры своё имя',
    new Set(Object.values(SIGNATURES).map((sign) => sign.name)).size
      === Object.keys(SIGNATURES).length);
}

/* --- B. Находка объявляется один раз --- */
{
  store.clear();
  const book = loadBook();

  const first = noteSpell(book, eventOf(['fire', 'earth', 'fire']));
  check('первый выпуск открывает и вещество, и заклинание',
    first.substance?.name === 'ЛАВА' && first.signature?.name === 'БОРОЗДА');

  const again = noteSpell(book, eventOf(['fire', 'earth', 'fire']));
  check('повтор ничего не открывает',
    !again.substance && !again.signature);

  const other = noteSpell(book, eventOf(['fire', 'earth']));
  check('знакомое вещество в новой форме — не находка', !other.substance);
}

/* --- C. Книга переживает перезаход --- */
{
  store.clear();
  const book = loadBook();
  noteSpell(book, eventOf(['water', 'wind']));
  noteSpell(book, eventOf(['water', 'wind', 'water']));

  const reopened = loadBook();
  const count = bookCount(reopened);
  check('запись переживает перезаход',
    reopened.substances.has('water+wind') && reopened.signatures.has('icebound'),
    `${count.substances}/${count.substancesTotal}`);
}

/* --- D. Ненайденное не выдаёт себя --- */
{
  store.clear();
  const book = loadBook();
  const blank = bookPages(book);

  check('в пустой книге не видно ни одного имени',
    blank.substances.every((entry) => !entry.known)
    && blank.signatures.every((entry) => !entry.known && !entry.hinted));

  check('но видно, из скольких стихий состав',
    blank.substances.filter((entry) => entry.size === 1).length === 5
    && blank.substances.filter((entry) => entry.size === 3).length === 10);

  noteSpell(book, eventOf(['fire', 'earth']));
  const hinted = bookPages(book).signatures.find((entry) => entry.id === 'furrow');
  check('открытое вещество подсказывает, что в нём что-то есть',
    hinted.hinted && !hinted.known && hinted.substance === 'ЛАВА');
}

/* --- След решения ------------------------------------------------------
 *
 * Комната считается получившейся не по тому, проходится ли она, а по
 * тому, сколькими разными способами её прошли. Значит след обязан быть
 * канонической формой набора правил: одно и то же решение, сыгранное в
 * другом порядке или другим темпом, обязано дать ту же строку. Иначе
 * счёт различных решений превращается в счёт прохождений.
 */
{
  const { createTrace, traceEvent, traceKey } = await import('../src/trace.js');

  const same = (events) => {
    const t = createTrace();
    for (const e of events) traceEvent(t, e);
    return traceKey(t);
  };

  const a = same([
    { type: 'barrel' },
    { type: 'daemon', elements: ['bolt'], form: 'shot', signature: null },
    { type: 'chain', size: 3 },
  ]);

  const b = same([
    { type: 'chain', size: 3 },
    { type: 'daemon', elements: ['bolt'], form: 'shot', signature: null },
    { type: 'barrel' },
    { type: 'daemon', elements: ['bolt'], form: 'shot', signature: null },
  ]);

  check('порядок и повторы не меняют след', a === b, `${a} / ${b}`);

  const c = same([
    { type: 'daemon', elements: ['fire', 'water'], form: 'cone', signature: null },
    { type: 'hay' },
  ]);
  check('другой способ даёт другой след', a !== c, `${a} / ${c}`);

  /*
   * Состав и одиночная стихия различаются — но в доставке, а не в
   * решении. Это разница между «чем ударил» и «что случилось», и
   * складывать их нельзя: иначе луч и плевок, разбившие одну и ту же
   * бочку, посчитаются двумя решениями.
   */
  const { traceDelivery } = await import('../src/trace.js');
  const доставка = (events) => {
    const t = createTrace();
    for (const e of events) traceEvent(t, e);
    return traceDelivery(t);
  };

  check('состав и одиночная стихия различаются в доставке',
    доставка([{ type: 'daemon', elements: ['fire'], form: 'shot', signature: null }])
    !== доставка([{ type: 'daemon', elements: ['fire', 'water'], form: 'shot', signature: null }]));

  check('но решением они не считаются',
    same([{ type: 'daemon', elements: ['fire'], form: 'shot', signature: null }])
    === same([{ type: 'daemon', elements: ['fire', 'water'], form: 'beam', signature: null }]),
    'разные удары по пустому месту — не разные решения');

  check('в следе нет ничего про человека',
    !/\d{3,}|код|name|nick/i.test(a + c), a + ' ' + c);
}

console.log(report.join('\n'));
console.log(failures ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}` : '\nкнига в порядке');
process.exit(failures ? 1 : 0);
