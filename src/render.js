/*
 * ТЕХНОМАГИЯ — отрисовка. Вид сверху.
 *
 * Изометрию пробовали и убрали. Объём она давала, но забирала то, ради
 * чего эта игра существует: читаемость поля. Всё здесь решается по
 * клеткам — где лужа, докуда достанет цепь, попадёт ли конус, — а ромб
 * заставляет глаз пересчитывать сетку в уме и врёт о расстояниях: путь по
 * диагонали выглядит вдвое длиннее, чем он есть. Плюс любая ограда перед
 * игроком закрывала его самого, и это лечилось прозрачностью, то есть
 * ещё одним слоем условности поверх первого.
 *
 * Сверху клетка есть клетка. Ни одного пересчёта, ни одного заслона.
 *
 * От изометрии остались палитра и маги: ночной кибер-парк никуда не делся,
 * поменялась только точка, с которой на него смотрят.
 *
 * Пол печётся один раз в отдельный холст: он не меняется, пока не разбили
 * стекло или не вскрыли бочку, а тысяча клеток каждый кадр — чистая трата.
 */

import { TILE, TILE_SIZE, weakTo } from './level.js';
import { BODY } from './world.js';
import { colourOf, CHARGE_STEP } from './magic.js';
import { GROUND, FIRE_CATCH, groundAt, conducts } from './field.js';

const HALF = TILE_SIZE / 2;

/*
 * Фонари стоят по клеткам ограды детерминированно, а не случайно: этаж
 * обязан выглядеть одинаково при каждом заходе, иначе выученная комната
 * перестаёт быть выученной.
 */
function hasLamp(tx, ty) {
  return ((tx * 7 + ty * 13) % 11) === 0;
}

/*
 * Кибер-парк ночью. Палитра держится на одном правиле: земля тёмная и
 * холодная, светятся только кромки и стихии. Стихии — единственный
 * источник насыщенного цвета в кадре, потому что по цвету здесь читают
 * правила: чем светится враг, тем его не убить.
 */
export const THEMES = [
  {
    name: 'парк',
    sky: '#050b0c',
    ground: '#16342d', groundAlt: '#1a3d34',
    path: '#1f343c', pathAlt: '#243c46',
    seam: '#0b1e1b',
    wall: '#030c0a', wallTop: '#0a1c17', wallEdge: '#3dffb4',
    gate: '#2de0ff',
    glass: '#8ff5ff',
    bench: '#33463c', benchEdge: '#ffc95a',
    rug: '#10463f', rugEdge: '#3dffb4',
    exit: '#3dffb4',
  },

  /* Подстанция: бетон и лиловый свет. Здесь не растёт ничего. */
  {
    name: 'подстанция',
    sky: '#08070e',
    ground: '#242430', groundAlt: '#2a2a37',
    path: '#2d2c3c', pathAlt: '#333143',
    seam: '#141320',
    wall: '#0c0a14', wallTop: '#191428', wallEdge: '#c07bff',
    gate: '#c07bff',
    glass: '#c8b6ff',
    bench: '#3d3750', benchEdge: '#ffb347',
    rug: '#2e2450', rugEdge: '#c07bff',
    exit: '#7dffdc',
  },
];

/* Одежда магов. Игрок светлее всех: его надо находить в свалке мгновенно. */
const ROBES = {
  player: { robe: '#2b5f86', robeLit: '#59a8cf', trim: '#9df9ff', hood: '#0d1c28' },
  thug:   { robe: '#3a2030', robeLit: '#6b3b53', trim: '#ff6a86', hood: '#1d0f18' },
  caster: { robe: '#2a2340', robeLit: '#4d4175', trim: '#b98cff', hood: '#150f22' },
  carrier:{ robe: '#20323a', robeLit: '#3a5c6c', trim: '#8fe6ff', hood: '#101d22' },
  dead:   { robe: '#22242a', robeLit: '#2c2f36', trim: '#4a4e57', hood: '#141519' },
};


