/*
 * ТЕХНОМАГИЯ — отрисовка. Изометрия, псевдо-объём.
 *
 * Мир остаётся плоской сеткой сверху: правила, столкновения и волна врагов
 * ничего не знают о том, как это показано. Изометрия здесь — только
 * проекция, и это принципиально. Как только высота начнёт влиять на
 * попадания, придётся объяснять игроку, почему заклинание прошло над
 * головой, — а объяснять нечем: мир двумерный.
 *
 *   экран.x = (мир.x - мир.y)
 *   экран.y = (мир.x + мир.y) / 2
 *
 * Клетка в 32 пикселя становится ромбом 64×32. Обратное преобразование
 * нужно мыши и потому живёт рядом: прицел обязан попадать туда, куда
 * показывает курсор, а не туда, где эта точка лежала бы сверху.
 *
 * Порядок рисования — построчный, и это не мелочь. Всё, что имеет высоту
 * (ограды, стекло, скамьи, тела), рисуется в одном проходе по клеткам:
 * сначала клетка, потом те, кто на ней стоит. Иначе маг за оградой
 * окажется нарисован поверх неё, и глубина рассыпется.
 *
 * Пол печётся один раз в отдельный холст: он плоский, никого не
 * загораживает, и перерисовывать тысячу ромбов каждый кадр незачем.
 */

import { TILE, TILE_SIZE } from './level.js';
import { BODY } from './world.js';
import { colourOf, CHARGE_STEP } from './magic.js';
import { GROUND, FIRE_CATCH } from './field.js';

/*
 * Фонари ставятся по клеткам ограды детерминированно, а не случайно: этаж
 * обязан выглядеть одинаково при каждом заходе, иначе выученная комната
 * перестаёт быть выученной.
 */
function hasLamp(tx, ty) {
  return ((tx * 7 + ty * 13) % 11) === 0;
}

/* Половина ромба: на неё опирается вся арифметика проекции. */
const HALF_W = TILE_SIZE;
const HALF_H = TILE_SIZE / 2;

/* Высоты в экранных пикселях. Ограда чуть выше роста — за ней прячутся. */
const WALL_H = 34;
const GLASS_H = 30;
const BENCH_H = 13;
const GATE_H = 30;

export function project(wx, wy) {
  return { x: wx - wy, y: (wx + wy) / 2 };
}

export function unproject(sx, sy) {
  return { x: sy + sx / 2, y: sy - sx / 2 };
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
    ground: '#14302b', groundAlt: '#173a31',
    path: '#1d3138', pathAlt: '#213842',
    seam: '#0a1a19',
    wallTop: '#1d4a3c', wallSide: '#0e2a22', wallDark: '#0a1f1a', wallEdge: '#3dffb4',
    gate: '#2de0ff',
    glass: '#8ff5ff',
    benchTop: '#4a5f52', benchSide: '#2b3a33', benchEdge: '#ffc95a',
    rug: '#10463f', rugEdge: '#3dffb4',
    exit: '#3dffb4',
    haze: '#0e5f4a',
  },

  /* Подстанция: бетон и лиловый свет. Здесь не растёт ничего. */
  {
    name: 'подстанция',
    sky: '#08070e',
    ground: '#22222c', groundAlt: '#282833',
    path: '#2b2a38', pathAlt: '#302f3f',
    seam: '#131219',
    wallTop: '#3a2f52', wallSide: '#1e1930', wallDark: '#161122', wallEdge: '#c07bff',
    gate: '#c07bff',
    glass: '#c8b6ff',
    benchTop: '#565068', benchSide: '#332e42', benchEdge: '#ffb347',
    rug: '#2e2450', rugEdge: '#c07bff',
    exit: '#7dffdc',
    haze: '#3a2260',
  },
];

/* Одежда магов. Игрок светлее всех: его надо находить в свалке мгновенно. */
const ROBES = {
  player: { robe: '#2b5f86', robeLit: '#59a8cf', trim: '#9df9ff', hood: '#0d1c28' },
  thug:   { robe: '#3a2030', robeLit: '#5c3348', trim: '#ff6a86', hood: '#1d0f18' },
  caster: { robe: '#2a2340', robeLit: '#453a68', trim: '#b98cff', hood: '#150f22' },
  carrier:{ robe: '#20323a', robeLit: '#345260', trim: '#8fe6ff', hood: '#101d22' },
  dead:   { robe: '#22242a', robeLit: '#2c2f36', trim: '#4a4e57', hood: '#141519' },
};


