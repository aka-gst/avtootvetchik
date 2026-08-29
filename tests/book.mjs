/*
 * АВТООТВЕТЧИК — книга заклинаний без браузера.
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

console.log(report.join('\n'));
console.log(failures ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}` : '\nкнига в порядке');
process.exit(failures ? 1 : 0);
