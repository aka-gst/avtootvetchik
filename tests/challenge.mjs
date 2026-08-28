/*
 * АВТООТВЕТЧИК — прогон ссылки-вызова.
 *
 *   node tests/challenge.mjs
 *
 * Ссылка — единственное, что игрок отправляет другому человеку, и
 * единственное, что переживает пересылку через мессенджеры: её режут,
 * склеивают и правят руками. Поэтому разбор проверяется отдельно от
 * игры, а не «ну она же открылась у меня».
 */

import { encodeChallenge, decodeChallenge, parseHash, buildLink, compare, cleanNick } from '../src/challenge.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

const mine = { nick: 'gst', time: 41.2, score: 4655, rank: 'A' };

/* --- упаковка --- */
const packed = encodeChallenge(mine);
check('вызов упаковывается коротко', packed.length <= 20, `${packed} (${packed.length})`);

const back = decodeChallenge(packed);
check('время переживает упаковку', Math.abs(back.time - 41.2) < 0.05, String(back.time));
check('ранг и очки на месте', back.rank === 'A' && back.score === 4655);
check('ник приводится к общему виду', back.nick === 'GST', back.nick);

/* --- ссылка целиком --- */
const link = buildLink('https://aka-gst.ru/avto/', 'GNcAUtjICCACSAD', mine);
const parsed = parseHash(link.slice(link.indexOf('#')));
check('этаж и вызов читаются из ссылки',
  parsed.code === 'GNcAUtjICCACSAD' && parsed.challenge.nick === 'GST');

/* --- порядок частей не фиксирован: ссылку правят руками --- */
const swapped = parseHash('#c=GST~412~4655~A&l=ABC');
check('порядок частей не важен', swapped.code === 'ABC' && swapped.challenge.time === 41.2);

/* --- старая ссылка без вызова --- */
const plain = parseHash('#l=ABC');
check('ссылка без вызова остаётся рабочей', plain.code === 'ABC' && plain.challenge === null);

/* --- мусор не роняет игру --- */
check('обрезанный вызов не ломает разбор', parseHash('#l=ABC&c=GST~41').challenge === null);
check('пустой адрес не ломает разбор', parseHash('').code === null);
check('вызов без этажа не выдумывает уровень', parseHash('#c=GST~412~4655~A').code === null);

/* --- сравнение забегов --- */
const faster = compare({ time: 34, score: 5000 }, back);
check('быстрее — значит вызов отбит', faster.beaten && Math.abs(faster.delta - 7.2) < 0.01,
  `${faster.delta.toFixed(1)} с`);

const slower = compare({ time: 50, score: 100 }, back);
check('медленнее — вызов не взят', !slower.beaten && Math.abs(slower.delta - 8.8) < 0.01);
check('без вызова сравнивать нечего', compare({ time: 10, score: 1 }, null) === null);

/* --- ник --- */
check('из ника вычищается лишнее', cleanNick(' g s t!@#123456789 ') === 'GST123');
check('пустой ник не роняет упаковку', encodeChallenge({ nick: '', time: 1, score: 1, rank: 'D' }).startsWith('ГОСТЬ'));

console.log(failures ? `\nПРОВАЛЕНО: ${failures}` : '\nссылка-вызов работает');
process.exit(failures ? 1 : 0);