export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  const floorLayer = document.createElement('canvas');
  const floorCtx = floorLayer.getContext('2d');
  let bakedFor = null;
  let originX = 0;              /* сдвиг печёного слоя: у изометрии есть минус по x */

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
   * Масштаб от короткой стороны. В изометрии клетка вдвое шире, чем
   * сверху, поэтому и делитель другой: иначе на телефоне видно четыре
   * клетки, и играть приходится вслепую.
   */
  function zoomFor() {
    const short = Math.min(viewW, viewH);
    return Math.max(1, Math.min(2.2, short / 380));
  }


  /* =======================================================
     РОМБЫ
     ======================================================= */

  function diamond(g, x, y) {
    g.beginPath();
    g.moveTo(x, y - HALF_H);
    g.lineTo(x + HALF_W, y);
    g.lineTo(x, y + HALF_H);
    g.lineTo(x - HALF_W, y);
    g.closePath();
  }

  /* Центр клетки в экранных координатах печёного слоя. */
  function cellCentre(tx, ty) {
    const p = project(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
    return { x: p.x + originX, y: p.y };
  }


  /* =======================================================
     ПОЛ
     =======================================================
     Печётся один раз. Плоское никого не загораживает, и
     тысяча ромбов каждый кадр — это чистая трата.
     ======================================================= */

  function bake(world) {
    const theme = THEMES[world.level.theme] || THEMES[0];

    /* Ромб уходит влево на половину ширины сетки — отсюда сдвиг. */
    originX = world.h * HALF_W;
    const w = (world.w + world.h) * HALF_W;
    const h = (world.w + world.h) * HALF_H + WALL_H + 8;

    if (floorLayer.width !== w || floorLayer.height !== h) {
      floorLayer.width = w;
      floorLayer.height = h;
    }

    floorCtx.clearRect(0, 0, w, h);

    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        const tile = world.tiles[ty * world.w + tx];
        if (tile === TILE.WALL) continue;

        const c = cellCentre(tx, ty);
        const odd = (tx + ty) & 1;

        /* Дорожка отличается от газона не яркостью, а холодом: по ней
           видно, где ходят, и куда игрока ведёт сама комната. */
        const walkway = tile === TILE.DOOR || tile === TILE.EXIT;
        floorCtx.fillStyle = walkway
          ? (odd ? theme.path : theme.pathAlt)
          : (odd ? theme.ground : theme.groundAlt);
        diamond(floorCtx, c.x, c.y);
        floorCtx.fill();

        floorCtx.strokeStyle = theme.seam;
        floorCtx.lineWidth = 1;
        floorCtx.stroke();

        if (tile === TILE.RUG) {
          floorCtx.fillStyle = theme.rug;
          diamond(floorCtx, c.x, c.y);
          floorCtx.fill();
          floorCtx.strokeStyle = theme.rugEdge;
          floorCtx.globalAlpha = 0.35;
          floorCtx.stroke();
          floorCtx.globalAlpha = 1;
        }
      }
    }

    /*
     * Пятна фонарей печатаются вместе с полом: свет неподвижен, а
     * пересчитывать градиенты каждый кадр — самая дорогая вещь в canvas.
     */
    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        if (world.tiles[ty * world.w + tx] !== TILE.WALL || !hasLamp(tx, ty)) continue;
        const c = cellCentre(tx, ty);
        const r = TILE_SIZE * 2.6;
        const glow = floorCtx.createRadialGradient(c.x, c.y + 6, 2, c.x, c.y + 6, r);
        glow.addColorStop(0, hexToRgba(theme.wallEdge, 0.22));
        glow.addColorStop(1, hexToRgba(theme.wallEdge, 0));
        floorCtx.save();
        floorCtx.globalCompositeOperation = 'lighter';
        floorCtx.fillStyle = glow;
        floorCtx.translate(c.x, c.y + 6);
        floorCtx.scale(1, 0.5);
        floorCtx.beginPath();
        floorCtx.arc(0, 0, r, 0, 6.29);
        floorCtx.fill();
        floorCtx.restore();
      }
    }

    bakedFor = world;
  }

  function invalidate() { bakedFor = null; }


  /* =======================================================
     ВЫСОКОЕ
     =======================================================
     Ограды, стекло и скамьи рисуются каждый кадр вместе с
     телами: только так стоящий за оградой оказывается за
     оградой, а не поверх неё.
     ======================================================= */

  /* Блок: верхняя грань ромбом и две боковые. Третьей не видно никогда. */
  function block(g, x, y, height, top, left, right, edge) {
    g.fillStyle = left;
    g.beginPath();
    g.moveTo(x - HALF_W, y);
    g.lineTo(x, y + HALF_H);
    g.lineTo(x, y + HALF_H - height);
    g.lineTo(x - HALF_W, y - height);
    g.closePath();
    g.fill();

    g.fillStyle = right;
    g.beginPath();
    g.moveTo(x + HALF_W, y);
    g.lineTo(x, y + HALF_H);
    g.lineTo(x, y + HALF_H - height);
    g.lineTo(x + HALF_W, y - height);
    g.closePath();
    g.fill();

    g.fillStyle = top;
    diamond(g, x, y - height);
    g.fill();

    if (edge) {
      g.strokeStyle = edge;
      g.lineWidth = 1.2;
      diamond(g, x, y - height);
      g.stroke();
    }
  }

  /*
   * Изометрия платит за объём одним неизбежным неудобством: то, что стоит
   * ближе к камере, закрывает то, что дальше. Ограда перед игроком съедала
   * его целиком — маг стоял в клетке от нижней стены и превращался в
   * макушку с огоньками над ней.
   *
   * Лечится не геометрией, а честностью: клетки, которые загораживают
   * игрока, становятся прозрачными. Правило узкое — только высокое, только
   * в трёх клетках впереди и только если действительно перекрывает.
   */
  function veilsPlayer(world, tx, ty) {
    const player = world.player;
    if (!player.alive) return false;

    const px = Math.floor(player.x / TILE_SIZE);
    const py = Math.floor(player.y / TILE_SIZE);
    const ahead = (tx - px) + (ty - py);
    if (ahead <= 0 || ahead > 3) return false;
    if (tx < px - 1 || ty < py - 1) return false;

    const c = cellCentre(tx, ty);
    const p = project(player.x, player.y);
    const dx = Math.abs(c.x - (p.x + originX));
    const dy = c.y - HALF_H - p.y;
    return dx < HALF_W * 1.1 && dy > -WALL_H - 6 && dy < 14;
  }

  function tallTile(g, world, theme, tx, ty, tile) {
    const c = cellCentre(tx, ty);

    if (tile === TILE.WALL) {
      block(g, c.x, c.y, WALL_H, theme.wallTop, theme.wallDark, theme.wallSide, theme.wallEdge);

      if (hasLamp(tx, ty)) {
        const top = c.y - WALL_H;
        g.strokeStyle = '#0e1a18';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(c.x, top);
        g.lineTo(c.x, top - 20);
        g.stroke();

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = theme.wallEdge;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.ellipse(c.x, top - 21, 6, 6, 0, 0, 6.29);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(c.x, top - 21, 2.2, 2.2, 0, 0, 6.29);
        g.fill();
        g.restore();
      }
      return;
    }

    if (tile === TILE.GLASS) {
      /* Стекло прозрачно и потому рисуется краской, а не блоком: сквозь
         него должно быть видно того, кто за ним стоит. */
      g.globalAlpha = 0.3;
      block(g, c.x, c.y, GLASS_H, theme.glass, theme.glass, theme.glass, null);
      g.globalAlpha = 1;
      g.strokeStyle = theme.glass;
      g.lineWidth = 1;
      diamond(g, c.x, c.y - GLASS_H);
      g.stroke();
      return;
    }

    if (tile === TILE.TABLE) {
      block(g, c.x, c.y, BENCH_H, theme.benchTop, theme.benchSide, theme.benchSide, theme.benchEdge);
      return;
    }

    if (tile === TILE.BARREL) {
      /*
       * Бочка с водой. Форма обязана обещать содержимое: тёмный бак с
       * прозрачной полосой и бликом — «внутри жидкость», а не «ещё одна
       * коробка». Иначе игрок не догадается, зачем в неё бить.
       */
      const H = 30;
      const R = 16;

      g.fillStyle = 'rgba(0,0,0,.45)';
      g.beginPath();
      g.ellipse(c.x, c.y + 2, R, R * 0.45, 0, 0, 6.29);
      g.fill();

      g.fillStyle = '#0f2c34';
      g.beginPath();
      g.moveTo(c.x - R, c.y - 2);
      g.lineTo(c.x - R, c.y - 2 - H);
      g.lineTo(c.x + R, c.y - 2 - H);
      g.lineTo(c.x + R, c.y - 2);
      g.closePath();
      g.fill();

      /* Вода внутри светится: форма обязана обещать содержимое, иначе
         игрок не догадается, зачем в неё бить. */
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(60,190,235,.5)';
      g.fillRect(c.x - R, c.y - 4 - H * 0.5, R * 2, H * 0.5);
      g.restore();

      g.fillStyle = '#1d5566';
      g.beginPath();
      g.ellipse(c.x, c.y - 2 - H, R, R * 0.45, 0, 0, 6.29);
      g.fill();
      g.strokeStyle = '#8ff0ff';
      g.lineWidth = 1.4;
      g.stroke();

      /* Два обруча — тем и отличается бочка от ящика. */
      g.strokeStyle = '#08181e';
      g.lineWidth = 2;
      for (const k of [0.35, 0.75]) {
        g.beginPath();
        g.moveTo(c.x - R, c.y - 2 - H * k);
        g.lineTo(c.x + R, c.y - 2 - H * k);
        g.stroke();
      }
      return;
    }

    if (tile === TILE.BOULDER) {
      /* Валун: тот же блок, но с обломанной верхушкой — форма говорит
         «камень», а камень в этой игре берёт только земля. */
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.beginPath();
      g.ellipse(c.x, c.y + 2, 20, 9, 0, 0, 6.29);
      g.fill();

      /* Многогранник, а не куб: камень должен быть узнаваем силуэтом, и
         именно по силуэту игрок вспоминает, что его берёт только земля. */
      g.fillStyle = '#3b332a';
      g.beginPath();
      g.moveTo(c.x - 19, c.y - 2);
      g.lineTo(c.x - 12, c.y - 22);
      g.lineTo(c.x + 2, c.y - 30);
      g.lineTo(c.x + 16, c.y - 20);
      g.lineTo(c.x + 19, c.y - 3);
      g.lineTo(c.x + 4, c.y + 5);
      g.closePath();
      g.fill();

      g.fillStyle = '#5d5243';
      g.beginPath();
      g.moveTo(c.x - 12, c.y - 22);
      g.lineTo(c.x + 2, c.y - 30);
      g.lineTo(c.x + 16, c.y - 20);
      g.lineTo(c.x + 1, c.y - 14);
      g.closePath();
      g.fill();

      g.strokeStyle = '#7d6f58';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(c.x + 1, c.y - 14);
      g.lineTo(c.x + 2, c.y - 30);
      g.stroke();
      return;
    }

    if (tile === TILE.CRYSTAL) {
      /* Кристалл светится сам: его нельзя перепутать с камнем, потому что
         бить в него надо ровно противоположным. */
      const pulse = 0.55 + Math.sin(world.time * 3 + c.x) * 0.2;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,226,90,${0.16 * pulse})`;
      g.beginPath();
      g.ellipse(c.x, c.y - 6, 26, 16, 0, 0, 6.29);
      g.fill();
      g.restore();

      g.fillStyle = '#6a5a1e';
      g.beginPath();
      g.moveTo(c.x - 11, c.y);
      g.lineTo(c.x, c.y - 34);
      g.lineTo(c.x + 3, c.y - 6);
      g.closePath();
      g.fill();

      g.fillStyle = `rgba(255,240,150,${0.55 + pulse * 0.35})`;
      g.beginPath();
      g.moveTo(c.x + 11, c.y);
      g.lineTo(c.x, c.y - 34);
      g.lineTo(c.x + 3, c.y - 6);
      g.closePath();
      g.fill();

      g.strokeStyle = '#fff6c0';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(c.x, c.y - 34);
      g.lineTo(c.x + 3, c.y - 6);
      g.stroke();
      return;
    }

    if (tile === TILE.DOOR) {
      /* Створка светом, а не массой: проход должен читаться как проход. */
      g.strokeStyle = theme.gate;
      g.globalAlpha = 0.75;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(c.x - HALF_W, c.y);
      g.lineTo(c.x - HALF_W, c.y - GATE_H);
      g.moveTo(c.x + HALF_W, c.y);
      g.lineTo(c.x + HALF_W, c.y - GATE_H);
      g.stroke();

      g.globalAlpha = 0.16;
      g.fillStyle = theme.gate;
      g.beginPath();
      g.moveTo(c.x - HALF_W, c.y);
      g.lineTo(c.x + HALF_W, c.y);
      g.lineTo(c.x + HALF_W, c.y - GATE_H);
      g.lineTo(c.x - HALF_W, c.y - GATE_H);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
  }

  function drawExitPad(g, world, theme, tx, ty) {
    const c = cellCentre(tx, ty);
    const pulse = 0.45 + Math.sin(world.time * 3 + tx) * 0.2;

    g.fillStyle = theme.exit;
    g.globalAlpha = world.exitOpen ? pulse : 0.12;
    diamond(g, c.x, c.y);
    g.fill();
    g.globalAlpha = 1;

    g.strokeStyle = theme.exit;
    g.globalAlpha = world.exitOpen ? 0.9 : 0.3;
    g.lineWidth = 1.5;
    diamond(g, c.x, c.y);
    g.stroke();
    g.globalAlpha = 1;
  }


  /* =======================================================
     ПОЛЕ
     =======================================================
     То, что вещество оставило на полу. Рисуется ромбами по
     той же сетке, по которой считается: по краю клетки
     проходит разница между «цепь достала» и «не достала»,
     и мягкое пятно об этом соврало бы.
     ======================================================= */

  function drawGround(g, world) {
    if (!world.ground) return;

    for (let i = 0; i < world.ground.length; i += 1) {
      const kind = world.ground[i];
      if (!kind) continue;

      const tx = i % world.w;
      const ty = (i / world.w) | 0;
      const c = cellCentre(tx, ty);
      const fade = Math.min(1, world.groundLife[i] / 2);

      if (kind === GROUND.FIRE) {
        /*
         * Огонь рисуется на сложение: свет складывается с любым полом и
         * остаётся огнём на всех темах. С прозрачностью он на тёмной
         * земле давал тот же бурый, что и грязь, — а одно убивает, другое
         * нет.
         */
        const caught = Math.min(1, world.groundAge[i] / FIRE_CATCH);
        const flicker = 0.75 + Math.random() * 0.25;

        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,${60 + Math.round(caught * 40)},10,${(0.32 + caught * 0.4) * fade * flicker})`;
        diamond(g, c.x, c.y);
        g.fill();

        /* Языки пламени — три треугольника вверх. Разгоревшийся пол
           обязан отличаться от тлеющего не только яркостью. */
        /* Два языка пламени со случайной высотой и сдвигом: ровный ряд
           одинаковых зубцов читался как узор на плитке, а не как огонь. */
        if (caught >= 1) {
          g.fillStyle = `rgba(255,200,70,${0.34 * flicker * fade})`;
          for (let k = 0; k < 2; k += 1) {
            const fx = c.x + (Math.random() - 0.5) * HALF_W * 0.9;
            const fy = c.y + (Math.random() - 0.5) * HALF_H * 0.7;
            const tall = 10 + Math.random() * 14;
            const wide = 3 + Math.random() * 3;
            g.beginPath();
            g.moveTo(fx - wide, fy);
            g.quadraticCurveTo(fx - 1, fy - tall * 0.55, fx, fy - tall);
            g.quadraticCurveTo(fx + 1, fy - tall * 0.55, fx + wide, fy);
            g.closePath();
            g.fill();
          }
        }
        g.restore();
        continue;
      }

      if (kind === GROUND.WATER) {
        g.fillStyle = `rgba(22,86,150,${0.62 * fade})`;
        diamond(g, c.x, c.y);
        g.fill();
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(46,150,220,${0.26 * fade})`;
        diamond(g, c.x, c.y);
        g.fill();
        g.restore();
        /* Блик: без него лужа читается как дырка в полу. */
        g.strokeStyle = `rgba(160,235,255,${0.35 * fade})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(c.x - HALF_W * 0.45, c.y);
        g.lineTo(c.x, c.y - HALF_H * 0.4);
        g.stroke();
        continue;
      }

      if (kind === GROUND.ICE) {
        g.fillStyle = `rgba(140,215,245,${0.45 * fade})`;
        diamond(g, c.x, c.y);
        g.fill();
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(190,240,255,${0.22 * fade})`;
        diamond(g, c.x, c.y);
        g.fill();
        g.restore();
        /* Трещины: без них лёд читается как дырка в полу. */
        g.strokeStyle = `rgba(255,255,255,${0.45 * fade})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(c.x - HALF_W * 0.55, c.y + HALF_H * 0.15);
        g.lineTo(c.x - HALF_W * 0.05, c.y - HALF_H * 0.25);
        g.lineTo(c.x + HALF_W * 0.45, c.y + HALF_H * 0.1);
        g.stroke();
        continue;
      }

      if (kind === GROUND.MUD) {
        g.fillStyle = `rgba(48,40,22,${0.8 * fade})`;
        diamond(g, c.x, c.y);
        g.fill();
      }
    }
  }

  function drawDecals(g, world) {
    g.fillStyle = '#8d0526';
    for (const decal of world.decals) {
      const p = project(decal.x, decal.y);
      g.globalAlpha = decal.a * 0.8;
      g.beginPath();
      g.ellipse(p.x + originX, p.y, decal.r * 1.1, decal.r * 0.55, 0, 0, 6.29);
      g.fill();
    }
    g.globalAlpha = 1;
  }


  /* =======================================================
     МАГ
     =======================================================
     Фигура собирается из плаща, капюшона и посоха. Ног нет
     намеренно: в изометрии на таком размере они читаются как
     дрожь, а не как шаг. Ход показывает качание плаща и
     подъём посоха — этого хватает, и это дёшево.
     ======================================================= */

  /* Направление взгляда в экранных координатах. */
  function facing(angle) {
    const p = project(Math.cos(angle), Math.sin(angle));
    const len = Math.hypot(p.x, p.y) || 1;
    return { x: p.x / len, y: p.y / len };
  }

  function shadow(g, x, y, scale = 1) {
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath();
    g.ellipse(x, y, 13 * scale, 6 * scale, 0, 0, 6.29);
    g.fill();
  }

  function mage(g, o) {
    const { x, y } = o;
    const palette = o.palette;
    const dir = facing(o.angle);

    /* Качание на ходу и приседание при наборе: заряженный маг виден по
       позе раньше, чем по огонькам над головой. */
    const bob = Math.sin(o.phase) * 1.6;
    const crouch = o.charging ? 3 : 0;
    const lift = -bob - 0 + crouch;

    shadow(g, x, y, o.downed ? 1.15 : 1);

    if (o.downed) {
      /* Лежачий — тот же плащ, но плашмя и без капюшона вверх. */
      g.save();
      g.translate(x, y);
      g.scale(1, 0.45);
      g.fillStyle = palette.robe;
      g.beginPath();
      g.ellipse(0, -6, 15, 13, 0, 0, 6.29);
      g.fill();
      g.restore();
      return;
    }

    const base = y + lift;
    const H = 36;

    /*
     * Плащ: трапеция с подолом, чуть смещённая в сторону взгляда. Подол
     * шире плеч вдвое — на таком размере именно этот контраст и делает
     * силуэт «магом», а не «фигуркой».
     */
    const sway = dir.x * 2.6;
    g.beginPath();
    g.moveTo(x - 13, base);
    g.quadraticCurveTo(x - 11 + sway, base - H * 0.5, x - 7 + sway, base - H * 0.82);
    g.lineTo(x + 7 + sway, base - H * 0.82);
    g.quadraticCurveTo(x + 11 + sway, base - H * 0.5, x + 13, base);
    g.quadraticCurveTo(x, base + 4, x - 13, base);
    g.closePath();

    const grad = g.createLinearGradient(x - 13, base - H, x + 13, base);
    grad.addColorStop(0, palette.robeLit);
    grad.addColorStop(0.55, palette.robe);
    grad.addColorStop(1, palette.hood);
    g.fillStyle = grad;
    g.fill();

    /* Плечи: короткая светящаяся дуга. Она отделяет голову от подола и
       даёт ту самую «схему на ткани», ради которой маг здесь техно. */
    g.strokeStyle = o.glow || palette.trim;
    g.globalAlpha = 0.5;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - 7.5 + sway, base - H * 0.78);
    g.quadraticCurveTo(x + sway, base - H * 0.86, x + 7.5 + sway, base - H * 0.78);
    g.stroke();
    g.globalAlpha = 1;

    /* Светящаяся кромка по подолу — та самая «техно» половина техно-мага. */
    g.strokeStyle = o.glow || palette.trim;
    g.globalAlpha = 0.75;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - 10.5, base - 1);
    g.quadraticCurveTo(x, base + 2, x + 10.5, base - 1);
    g.stroke();
    g.globalAlpha = 1;

    /* Капюшон. Лицо — тёмный провал: так фигура читается как маг, а не
       как человек в халате, и не требует ни одного пикселя мимики. */
    const headY = base - H * 0.9;
    g.fillStyle = palette.robeLit;
    g.beginPath();
    g.moveTo(x - 9 + sway, headY + 7);
    g.quadraticCurveTo(x + sway, headY - 13, x + 9 + sway, headY + 7);
    g.closePath();
    g.fill();

    g.fillStyle = palette.hood;
    g.beginPath();
    g.ellipse(x + sway + dir.x * 2.5, headY + 2, 5.2, 4.6, 0, 0, 6.29);
    g.fill();

    /* Два огонька вместо глаз — единственное, что светится в лице. */
    g.fillStyle = o.glow || palette.trim;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.ellipse(x + sway + dir.x * 3.4 - 1.8, headY + 1.4, 1.1, 1.1, 0, 0, 6.29);
    g.ellipse(x + sway + dir.x * 3.4 + 1.8, headY + 1.4, 1.1, 1.1, 0, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;

    /* Посох. Он же показывает и замах, и выпуск: рука уходит вперёд. */
    const reach = 15 + (o.swing || 0) * 34;
    const handX = x + sway + dir.x * 7;
    const handY = base - H * 0.5 + dir.y * 3;
    const tipX = handX + dir.x * reach;
    const tipY = handY + dir.y * reach - 8 - (o.cast || 0) * 6;

    /* Посох рисуется дважды: тёмное древко и светлая грань поверх —
       иначе на тёмной земле он теряется и маг остаётся без рук. */
    g.strokeStyle = '#0d0b12';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(handX - dir.x * 6, handY - dir.y * 6 + 8);
    g.lineTo(tipX, tipY);
    g.stroke();

    g.strokeStyle = '#6b6274';
    g.lineWidth = 1.4;
    g.stroke();

    const tip = o.glow || palette.trim;
    const heat = 0.5 + (o.charging ? 0.5 : 0) + (o.cast || 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = tip;
    g.globalAlpha = Math.min(1, 0.45 * heat);
    g.beginPath();
    g.ellipse(tipX, tipY, 4.5 + heat * 2.5, 4.5 + heat * 2.5, 0, 0, 6.29);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(tipX, tipY, 1.6 + heat, 1.6 + heat, 0, 0, 6.29);
    g.fill();
    g.restore();
  }

  /* Метки состояния. Решение по ним принимают за долю секунды, поэтому
     они крупные и однотонные: мокрый — бей молнией, горящий — уже труп. */
  function stateMark(g, x, y, body_) {
    if (body_.burning > 0) {
      const flicker = 0.6 + Math.random() * 0.4;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,120,40,${0.4 * flicker})`;
      g.beginPath();
      g.ellipse(x, y - 14, 12 + Math.random() * 3, 18 + Math.random() * 4, 0, 0, 6.29);
      g.fill();
      g.restore();
      return;
    }

    if (body_.wet > 0) {
      g.strokeStyle = `rgba(120,220,255,${0.3 + Math.min(1, body_.wet / 3) * 0.45})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(x, y, 12, 6, 0, 0, 6.29);
      g.stroke();
    }
  }


  /* =======================================================
     ТЕЛА
     ======================================================= */

  function drawEnemy(g, world, enemy) {
    const p = project(enemy.x, enemy.y);
    const x = p.x + originX;
    const y = p.y;

    stateMark(g, x, y, enemy);

    /*
     * Стихию врага видно всегда: она же его и защищает, поэтому кольцо на
     * земле — прямая инструкция «этим цветом не бей».
     */
    if (enemy.resist) {
      const colour = colourOf(enemy.resist);
      const pulse = 0.45 + Math.sin(world.time * 6 + enemy.home.x) * 0.2;
      g.strokeStyle = colour;
      g.globalAlpha = enemy.blocked > 0 ? 1 : pulse;
      g.lineWidth = enemy.blocked > 0 ? 3 : 1.6;
      g.beginPath();
      g.ellipse(x, y, HALF_W * 0.55, HALF_H * 0.55, 0, 0, 6.29);
      g.stroke();
      g.globalAlpha = 1;
    }

    const palette = ROBES[enemy.kind] || ROBES.thug;
    mage(g, {
      x, y,
      angle: enemy.angle,
      palette,
      phase: enemy.step * 0.35,
      swing: enemy.swing || 0,
      cast: enemy.windup ? Math.min(1, enemy.windup * 3) : 0,
      charging: enemy.windup > 0,
      downed: enemy.downed > 0,
      glow: enemy.resist ? colourOf(enemy.resist) : (enemy.element ? colourOf(enemy.element) : null),
    });

    if (enemy.hitFlash > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,255,255,${enemy.hitFlash * 3})`;
      g.beginPath();
      g.ellipse(x, y - 16, 13, 20, 0, 0, 6.29);
      g.fill();
      g.restore();
    }
  }

  function drawPlayerAt(g, world, x, y) {
    const player = world.player;

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
    g.globalAlpha = 0.55 + Math.sin(world.time * 5) * 0.12;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x, y, HALF_W * 0.5, HALF_H * 0.5, 0, 0, 6.29);
    g.stroke();
    g.restore();

    stateMark(g, x, y, player);

    const charging = player.chargeLeft > 0 ? colourOf(player.charging) : null;

    mage(g, {
      x, y,
      angle: player.angle,
      palette: ROBES.player,
      phase: player.step * 0.35,
      swing: 0,
      cast: player.windup > 0 ? 1 : (player.cooldown > 0 ? player.cooldown * 3 : 0),
      charging: player.chargeLeft > 0,
      glow: charging || held || ROBES.player.trim,
    });

    /*
     * Очередь висит над головой, а не только в углу экрана: заряженный маг
     * должен быть виден как угроза — и себе, и в записи чужого боя.
     */
    const top = y - 44;
    for (let i = 0; i < player.stack.length; i += 1) {
      const colour = colourOf(player.stack[i]);
      const ox = x + (i - (player.stack.length - 1) / 2) * 9;
      const float = Math.sin(world.time * 4 + i) * 1.5;

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = colour;
      g.globalAlpha = 0.75;
      g.beginPath();
      g.ellipse(ox, top + float, 5, 5, 0, 0, 6.29);
      g.fill();
      g.restore();

      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(ox, top + float, 1.8, 1.8, 0, 0, 6.29);
      g.fill();
    }

    if (player.chargeLeft > 0) {
      const fill = 1 - player.chargeLeft / CHARGE_STEP;
      const ox = x + (player.stack.length - (player.stack.length) / 2) * 9 + 4;
      g.strokeStyle = colourOf(player.charging);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ox, top, 5, -Math.PI / 2, -Math.PI / 2 + fill * 6.28);
      g.stroke();
    }
  }

  function drawCorpse(g, corpse) {
    const p = project(corpse.x, corpse.y);
    const jitter = corpse.twitch > 0 ? (Math.random() - 0.5) * corpse.twitch * 2 : 0;
    mage(g, {
      x: p.x + originX + jitter,
      y: p.y,
      angle: corpse.angle,
      palette: ROBES.dead,
      phase: 0,
      downed: true,
    });
  }


  /* =======================================================
     ЛЕТУЧЕЕ
     ======================================================= */

  function drawBullets(g, world) {
    for (const bullet of world.bullets) {
      const p = project(bullet.x, bullet.y);
      const x = p.x + originX;
      const y = p.y - 14;                       /* снаряд летит на уровне груди */
      const colour = bullet.colour || '#ffe06b';

      /* Тень под снарядом — то, что и делает картинку объёмной. */
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath();
      g.ellipse(x, p.y, 5, 2.5, 0, 0, 6.29);
      g.fill();

      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = colour;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.ellipse(x, y, bullet.nova ? 11 : 6, bullet.nova ? 11 : 6, 0, 0, 6.29);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(x, y, bullet.nova ? 4 : 2.2, bullet.nova ? 4 : 2.2, 0, 0, 6.29);
      g.fill();
      g.restore();
    }
  }

  function drawBlasts(g, world) {
    for (const blast of world.blasts) {
      const t = 1 - blast.life / blast.span;
      const fade = 1 - t;
      const p = project(blast.x, blast.y);
      const x = p.x + originX;
      const y = p.y - 12;

      if (blast.kind === 'cone') {
        /* Конус в изометрии — сплюснутый сектор: он лежит на земле. */
        g.save();
        g.translate(x, p.y);
        g.scale(1, 0.5);
        const dir = Math.atan2(project(Math.cos(blast.angle), Math.sin(blast.angle)).y * 2,
          project(Math.cos(blast.angle), Math.sin(blast.angle)).x);
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, blast.reach * (0.6 + t * 0.4) * 1.15,
          dir - blast.arc / 2, dir + blast.arc / 2);
        g.closePath();
        g.fillStyle = hexToRgba(blast.colour, fade * 0.42);
        g.fill();
        g.restore();
        continue;
      }

      if (blast.kind === 'beam') {
        const a = project(blast.x, blast.y);
        const b = project(blast.x2, blast.y2);
        g.strokeStyle = hexToRgba(blast.colour, fade);
        g.lineWidth = 9 * fade + 2;
        g.beginPath();
        g.moveTo(a.x + originX, a.y - 14);
        g.lineTo(b.x + originX, b.y - 14);
        g.stroke();
        g.strokeStyle = `rgba(255,255,255,${fade})`;
        g.lineWidth = 3 * fade + 1;
        g.stroke();
        continue;
      }

      if (blast.kind === 'nova') {
        const r = blast.radius * (0.3 + t * 0.8);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = hexToRgba(blast.tint || '#ffffff', fade);
        g.lineWidth = 6 * fade + 1;
        g.beginPath();
        g.ellipse(x, y, r, r * 0.5, 0, 0, 6.29);
        g.stroke();
        g.fillStyle = `rgba(255,255,255,${fade * 0.14})`;
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
      const p = project(ring.x, ring.y);
      g.strokeStyle = `rgba(${ring.colour},${(1 - t) * 0.9})`;
      g.lineWidth = 3 * (1 - t) + 1;
      const r = ring.r + (ring.max - ring.r) * t;
      g.beginPath();
      g.ellipse(p.x + originX, p.y - 12, r, r * 0.5, 0, 0, 6.29);
      g.stroke();
    }
  }

  function drawParticles(g, world) {
    for (const particle of world.particles) {
      const p = project(particle.x, particle.y);
      g.globalAlpha = Math.max(0, particle.life / particle.max);
      g.fillStyle = particle.color;
      g.fillRect(p.x + originX - particle.size / 2, p.y - 10 - particle.size / 2,
        particle.size, particle.size * 0.8);
    }
    g.globalAlpha = 1;
  }

  function drawClouds(g, world) {
    if (!world.clouds) return;

    for (const cloud of world.clouds) {
      const p = project(cloud.x, cloud.y);
      const fade = Math.min(1, cloud.life / cloud.span);
      const r = cloud.r * (1 + (1 - fade) * 0.5);
      const core = cloud.kind === 'dust' ? '190,168,120' : '214,232,244';

      const grad = g.createRadialGradient(p.x + originX, p.y - 16, r * 0.15,
        p.x + originX, p.y - 16, r);
      grad.addColorStop(0, `rgba(${core},${0.48 * fade})`);
      grad.addColorStop(0.6, `rgba(${core},${0.3 * fade})`);
      grad.addColorStop(1, `rgba(${core},0)`);
      g.fillStyle = grad;
      g.save();
      g.translate(p.x + originX, p.y - 16);
      g.scale(1, 0.62);
      g.beginPath();
      g.arc(0, 0, r, 0, 6.29);
      g.fill();
      g.restore();
    }
  }

  function drawLock(g, world) {
    if (!world.locked || !world.locked.alive) return;
    const p = project(world.locked.x, world.locked.y);
    const x = p.x + originX;
    const y = p.y;

    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.8;
    g.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + side * 15, y - 34);
      g.lineTo(x + side * 19, y - 34);
      g.lineTo(x + side * 19, y + 3);
      g.lineTo(x + side * 15, y + 3);
      g.stroke();
    }
    g.globalAlpha = 1;
  }


  /* =======================================================
     КАДР
     ======================================================= */

  function draw(world, view) {
    if (bakedFor !== world || world.rebake) { bake(world); world.rebake = false; }

    const theme = THEMES[world.level.theme] || THEMES[0];
    const zoom = zoomFor();

    const centre = project(view.x, view.y);
    const camX = centre.x + originX;
    const camY = centre.y;

    const punch = 1 + world.fx.punch * 0.03;
    const shake = world.fx.shake;
    const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake * 0.5 : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.sky;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom * punch, zoom * punch);
    ctx.translate(-camX + shakeX, -camY + shakeY);

    ctx.drawImage(floorLayer, 0, 0);

    drawGround(ctx, world);
    drawDecals(ctx, world);

    /* Выходы поверх пола, но под всем высоким. */
    for (let i = 0; i < world.tiles.length; i += 1) {
      if (world.tiles[i] === TILE.EXIT) {
        drawExitPad(ctx, world, theme, i % world.w, (i / world.w) | 0);
      }
    }

    /*
     * Один проход по клеткам сверху вниз: сначала высокое на клетке, потом
     * те, кто на ней стоит. Это и есть весь порядок глубины — ни сортировок,
     * ни z-буфера не нужно, потому что клетку может загородить только та,
     * что ниже или правее.
     */
    const bucket = new Map();
    const put = (bx, by, item) => {
      const tx = Math.max(0, Math.min(world.w - 1, Math.floor(bx / TILE_SIZE)));
      const ty = Math.max(0, Math.min(world.h - 1, Math.floor(by / TILE_SIZE)));
      const key = ty * world.w + tx;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(item);
    };

    for (const corpse of world.corpses) put(corpse.x, corpse.y, { kind: 'corpse', corpse });
    for (const enemy of world.enemies) {
      if (enemy.alive) put(enemy.x, enemy.y, { kind: 'enemy', enemy });
    }
    if (world.player.alive) put(world.player.x, world.player.y, { kind: 'player' });

    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        const at = ty * world.w + tx;
        const tile = world.tiles[at];

        if (tile === TILE.WALL || tile === TILE.GLASS || tile === TILE.TABLE
          || tile === TILE.DOOR || tile === TILE.BARREL
          || tile === TILE.BOULDER || tile === TILE.CRYSTAL) {
          const hides = tile !== TILE.TABLE && veilsPlayer(world, tx, ty);
          if (hides) ctx.globalAlpha = 0.3;
          tallTile(ctx, world, theme, tx, ty, tile);
          if (hides) ctx.globalAlpha = 1;
        }

        const here = bucket.get(at);
        if (!here) continue;

        for (const item of here) {
          if (item.kind === 'corpse') drawCorpse(ctx, item.corpse);
          else if (item.kind === 'enemy') drawEnemy(ctx, world, item.enemy);
          else {
            const p = project(world.player.x, world.player.y);
            drawPlayerAt(ctx, world, p.x + originX, p.y);
          }
        }
      }
    }

    drawLock(ctx, world);
    drawBullets(ctx, world);
    drawBlasts(ctx, world);
    drawPops(ctx, world);
    drawParticles(ctx, world);
    drawClouds(ctx, world);

    ctx.restore();

    if (world.fx.flash > 0.01) {
      ctx.fillStyle = `rgba(120,255,214,${world.fx.flash * 0.22})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    vignette(ctx, theme);

    return { zoom, camX, camY };
  }

  function vignette(g, theme) {
    const grad = g.createRadialGradient(
      viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.36,
      viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, hexToRgba(theme.sky, 0.62));
    g.fillStyle = grad;
    g.fillRect(0, 0, viewW, viewH);
  }

  /*
   * Обратное преобразование для мыши. Без него прицел уезжает: курсор
   * показывает на ромб, а мир считает по квадрату.
   */
  function toWorld(screenX, screenY, last) {
    const sx = last.camX + (screenX - viewW / 2) / last.zoom - originX;
    const sy = last.camY + (screenY - viewH / 2) / last.zoom;
    return unproject(sx, sy);
  }

  return { resize, draw, invalidate, toWorld };
}
