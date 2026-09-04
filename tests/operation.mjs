/*
 * Операция Евгения: цели, люди и последствия системного уровня.
 *
 *   node tests/operation.mjs
 */

import { decode, encode, ENTITY, fromAscii } from '../src/level.js';

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const encodedLevel = fromAscii([
  '#########',
  '#@czki.X#',
  '#########',
], {
  title: 'КОНТРОЛЬ ОПЕРАЦИИ',
  elements: ['fire', 'water', 'wind', 'earth', 'bolt'],
  operation: true,
});

const restored = decode(encode(encodedLevel));
check('v5 сохраняет режим операции', restored.operation === true,
  String(restored.operation));
check('v5 сохраняет четыре новых сущности',
  [ENTITY.CIVIL, ENTITY.HOSTAGE, ENTITY.CORE, ENTITY.CANDLE]
    .every((type) => restored.entities.some((entity) => entity.type === type)),
  restored.entities.map((entity) => entity.type).join(','));

const ordinary = fromAscii(['###', '#@#', '###'], { elements: ['fire'] });
check('обычный новый уровень не становится операцией',
  decode(encode(ordinary)).operation === false,
  String(decode(encode(ordinary)).operation));

for (const line of report) console.log(line);
process.exit(failures ? 1 : 0);