export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  const floorLayer = document.createElement('canvas');
  const floorCtx = floorLayer.getContext('2d');
  let bakedFor = null;

  let viewW = 0;
  let viewH = 0;
  let dpr = 1;

  function resize(cssW, cssH, ratio) {
    const next = Math.min(ratio || 1, 2.5);
    if (viewW === cssW && viewH === cssH && dpr === next) return;

    dpr = next;
    viewW = cssW;
    viewH = cssH;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  /*
   * Масштаб от короткой стороны экрана. По ней же считается, как далеко
   * игрок видит, — а от этого зависит, с какого расстояния враги
   * открывают огонь. Иначе на телефоне убивают из-за края кадра.
   */
  function zoomFor() {
    const short = Math.min(viewW, viewH);
    return Math.max(1.05, Math.min(2, short / 520));
  }


  /* =======================================================
     ПОЛ
     ======================================================= */

  function bake(world) {
    const theme = THEMES[world.level.theme] || THEMES[0];
    const w = world.w * TILE_SIZE;
    const h = world.h * TILE_SIZE;

    if (floorLayer.width !== w || floorLayer.height !== h) {
      floorLayer.width = w;
      floorLayer.height = h;
    }

    floorCtx.fillStyle = theme.seam;
    floorCtx.fillRect(0, 0, w, h);

    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        const tile = world.tiles[ty * world.w + tx];
        if (tile === TILE.WALL) continue;

        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;
        const odd = (tx + ty) & 1;

        /* Дорожка отличается от газона не яркостью, а холодом: по ней
           видно, где ходят, и куда комната сама ведёт игрока. */
        const walkway = tile === TILE.DOOR || tile === TILE.EXIT;
        floorCtx.fillStyle = walkway
          ? (odd ? theme.path : theme.pathAlt)
          : (odd ? theme.ground : theme.groundAlt);
        floorCtx.fillRect(px, py, TILE_SIZE - 1, TILE_SIZE - 1);

        if (tile === TILE.RUG) {
          floorCtx.fillStyle = theme.rug;
          floorCtx.fillRect(px + 1, py + 1, TILE_SIZE - 3, TILE_SIZE - 3);
          floorCtx.strokeStyle = theme.rugEdge;
          floorCtx.globalAlpha = 0.28;
          floorCtx.strokeRect(px + 3.5, py + 3.5, TILE_SIZE - 8, TILE_SIZE - 8);
          floorCtx.globalAlpha = 1;
        }
      }
    }

    /* Пятна фонарей печатаются вместе с полом: свет неподвижен, а
       пересчитывать градиенты каждый кадр — самое дорогое в canvas. */
    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        if (world.tiles[ty * world.w + tx] !== TILE.WALL || !hasLamp(tx, ty)) continue;
        const cx = tx * TILE_SIZE + HALF;
        const cy = ty * TILE_SIZE + HALF;
        const r = TILE_SIZE * 2.8;
        const glow = floorCtx.createRadialGradient(cx, cy, 2, cx, cy, r);
        glow.addColorStop(0, hexToRgba(theme.wallEdge, 0.2));
        glow.addColorStop(1, hexToRgba(theme.wallEdge, 0));
        floorCtx.save();
        floorCtx.globalCompositeOperation = 'lighter';
        floorCtx.fillStyle = glow;
        floorCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
        floorCtx.restore();
      }
    }

    bakedFor = world;
  }

  function invalidate() { bakedFor = null; }


  /* =======================================================
     СТЕНЫ, СТЕКЛО, МЕБЕЛЬ, ПРЕДМЕТЫ
     =======================================================
     Сверху высоты нет, и объём подделывается одной вещью —
     подсвеченной кромкой. Её достаточно: стена читается как
     масса, а не как дырка, и при этом не закрывает никого.
     ======================================================= */

  function drawWalls(g, world, theme) {
    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        const tile = world.tiles[ty * world.w + tx];
        if (tile !== TILE.WALL) continue;

        const px = tx * TILE_SIZE;
        const py = ty * TILE_SIZE;

        g.fillStyle = theme.wall;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.fillStyle = theme.wallTop;
        g.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

        /* Кромка рисуется только там, где рядом пол: сплошной массив
           ограды не должен превращаться в сетку из светящихся квадратов. */
        g.strokeStyle = theme.wallEdge;
        g.globalAlpha = 0.75;
        g.lineWidth = 1.5;
        g.beginPath();
        if (ty + 1 < world.h && world.tiles[(ty + 1) * world.w + tx] !== TILE.WALL) {
          g.moveTo(px, py + TILE_SIZE - 0.5); g.lineTo(px + TILE_SIZE, py + TILE_SIZE - 0.5);
        }
        if (tx + 1 < world.w && world.tiles[ty * world.w + tx + 1] !== TILE.WALL) {
          g.moveTo(px + TILE_SIZE - 0.5, py); g.lineTo(px + TILE_SIZE - 0.5, py + TILE_SIZE);
        }
        if (ty > 0 && world.tiles[(ty - 1) * world.w + tx] !== TILE.WALL) {
          g.moveTo(px, py + 0.5); g.lineTo(px + TILE_SIZE, py + 0.5);
        }
        if (tx > 0 && world.tiles[ty * world.w + tx - 1] !== TILE.WALL) {
          g.moveTo(px + 0.5, py); g.lineTo(px + 0.5, py + TILE_SIZE);
        }
        g.stroke();
        g.globalAlpha = 1;

        if (hasLamp(tx, ty)) {
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = theme.wallEdge;
          g.globalAlpha = 0.45;
          g.beginPath();
          g.arc(px + HALF, py + HALF, 7, 0, 6.29);
          g.fill();
          g.globalAlpha = 1;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(px + HALF, py + HALF, 2.4, 0, 6.29);
          g.fill();
          g.restore();
        }
      }
    }
  }

  function drawProps(g, world, theme) {
    for (let i = 0; i < world.tiles.length; i += 1) {
      const tile = world.tiles[i];
      if (tile === TILE.FLOOR || tile === TILE.WALL || tile === TILE.RUG) continue;

      const px = (i % world.w) * TILE_SIZE;
      const py = ((i / world.w) | 0) * TILE_SIZE;
      const cx = px + HALF;
      const cy = py + HALF;

      if (tile === TILE.GLASS) {
        g.fillStyle = hexToRgba(theme.glass, 0.16);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.strokeStyle = hexToRgba(theme.glass, 0.7);
        g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        continue;
      }

      if (tile === TILE.TABLE) {
        g.fillStyle = theme.bench;
        g.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.strokeStyle = theme.benchEdge;
        g.globalAlpha = 0.55;
        g.lineWidth = 1;
        g.strokeRect(px + 2.5, py + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
        g.globalAlpha = 1;
        continue;
      }

      if (tile === TILE.DOOR) {
        /* Створка светом, а не массой: проход должен читаться как проход. */
        g.strokeStyle = theme.gate;
        g.globalAlpha = 0.7;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px + 1, py + 1); g.lineTo(px + TILE_SIZE - 1, py + TILE_SIZE - 1);
        g.moveTo(px + TILE_SIZE - 1, py + 1); g.lineTo(px + 1, py + TILE_SIZE - 1);
        g.stroke();
        g.globalAlpha = 1;
        continue;
      }

      if (tile === TILE.EXIT) {
        const pulse = 0.4 + Math.sin(world.time * 3 + i) * 0.18;
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = hexToRgba(theme.exit, world.exitOpen ? pulse : 0.08);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.restore();
        g.strokeStyle = hexToRgba(theme.exit, world.exitOpen ? 0.9 : 0.28);
        g.lineWidth = 1.5;
        g.strokeRect(px + 2.5, py + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
        continue;
      }

      if (tile === TILE.BARREL) {
        /*
         * Бочка с водой. Форма обязана обещать содержимое: тёмный обод и
         * светящаяся вода внутри — «в ней жидкость», а не «ещё одна
         * коробка». Иначе игрок не догадается, зачем в неё бить.
         */
        g.fillStyle = '#0f2c34';
        g.beginPath();
        g.arc(cx, cy, 13, 0, 6.29);
        g.fill();

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(60,190,235,.45)';
        g.beginPath();
        g.arc(cx, cy, 9, 0, 6.29);
        g.fill();
        g.restore();

        g.strokeStyle = '#8ff0ff';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(cx, cy, 13, 0, 6.29);
        g.stroke();
        continue;
      }

      if (tile === TILE.HAY) {
        /*
         * Стог. Рисуется во всю клетку и с нахлёстом, чтобы несколько
         * стогов читались одной копной, а не рядом кубиков: за копной
         * прячутся, и её край должен быть неровным.
         */
        g.fillStyle = '#5a4520';
        g.beginPath();
        g.ellipse(cx, cy, 17, 16, 0, 0, 6.29);
        g.fill();
        g.fillStyle = '#8a6a2c';
        g.beginPath();
        g.ellipse(cx - 1, cy - 2, 14, 12, 0, 0, 6.29);
        g.fill();

        g.strokeStyle = '#c69a42';
        g.lineWidth = 1;
        g.globalAlpha = 0.65;
        for (let k = 0; k < 5; k += 1) {
          const a = (i * 7 + k * 13) % 10 / 10 * 6.29;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
          g.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 13);
          g.stroke();
        }
        g.globalAlpha = 1;
        continue;
      }

      if (tile === TILE.BOULDER) {
        /* Валун — многоугольник: камень узнаётся силуэтом, а по силуэту
           игрок вспоминает, что берёт его только земля. */
        g.fillStyle = '#3b332a';
        g.beginPath();
        g.moveTo(cx - 14, cy - 4);
        g.lineTo(cx - 6, cy - 14);
        g.lineTo(cx + 7, cy - 13);
        g.lineTo(cx + 14, cy - 1);
        g.lineTo(cx + 6, cy + 13);
        g.lineTo(cx - 8, cy + 12);
        g.closePath();
        g.fill();

        g.fillStyle = '#5d5243';
        g.beginPath();
        g.moveTo(cx - 6, cy - 14);
        g.lineTo(cx + 7, cy - 13);
        g.lineTo(cx + 2, cy - 2);
        g.lineTo(cx - 7, cy - 3);
        g.closePath();
        g.fill();
        continue;
      }

      if (tile === TILE.CRYSTAL) {
        /* Кристалл светится сам: перепутать его с камнем нельзя, потому
           что бить в него надо ровно противоположным. */
        const pulse = 0.55 + Math.sin(world.time * 3 + i) * 0.2;
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,226,90,${0.14 * pulse})`;
        g.beginPath();
        g.arc(cx, cy, 22, 0, 6.29);
        g.fill();
        g.restore();

        g.fillStyle = '#6a5a1e';
        g.beginPath();
        g.moveTo(cx, cy - 14);
        g.lineTo(cx + 9, cy + 2);
        g.lineTo(cx, cy + 13);
        g.lineTo(cx - 9, cy + 2);
        g.closePath();
        g.fill();

        g.fillStyle = `rgba(255,242,160,${0.6 + pulse * 0.3})`;
        g.beginPath();
        g.moveTo(cx, cy - 14);
        g.lineTo(cx + 9, cy + 2);
        g.lineTo(cx, cy + 4);
        g.closePath();
        g.fill();
      }
    }
  }


  /* =======================================================
     ПОЛЕ
     =======================================================
     То, что вещество оставило на полу. Рисуется клетками по
     той же сетке, по которой считается: по краю клетки
     проходит разница между «цепь достала» и «не достала»,
     и мягкое пятно об этом соврало бы.
     ======================================================= */

  function drawGround(g, world) {
    if (!world.ground) return;

    for (let i = 0; i < world.ground.length; i += 1) {
      const kind = world.ground[i];
      if (!kind) continue;

      const px = (i % world.w) * TILE_SIZE;
      const py = ((i / world.w) | 0) * TILE_SIZE;
      const fade = Math.min(1, world.groundLife[i] / 2);

      if (kind === GROUND.FIRE) {
        /*
         * Огонь рисуется на сложение: свет складывается с любым полом и
         * остаётся огнём на всех темах. С прозрачностью он на тёмной
         * земле давал тот же бурый, что и грязь, — а одно убивает,
         * другое нет.
         */
        const caught = Math.min(1, world.groundAge[i] / FIRE_CATCH);
        const flicker = 0.75 + Math.random() * 0.25;

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,${60 + Math.round(caught * 40)},10,${(0.3 + caught * 0.4) * fade * flicker})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        if (caught >= 1) {
          g.fillStyle = `rgba(255,200,70,${0.32 * flicker * fade})`;
          for (let k = 0; k < 2; k += 1) {
            const r = 4 + Math.random() * 6;
            g.beginPath();
            g.arc(px + 6 + Math.random() * (TILE_SIZE - 12),
              py + 6 + Math.random() * (TILE_SIZE - 12), r, 0, 6.29);
            g.fill();
          }
        }
        g.restore();
        continue;
      }

      if (kind === GROUND.WATER) {
        g.fillStyle = `rgba(22,86,150,${0.6 * fade})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(46,150,220,${0.24 * fade})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.restore();
        /* Блик: без него лужа читается как дырка в полу. */
        g.strokeStyle = `rgba(160,235,255,${0.32 * fade})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px + 5, py + TILE_SIZE - 8);
        g.lineTo(px + TILE_SIZE - 7, py + 6);
        g.stroke();
        continue;
      }

      if (kind === GROUND.ICE) {
        g.fillStyle = `rgba(140,215,245,${0.42 * fade})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(190,240,255,${0.2 * fade})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.restore();
        g.strokeStyle = `rgba(255,255,255,${0.4 * fade})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px + 4, py + TILE_SIZE - 10);
        g.lineTo(px + HALF, py + 8);
        g.lineTo(px + TILE_SIZE - 5, py + TILE_SIZE - 6);
        g.stroke();
        continue;
      }

      if (kind === GROUND.MUD) {
        g.fillStyle = `rgba(48,40,22,${0.78 * fade})`;
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  function drawDecals(g, world) {
    g.fillStyle = '#8d0526';
    for (const decal of world.decals) {
      g.globalAlpha = decal.a * 0.85;
      g.beginPath();
      g.ellipse(decal.x, decal.y, decal.r, decal.r * 0.85, 0, 0, 6.29);
      g.fill();
    }
    g.globalAlpha = 1;
  }


  /* =======================================================
     МАГ
     =======================================================
     Сверху видно плечи, капюшон и посох — и всё. Лица нет
     намеренно: тёмный провал капюшона читается как маг и не
     требует ни одного пикселя мимики.
     ======================================================= */

  function mage(g, o) {
    const { x, y } = o;
    const palette = o.palette;
    const dx = Math.cos(o.angle);
    const dy = Math.sin(o.angle);

    /* Тень под фигурой — единственное, что подделывает объём сверху. */
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath();
    g.ellipse(x + 1.5, y + 2, BODY + 3, BODY + 2, 0, 0, 6.29);
    g.fill();

    if (o.downed) {
      g.fillStyle = palette.robe;
      g.save();
      g.translate(x, y);
      g.rotate(o.angle);
      g.beginPath();
      g.ellipse(0, 0, BODY + 5, BODY - 1, 0, 0, 6.29);
      g.fill();
      g.restore();
      return;
    }

    /* Плащ: круг, вытянутый назад — по нему видно, куда маг повёрнут. */
    const sway = o.phase ? Math.sin(o.phase) * 0.8 : 0;
    g.save();
    g.translate(x - dx * 2, y - dy * 2);
    g.rotate(o.angle);
    const grad = g.createLinearGradient(BODY, 0, -BODY - 4, 0);
    grad.addColorStop(0, palette.robeLit);
    grad.addColorStop(1, palette.robe);
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, 0, BODY + 3 + sway, BODY + 1, 0, 0, 6.29);
    g.fill();

    /* Светящаяся кромка по плечам — та самая «техно» половина техно-мага. */
    g.strokeStyle = o.glow || palette.trim;
    g.globalAlpha = 0.6;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, BODY + 2, -2.2, 2.2);
    g.stroke();
    g.globalAlpha = 1;
    g.restore();

    /* Капюшон смещён вперёд: сверху это и есть «смотрит туда». */
    g.fillStyle = palette.hood;
    g.beginPath();
    g.arc(x + dx * 3, y + dy * 3, BODY - 3, 0, 6.29);
    g.fill();

    g.fillStyle = o.glow || palette.trim;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(x + dx * 5.5, y + dy * 5.5, 1.6, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;

    /* Посох. Он же показывает замах и выпуск: рука уходит вперёд. */
    const reach = 16 + (o.swing || 0) * 26 + (o.cast || 0) * 6;
    const handX = x + dx * 4 - dy * 7;
    const handY = y + dy * 4 + dx * 7;
    const tipX = handX + dx * reach;
    const tipY = handY + dy * reach;

    g.strokeStyle = '#0d0b12';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(handX - dx * 6, handY - dy * 6);
    g.lineTo(tipX, tipY);
    g.stroke();

    g.strokeStyle = '#6b6274';
    g.lineWidth = 1.4;
    g.stroke();

    const heat = 0.5 + (o.charging ? 0.5 : 0) + (o.cast || 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = o.glow || palette.trim;
    g.globalAlpha = Math.min(1, 0.45 * heat);
    g.beginPath();
    g.arc(tipX, tipY, 4 + heat * 2.4, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(tipX, tipY, 1.5 + heat * 0.8, 0, 6.29);
    g.fill();
    g.restore();
  }

  /*
   * Состояние тела — цветом на самом теле.
   *
   * Поле видно на полу, но решение принимают по телу: кто из этих троих
   * мокрый, а кто уже выбежал из лужи. Считать это глазами по клеткам под
   * ногами нельзя — тела движутся, а мокрым остаются ещё три секунды после
   * того, как вышли. Поэтому свечение живёт на теле, а не под ним.
   *
   * Цвет — того вещества, в котором стоят или которым облиты. Он же и есть
   * ответ на «чем его брать»: синий значит мокрый, а мокрого берёт разряд.
   */
  const STATE_COLOURS = {
    [GROUND.WATER]: '34,170,255',
    [GROUND.FIRE]: '255,90,25',
    [GROUND.ICE]: '160,230,255',
    [GROUND.MUD]: '186,152,72',
  };

  function stateMark(g, world, body_) {
    /* Горящий — не состояние, а приговор: он ярче всего и не мигает. */
    if (body_.burning > 0) {
      const flicker = 0.6 + Math.random() * 0.4;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,120,40,${0.45 * flicker})`;
      g.beginPath();
      g.arc(body_.x, body_.y, BODY + 5 + Math.random() * 3, 0, 6.29);
      g.fill();
      g.restore();
      return;
    }

    const ground = groundAt(world, body_.x, body_.y);
    const wet = (body_.wet || 0) > 0;
    const colour = STATE_COLOURS[ground] || (wet ? STATE_COLOURS[GROUND.WATER] : null);
    if (!colour) return;

    /* Слабое свечение, а не заливка: метка не должна спорить с кольцом
       стойкости — то говорит, чем НЕ брать, и оно важнее. */
    const pulse = 0.72 + Math.sin(world.time * 4 + body_.x) * 0.28;
    const r = BODY + 9;

    g.save();
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(body_.x, body_.y, 1, body_.x, body_.y, r);
    glow.addColorStop(0, `rgba(${colour},${0.34 * pulse})`);
    glow.addColorStop(0.6, `rgba(${colour},${0.2 * pulse})`);
    glow.addColorStop(1, `rgba(${colour},0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(body_.x, body_.y, r, 0, 6.29);
    g.fill();
    g.restore();

    /*
     * Отдельная метка на мокром: разряд по нему пойдёт дальше, по всей
     * связной воде. Это единственное состояние с готовым ответом, поэтому
     * оно и подписано цветом ответа — молнией. Метка появляется, только
     * если молния у игрока вообще есть: рисовать подсказку к тому, чего
     * нет в руках, — обещание, которого игра не держит.
     */
    if (conducts(world, body_) && world.elements.includes('bolt')) {
      g.strokeStyle = `rgba(255,225,77,${0.35 + pulse * 0.4})`;
      g.lineWidth = 1.6;
      g.setLineDash([3, 4]);
      g.beginPath();
      g.arc(body_.x, body_.y, BODY + 12, 0, 6.29);
      g.stroke();
      g.setLineDash([]);
    }
  }


  /* =======================================================
     ТЕЛА
     ======================================================= */

  function drawCorpses(g, world) {
    for (const corpse of world.corpses) {
      const jitter = corpse.twitch > 0 ? (Math.random() - 0.5) * corpse.twitch * 2 : 0;
      mage(g, {
        x: corpse.x + jitter, y: corpse.y, angle: corpse.angle,
        palette: ROBES.dead, phase: 0, downed: true,
      });
    }
  }

  function drawEnemies(g, world) {
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;

      stateMark(g, world, enemy);

      /*
       * Стихию врага видно всегда: она же его и защищает, поэтому кольцо
       * вокруг тела — прямая инструкция «этим цветом не бей».
       */
      if (enemy.resist) {
        const colour = colourOf(enemy.resist);
        const pulse = 0.45 + Math.sin(world.time * 6 + enemy.home.x) * 0.2;
        g.strokeStyle = colour;
        g.globalAlpha = enemy.blocked > 0 ? 1 : pulse;
        g.lineWidth = enemy.blocked > 0 ? 3 : 1.8;
        g.beginPath();
        g.arc(enemy.x, enemy.y, BODY + 7, 0, 6.29);
        g.stroke();
        g.globalAlpha = 1;
      }

      mage(g, {
        x: enemy.x, y: enemy.y, angle: enemy.angle,
        palette: ROBES[enemy.kind] || ROBES.thug,
        phase: enemy.step * 0.35,
        swing: enemy.swing || 0,
        cast: enemy.windup ? Math.min(1, enemy.windup * 3) : 0,
        charging: enemy.windup > 0,
        downed: enemy.downed > 0,
        glow: enemy.resist ? colourOf(enemy.resist)
          : (enemy.element ? colourOf(enemy.element) : null),
      });

      if (enemy.hitFlash > 0) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,255,255,${enemy.hitFlash * 3})`;
        g.beginPath();
        g.arc(enemy.x, enemy.y, BODY + 4, 0, 6.29);
        g.fill();
        g.restore();
      }
    }
  }

  function drawPlayer(g, world) {
    const player = world.player;
    if (!player.alive) return;

    /*
     * Круг под ногами у игрока горит всегда. В свалке из пяти одинаковых
     * плащей найти себя — первая задача кадра, и решать её силуэтом
     * нечестно: свой маг ничем не крупнее чужого.
     */
    const held = player.stack.length ? colourOf(player.stack[player.stack.length - 1]) : null;
    const ring = player.chargeLeft > 0 ? colourOf(player.charging) : (held || '#9df9ff');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = ring;
    g.globalAlpha = 0.5 + Math.sin(world.time * 5) * 0.12;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(player.x, player.y, BODY + 8, 0, 6.29);
    g.stroke();
    g.restore();

    stateMark(g, world, player);

    mage(g, {
      x: player.x, y: player.y, angle: player.angle,
      palette: ROBES.player,
      phase: player.step * 0.35,
      cast: player.windup > 0 ? 1 : (player.cooldown > 0 ? player.cooldown * 3 : 0),
      charging: player.chargeLeft > 0,
      glow: player.chargeLeft > 0 ? colourOf(player.charging) : (held || ROBES.player.trim),
    });

    /*
     * Очередь висит над головой, а не только в углу экрана: заряженный маг
     * должен быть виден как угроза — и себе, и в записи чужого боя.
     */
    const top = player.y - BODY - 12;
    for (let i = 0; i < player.stack.length; i += 1) {
      const colour = colourOf(player.stack[i]);
      const ox = player.x + (i - (player.stack.length - 1) / 2) * 9;
      const float = Math.sin(world.time * 4 + i) * 1.2;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = colour;
      g.globalAlpha = 0.75;
      g.beginPath();
      g.arc(ox, top + float, 5, 0, 6.29);
      g.fill();
      g.restore();

      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ox, top + float, 1.8, 0, 6.29);
      g.fill();
    }

    if (player.chargeLeft > 0) {
      const fill = 1 - player.chargeLeft / CHARGE_STEP;
      const ox = player.x + (player.stack.length - (player.stack.length - 1) / 2) * 9 - 4;
      g.strokeStyle = colourOf(player.charging);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ox, top, 5, -Math.PI / 2, -Math.PI / 2 + fill * 6.28);
      g.stroke();
    }
  }

  /* Чем ломается предмет — цветом стихии. Черта переводится в цвет один
     раз здесь: игроку показывают не слово «crush», а комок земли. */
  const WEAKNESS_COLOURS = {
    burn: '#ff5a1f',
    wet: '#4de1ff',
    freeze: '#9fe8ff',
    crush: '#d08a3e',
    shock: '#ffe14d',
  };

  function drawLock(g, world) {
    if (!world.locked) return;
    const { x, y } = world.locked;

    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.8;
    g.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + side * 14, y - 15);
      g.lineTo(x + side * 18, y - 15);
      g.lineTo(x + side * 18, y + 15);
      g.lineTo(x + side * 14, y + 15);
      g.stroke();
    }
    g.globalAlpha = 1;

    /*
     * На захваченном предмете подписано, чем его брать. Без этого игроку
     * пришлось бы помнить наизусть, что валун берёт земля, а кристалл
     * молния, — а список будет расти.
     */
    if (world.locked.prop === undefined) return;
    const need = weakTo(world.tiles[world.locked.prop]);
    if (!need) return;

    need.forEach((trait, k) => {
      const ox = x + (k - (need.length - 1) / 2) * 9;
      const oy = y - 22;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = WEAKNESS_COLOURS[trait] || '#ffffff';
      g.beginPath();
      g.arc(ox, oy, 3.4, 0, 6.29);
      g.fill();
      g.restore();
    });
  }


  /* =======================================================
     ЛЕТУЧЕЕ
     ======================================================= */

  function drawBullets(g, world) {
    for (const bullet of world.bullets) {
      const colour = bullet.colour || '#ffe06b';
      const r = bullet.nova ? 9 : 5;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = colour;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.arc(bullet.x, bullet.y, r, 0, 6.29);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(bullet.x, bullet.y, r * 0.4, 0, 6.29);
      g.fill();
      g.restore();
    }
  }

  function drawBlasts(g, world) {
    for (const blast of world.blasts) {
      const t = 1 - blast.life / blast.span;
      const fade = 1 - t;

      if (blast.kind === 'cone') {
        g.beginPath();
        g.moveTo(blast.x, blast.y);
        g.arc(blast.x, blast.y, blast.reach * (0.6 + t * 0.4),
          blast.angle - blast.arc / 2, blast.angle + blast.arc / 2);
        g.closePath();
        g.fillStyle = hexToRgba(blast.colour, fade * 0.45);
        g.fill();
        continue;
      }

      if (blast.kind === 'beam') {
        g.strokeStyle = hexToRgba(blast.colour, fade);
        g.lineWidth = 10 * fade + 2;
        g.beginPath();
        g.moveTo(blast.x, blast.y);
        g.lineTo(blast.x2, blast.y2);
        g.stroke();
        g.strokeStyle = `rgba(255,255,255,${fade})`;
        g.lineWidth = 3 * fade + 1;
        g.stroke();
        continue;
      }

      if (blast.kind === 'nova') {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = hexToRgba(blast.tint || '#ffffff', fade);
        g.lineWidth = 6 * fade + 1;
        g.beginPath();
        g.arc(blast.x, blast.y, blast.radius * (0.3 + t * 0.8), 0, 6.29);
        g.stroke();
        g.fillStyle = `rgba(255,255,255,${fade * 0.16})`;
        g.fill();
        g.restore();
      }
    }
  }

  function hexToRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
  }

  function drawPops(g, world) {
    for (const ring of world.pops) {
      const t = 1 - ring.life / ring.span;
      g.strokeStyle = `rgba(${ring.colour},${(1 - t) * 0.9})`;
      g.lineWidth = 3 * (1 - t) + 1;
      g.beginPath();
      g.arc(ring.x, ring.y, ring.r + (ring.max - ring.r) * t, 0, 6.29);
      g.stroke();
    }
  }

  function drawParticles(g, world) {
    for (const particle of world.particles) {
      g.globalAlpha = Math.max(0, particle.life / particle.max);
      g.fillStyle = particle.color;
      g.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2,
        particle.size, particle.size);
    }
    g.globalAlpha = 1;
  }

  /* Пар и пыль — единственное, что рисуется поверх тел: они их и прячут. */
  function drawClouds(g, world) {
    if (!world.clouds) return;

    for (const cloud of world.clouds) {
      const fade = Math.min(1, cloud.life / cloud.span);
      const r = cloud.r * (1 + (1 - fade) * 0.5);
      const core = cloud.kind === 'dust' ? '190,168,120' : '214,232,244';

      const grad = g.createRadialGradient(cloud.x, cloud.y, r * 0.15, cloud.x, cloud.y, r);
      grad.addColorStop(0, `rgba(${core},${0.46 * fade})`);
      grad.addColorStop(0.6, `rgba(${core},${0.28 * fade})`);
      grad.addColorStop(1, `rgba(${core},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cloud.x, cloud.y, r, 0, 6.29);
      g.fill();
    }
  }


  /* =======================================================
     КАДР
     ======================================================= */

  function draw(world, view) {
    if (bakedFor !== world || world.rebake) { bake(world); world.rebake = false; }

    const theme = THEMES[world.level.theme] || THEMES[0];
    const zoom = zoomFor();
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);

    let camX = view.x;
    let camY = view.y;
    const worldW = world.w * TILE_SIZE;
    const worldH = world.h * TILE_SIZE;
    camX = worldW <= halfW * 2 ? worldW / 2 : Math.max(halfW, Math.min(worldW - halfW, camX));
    camY = worldH <= halfH * 2 ? worldH / 2 : Math.max(halfH, Math.min(worldH - halfH, camY));

    /* Короткий наезд на попадании: кадр «клюёт» вперёд и возвращается. */
    const punch = 1 + world.fx.punch * 0.035;
    const shake = world.fx.shake;
    const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.sky;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom * punch, zoom * punch);
    ctx.translate(-camX + shakeX, -camY + shakeY);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(floorLayer, 0, 0);

    drawGround(ctx, world);
    drawDecals(ctx, world);
    drawCorpses(ctx, world);
    drawProps(ctx, world, theme);
    drawEnemies(ctx, world);
    drawLock(ctx, world);
    drawPlayer(ctx, world);
    drawBullets(ctx, world);
    drawBlasts(ctx, world);
    drawPops(ctx, world);
    drawParticles(ctx, world);
    drawWalls(ctx, world, theme);
    drawClouds(ctx, world);

    ctx.restore();

    if (world.fx.flash > 0.01) {
      ctx.fillStyle = `rgba(120,255,214,${world.fx.flash * 0.2})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    vignette(ctx, theme);

    return { zoom, camX, camY };
  }

  function vignette(g, theme) {
    const grad = g.createRadialGradient(
      viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.4,
      viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, hexToRgba(theme.sky, 0.6));
    g.fillStyle = grad;
    g.fillRect(0, 0, viewW, viewH);
  }

  /* Сверху экран и мир смотрят в одну сторону, и перевод для мыши —
     обычный сдвиг с масштабом. Отдельной дверью он остаётся потому, что
     звать его должен тот, кто не обязан знать про камеру. */
  function toWorld(screenX, screenY, last) {
    return {
      x: last.camX + (screenX - viewW / 2) / last.zoom,
      y: last.camY + (screenY - viewH / 2) / last.zoom,
    };
  }

  return { resize, draw, invalidate, toWorld };
}
