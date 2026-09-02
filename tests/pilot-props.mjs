/*
 * Пилоты предметов — технический контракт до встройки в бой.
 *
 *   node tests/pilot-props.mjs
 *
 * Ловит ровно одну поломку: принятый пилот не доехал в изолированную
 * версионированную папку или доехал не тем PNG. В боевой art/ он не лезет.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pilotDir = resolve(root, 'art/pilots/props-v2');
const expected = ['prop-barrel.png', 'prop-canister.png', 'prop-crystal.png'];

const report = [];
let failures = 0;

function check(name, ok, detail = '') {
  report.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function pngInfo(path) {
  const bytes = readFileSync(path);
  const signature = '89504e470d0a1a0a';
  const isPng = bytes.subarray(0, 8).toString('hex') === signature;
  if (!isPng || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return { isPng };
  return {
    isPng,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
  };
}

for (const name of expected) {
  const path = resolve(pilotDir, name);
  let info = null;
  let bytes = 0;
  try {
    info = pngInfo(path);
    bytes = statSync(path).size;
  } catch {
    // Отсутствующий файл — именно тот красный исход, который стережёт тест.
  }
  check(`${name}: пилот лежит в изолированной папке props-v2`, Boolean(info));
  check(`${name}: 192×192 PNG RGBA`,
    info?.isPng && info.width === 192 && info.height === 192
      && info.bitDepth === 8 && info.colourType === 6,
    info ? `${info.width}×${info.height}, depth ${info.bitDepth}, type ${info.colourType}` : 'нет файла');
  check(`${name}: файл не пустой`, bytes > 1024, `${bytes} B`);
}

/* Сцена не меняет бой: только отдаёт детерминированную раскладку пилотов. */
let createPilotPropsScene = null;
try {
  ({ createPilotPropsScene } = await import('../src/pilot-props-scene.js'));
} catch {
  // До появления сцены тест обязан быть красным, а не падать загрузкой модуля.
}

const scene = createPilotPropsScene?.();
check('сцена существует и использует настоящий асфальт',
  scene?.floor === 'art/floor-asphalt-1.png', scene?.floor || 'нет сцены');
check('сцена рисует предмет в масштабе 72×72', scene?.spriteSize === 72,
  scene ? `${scene.spriteSize}×${scene.spriteSize}` : 'нет сцены');
check('сцена показывает ровно три пилота', scene?.props?.length === 3,
  scene?.props?.length ?? 'нет сцены');
check('сцена держит пилоты в изолированной v2-папке',
  JSON.stringify(scene?.props?.map((prop) => prop.src)) === JSON.stringify([
    'art/pilots/props-v2/prop-barrel.png',
    'art/pilots/props-v2/prop-canister.png',
    'art/pilots/props-v2/prop-crystal.png',
  ]));
check('сцена не накладывает 72-пиксельные предметы друг на друга',
  Boolean(scene?.props?.every((prop, i, props) => props.slice(i + 1).every((other) =>
    Math.abs(prop.x - other.x) >= scene.spriteSize || Math.abs(prop.y - other.y) >= scene.spriteSize))));

for (const line of report) console.log(line);
if (failures) process.exitCode = 1;
else console.log('\nпилоты по техническому контракту');
