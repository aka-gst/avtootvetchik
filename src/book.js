/*
 * ТЕХНОМАГИЯ — книга заклинаний: что игрок уже знает.
 *
 * Составов двадцать пять, именных заклинаний десять, и до этого модуля
 * всё это было скрытым содержимым: игра их считала, а игрок о них не
 * знал. Разница между «в игре есть двадцать пять веществ» и «игрок нашёл
 * девять из двадцати пяти» — вся, какая есть: первое никого не держит,
 * второе показывает пустые строки, и их хочется закрыть.
 *
 * Книга ничего не открывает и ничего не запрещает. Набрать можно что
 * угодно с первой секунды — записывается только то, что уже выпускал.
 * Это не дерево умений: незнание тут не стена, а незаполненная строка.
 *
 * Хранится в браузере рядом с рекордами. Приватный режим её потеряет — и
 * это допустимо: книга не пропуск, а память.
 */

import { ELEMENT_ORDER, ELEMENTS, FORMS, SIGNATURES, allSubstances, substanceOf } from './magic.js';

const KEY = 'technomagic.book.v1';

export function loadBook() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      substances: new Set(Array.isArray(raw.substances) ? raw.substances : []),
      signatures: new Set(Array.isArray(raw.signatures) ? raw.signatures : []),
    };
  } catch (error) {
    return { substances: new Set(), signatures: new Set() };
  }
}

export function saveBook(book) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      substances: [...book.substances],
      signatures: [...book.signatures],
    }));
  } catch (error) {
    /* приватный режим: книга не переживёт вкладку, но игре это не мешает */
  }
}

/*
 * Записать выпущенное. Возвращает только новое — на нём и держится
 * сообщение «НАЙДЕНО»: сказать про находку надо один раз, а не каждый
 * раз, когда игрок повторяет привычную очередь.
 */
export function noteSpell(book, event) {
  const found = { substance: null, signature: null };

  if (event.substance && !book.substances.has(event.substance)) {
    book.substances.add(event.substance);
    found.substance = substanceOf(event.substance.split('+'));
  }

  if (event.signature && !book.signatures.has(event.signature)) {
    book.signatures.add(event.signature);
    found.signature = Object.values(SIGNATURES).find((sign) => sign.id === event.signature) || null;
  }

  if (found.substance || found.signature) saveBook(book);
  return found;
}

export function bookCount(book) {
  return {
    substances: book.substances.size,
    substancesTotal: allSubstances().length,
    signatures: book.signatures.size,
    signaturesTotal: Object.keys(SIGNATURES).length,
  };
}

/*
 * Страницы книги. Неоткрытая запись показывает не пустоту, а форму
 * пустоты: сколько стихий в составе. Пустая клетка не зовёт, а «состав из
 * трёх, а у тебя таких пять» — зовёт.
 */
export function bookPages(book) {
  const substances = allSubstances().map((substance) => ({
    id: substance.id,
    known: book.substances.has(substance.id),
    name: substance.name,
    note: substance.note,
    colour: substance.colour,
    elements: substance.elements,
    size: substance.elements.length,
  }));

  /*
   * Именное заклинание показывается, как только известно его вещество:
   * игрок должен видеть, что в ЛАВЕ что-то есть, и искать порядок, а не
   * гадать, существует ли вообще то, что он ищет.
   */
  const signatures = Object.entries(SIGNATURES).map(([key, sign]) => {
    const [substanceId, formId] = key.split('|');
    const substance = substanceOf(substanceId.split('+'));
    const hinted = book.substances.has(substanceId);

    return {
      id: sign.id,
      known: book.signatures.has(sign.id),
      hinted,
      name: sign.name,
      note: sign.note,
      substance: substance.name,
      colour: substance.colour,
      elements: substance.elements,
      form: FORMS[formId] ? FORMS[formId].name : formId,
      formHint: FORMS[formId] ? FORMS[formId].hint : '',
    };
  });

  return { substances, signatures };
}

/* Подпись стихий составом — одними значками, чтобы влезало в клетку. */
export function elementMarks(elements) {
  return ELEMENT_ORDER
    .filter((id) => elements.includes(id))
    .map((id) => ELEMENTS[id]);
}
