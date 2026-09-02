/*
 * Отдельная витрина пилотов. Не импортируется игрой и не меняет боевой
 * маппинг: в ней проверяют предметы до решения, какими именами они попадут
 * в runtime.
 */

export function createPilotPropsScene() {
  return {
    floor: 'art/floor-asphalt-1.png',
    width: 480,
    height: 192,
    tileSize: 48,
    spriteSize: 72,
    props: [
      { id: 'barrel', src: 'art/pilots/props-v2/prop-barrel.png', x: 48, y: 48 },
      { id: 'canister', src: 'art/pilots/props-v2/prop-canister.png', x: 192, y: 48 },
      { id: 'crystal', src: 'art/pilots/props-v2/prop-crystal.png', x: 336, y: 48 },
    ],
  };
}
