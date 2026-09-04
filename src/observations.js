/* Наблюдаемая физика: факты без рецептов и названий стихий. */

import { TILE } from './level.js';

export const WORLD_OBSERVATIONS = [{
  id: 'noise-fire',
  name: 'ШУМ ВЕДЁТ В ЛОВУШКУ',
  note: 'Услышавший идёт к месту шума, даже если там уже опасно.',
}];

export function physicalHint(world, target) {
  if (!world || !target) return '';

  if (target.worldProp?.kind === 'candle') {
    return target.worldProp.lit
      ? 'ПЛАМЯ ГОРИТ РОВНО. РЯДОМ ВСЁ ЕЩЁ МОЖЕТ ЗАНЯТЬСЯ.'
      : 'ФИТИЛЬ СУХОЙ. РЯДОМ ЛЕЖИТ ГОРЮЧЕЕ.';
  }

  if (target.prop !== undefined) {
    const tile = world.tiles[target.prop];
    if (tile === TILE.BARREL) return 'ВНУТРИ ПЛЕЩЕТСЯ ЖИДКОСТЬ. ОБОЛОЧКА ХРУПКАЯ.';
    if (tile === TILE.CRYSTAL) return 'КРИСТАЛЛ ГУДИТ И ДЕРЖИТ ВНУТРИ НАПРЯЖЕНИЕ.';
    if (tile === TILE.PANEL) return 'ЩИТОК ПОД НАПРЯЖЕНИЕМ. КОРПУС РЕЗОНИРУЕТ.';
    return '';
  }

  if (target.alive !== undefined) {
    if (!target.alive) return 'ТЕЛО НЕ ДЫШИТ.';
    if (target.downed > 0) return 'БЕЗ СОЗНАНИЯ. ДЫШИТ.';
    if (target.burning > 0) return 'ОДЕЖДА ГОРИТ. ТЕЛО ЕЩЁ ДВИЖЕТСЯ.';
    if (target.wet > 0) return 'ОДЕЖДА ПРОМОКЛА НАСКВОЗЬ.';
    return 'ДЫШИТ. ДЕРЖИТСЯ НА НОГАХ.';
  }

  return '';
}
