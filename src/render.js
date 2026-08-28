/*
 * АВТООТВЕТЧИК — отрисовка.
 *
 * Вид сверху, всё нарисовано фигурами, а не спрайтами: ни одного
 * заимствованного пикселя, зато палитру и пропорции можно менять
 * одной строкой. Отсылка к жанру держится на трёх вещах — кислотный
 * контраст, жёсткие чёрные тени и кровь, которая остаётся до конца
 * забега.
 *
 * Пол и стены пекутся один раз в отдельный холст: перерисовывать
 * тысячу клеток каждый кадр телефон не обязан. Слой обновляется, только
 * когда уровень меняется — то есть когда пуля разбивает витрину.
 */

import { TILE } from './level.js';
import { TILE_SIZE, BODY, WEAPONS } from './world.js';

/*
 * Пол светлее стен, а не наоборот. Первый вариант палитры был собран
 * по-другому — светящиеся стены и почти чёрный пол, — и на скриншоте
 * читался как лабиринт из неоновых полос: глаз принимал стены за
 * проходы. Здесь стена — тёмная масса с одной подсвеченной кромкой.
 */
export const THEMES = [
  {
    name: 'бар',
    floor: '#2a1338',
    floorAlt: '#301741',
    grout: '#170a20',
    wall: '#0c0713',
    wallTop: '#1c0f2b',
    wallEdge: '#ff2d95',
    rug: '#7a1a45',
    table: '#3a2418',
    tableEdge: '#ff9b52',
    glass: '#7ad9ff',
    haze: '#ff2d95',
  },
];


export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });

  /*
   * Уровень печётся в два слоя. Пол ложится под всё, стены — поверх всего,
   * включая конусы зрения и частицы: иначе луч, упёршийся в стену, всё
   * равно красит её изнутри, и стена перестаёт читаться как преграда.
   */
  const baked = document.createElement('canvas');
  const bakedCtx = baked.getContext('2d');
  const walls = document.createElement('canvas');
  const wallsCtx = walls.getContext('2d');

  let dpr = 1;
  let viewW = 0;
  let viewH = 0;
  let bakedFor = null;

  /*
   * Сравнивать здесь надо со своим же состоянием, а не с размером элемента
   * в вёрстке: холст растянут на весь экран правилом inset: 0, и его CSS-размер
   * совпадает с окном всегда — даже когда буфер под рисование остался
   * дефолтным 300×150. На этом однажды и попались: игра шла, часы тикали,
   * а мир рисовался в углу экрана.
   */
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
   * игрок видит, — а от этого зависит, с какого расстояния стрелкам
   * разрешено открывать огонь. Иначе на телефоне убивают из-за края кадра.
   */
  function zoomFor() {
    const short = Math.min(viewW, viewH);
    return Math.max(1.05, Math.min(2, short / 520));
  }

  function bake(world) {
    const theme = THEMES[world.level.theme] || THEMES[0];
    const w = world.w * TILE_SIZE;
    const h = world.h * TILE_SIZE;

    if (baked.width !== w || baked.height !== h) {
      baked.width = w;
      baked.height = h;
      walls.width = w;
      walls.height = h;
    }

    bakedCtx.fillStyle = theme.grout;
    bakedCtx.fillRect(0, 0, w, h);
    wallsCtx.clearRect(0, 0, w, h);

    for (let y = 0; y < world.h; y += 1) {
      for (let x = 0; x < world.w; x += 1) {
        const tile = world.tiles[y * world.w + x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (tile === TILE.WALL) continue;

        bakedCtx.fillStyle = ((x + y) & 1) ? theme.floor : theme.floorAlt;
        bakedCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        if (tile === TILE.RUG) {
          bakedCtx.fillStyle = theme.rug;
          bakedCtx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          bakedCtx.fillStyle = 'rgba(255,255,255,.05)';
          bakedCtx.fillRect(px + 5, py + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        }

        if (tile === TILE.DOOR) {
          bakedCtx.fillStyle = '#241531';
          bakedCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          bakedCtx.strokeStyle = theme.wallEdge;
          bakedCtx.lineWidth = 2;
          bakedCtx.strokeRect(px + 3.5, py + 3.5, TILE_SIZE - 7, TILE_SIZE - 7);
          bakedCtx.fillStyle = theme.wallEdge;
          bakedCtx.fillRect(px + TILE_SIZE - 11, py + TILE_SIZE / 2 - 2, 4, 4);
        }
      }
    }

    /* Стены рисуются вторым проходом: их тень должна лечь поверх пола. */
    for (let y = 0; y < world.h; y += 1) {
      for (let x = 0; x < world.w; x += 1) {
        const tile = world.tiles[y * world.w + x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (tile === TILE.WALL) {
          const below = y + 1 < world.h ? world.tiles[(y + 1) * world.w + x] : TILE.WALL;
          wallsCtx.fillStyle = theme.wall;
          wallsCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          wallsCtx.fillStyle = theme.wallTop;
          wallsCtx.fillRect(px, py, TILE_SIZE, 7);

          if (below !== TILE.WALL) {
            wallsCtx.fillStyle = theme.wallEdge;
            wallsCtx.fillRect(px, py + TILE_SIZE - 3, TILE_SIZE, 3);
            wallsCtx.fillStyle = 'rgba(0,0,0,.55)';
            wallsCtx.fillRect(px, py + TILE_SIZE, TILE_SIZE, 9);
          }
        }

        if (tile === TILE.TABLE) {
          bakedCtx.fillStyle = 'rgba(0,0,0,.5)';
          bakedCtx.fillRect(px + 4, py + 6, TILE_SIZE - 4, TILE_SIZE - 4);
          bakedCtx.fillStyle = theme.table;
          bakedCtx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          bakedCtx.strokeStyle = theme.tableEdge;
          bakedCtx.lineWidth = 2;
          bakedCtx.strokeRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        }

        if (tile === TILE.GLASS) {
          bakedCtx.fillStyle = 'rgba(122,217,255,.16)';
          bakedCtx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          bakedCtx.strokeStyle = theme.glass;
          bakedCtx.lineWidth = 2;
          bakedCtx.beginPath();
          bakedCtx.moveTo(px + 2, py + 2);
          bakedCtx.lineTo(px + TILE_SIZE - 2, py + TILE_SIZE - 2);
          bakedCtx.moveTo(px + TILE_SIZE - 2, py + 2);
          bakedCtx.lineTo(px + 2, py + TILE_SIZE - 2);
          bakedCtx.stroke();
        }
      }
    }

    bakedFor = world;
  }

  function invalidate() { bakedFor = null; }


  /* =======================================================
     ФИГУРЫ
     ======================================================= */

  function body(g, x, y, angle, palette, opts = {}) {
    const lean = opts.lean || 0;

    g.save();
    g.translate(x, y);

    /* Жёсткая тень со смещением — весь объём этой игры держится на ней. */
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.beginPath();
    g.ellipse(2.5, 3.5, BODY + 1, BODY + 1, 0, 0, 6.29);
    g.fill();

    g.rotate(angle);

    if (opts.weapon) drawWeapon(g, opts.weapon, opts.swing || 0, opts.windup || 0);

    g.fillStyle = palette.body;
    g.beginPath();
    g.ellipse(lean, 0, BODY + 1, BODY, 0, 0, 6.29);
    g.fill();

    /* Плечи: по ним читается направление даже на мелком экране. */
    g.fillStyle = palette.shirt;
    g.fillRect(-3, -BODY + 1, 7, BODY * 2 - 2);

    g.fillStyle = palette.head;
    g.beginPath();
    g.ellipse(3, 0, 5.4, 5.4, 0, 0, 6.29);
    g.fill();

    g.fillStyle = palette.mask;
    g.beginPath();
    g.ellipse(5.4, 0, 3.1, 4.2, 0, 0, 6.29);
    g.fill();

    g.restore();
  }

  function drawWeapon(g, weapon, swing, windup) {
    const push = swing > 0 ? 8 - swing * 30 : 0;
    const raise = windup > 0 ? -windup * 12 : 0;

    if (weapon === 'bat') {
      g.save();
      g.rotate(-0.5 + push * 0.09 + raise * 0.06);
      g.fillStyle = '#c9a06a';
      g.fillRect(4, -2, 22, 4);
      g.fillStyle = '#f0d6a8';
      g.fillRect(20, -3.5, 8, 7);
      g.restore();
      return;
    }

    if (weapon === 'pistol') {
      g.fillStyle = '#dfe6ff';
      g.fillRect(6, -1.5, 13, 3.5);
      g.fillStyle = '#7b7f99';
      g.fillRect(8, 1, 4, 4);
      return;
    }

    g.fillStyle = '#f6e6ff';
    g.fillRect(7 + push * 0.4, -6, 5, 4);
    g.fillRect(7 + push * 0.4, 2, 5, 4);
  }

  const PALETTE = {
    player: { body: '#ffcf4d', shirt: '#ff5ea8', head: '#ffe4b3', mask: '#76ff9f' },
    thug: { body: '#4de1ff', shirt: '#123a52', head: '#cfeaff', mask: '#0d2233' },
    shooter: { body: '#ff6b3d', shirt: '#4a1509', head: '#ffd9c4', mask: '#20060a' },
    dead: { body: '#5a4a63', shirt: '#332a3d', head: '#6d5c76', mask: '#241d2b' },
  };


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

    const shake = world.fx.shake;
    const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX + shakeX, -camY + shakeY);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(baked, 0, 0);

    drawExit(ctx, world);
    drawDecals(ctx, world);
    drawCorpses(ctx, world);
    drawCasings(ctx, world);
    drawPickups(ctx, world);
    drawVision(ctx, world);
    drawNoises(ctx, world);
    drawEnemies(ctx, world);
    drawPlayer(ctx, world);
    drawBullets(ctx, world);
    drawParticles(ctx, world);
    ctx.drawImage(walls, 0, 0);

    ctx.restore();

    /* Вспышка на убийстве — короткая засветка вместо честного бликового прохода. */
    if (world.fx.flash > 0.01) {
      ctx.fillStyle = `rgba(255,45,149,${world.fx.flash * 0.28})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    vignette(ctx, theme);

    return { zoom, camX, camY };
  }

  function drawExit(g, world) {
    for (let y = 0; y < world.h; y += 1) {
      for (let x = 0; x < world.w; x += 1) {
        if (world.tiles[y * world.w + x] !== TILE.EXIT) continue;
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (!world.exitOpen) {
          g.fillStyle = 'rgba(120,110,140,.18)';
          g.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
          continue;
        }

        const pulse = 0.45 + Math.sin(world.time * 7) * 0.25;
        g.fillStyle = `rgba(118,255,159,${pulse})`;
        g.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.strokeStyle = '#76ff9f';
        g.lineWidth = 2;
        g.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
    }
  }

  function drawDecals(g, world) {
    g.fillStyle = '#b3062f';
    for (const decal of world.decals) {
      g.globalAlpha = decal.a;
      g.beginPath();
      g.ellipse(decal.x, decal.y, decal.r, decal.r * 0.82, 0, 0, 6.29);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawCorpses(g, world) {
    for (const corpse of world.corpses) {
      const jitter = corpse.twitch > 0 ? (Math.random() - 0.5) * corpse.twitch * 2 : 0;
      body(g, corpse.x + jitter, corpse.y, corpse.angle, PALETTE.dead, { lean: 3 });
    }
  }

  function drawCasings(g, world) {
    g.fillStyle = '#ffd980';
    for (const casing of world.casings) {
      g.save();
      g.translate(casing.x, casing.y);
      g.rotate(casing.angle);
      g.globalAlpha = Math.min(1, casing.life * 2);
      g.fillRect(-2, -1, 4, 2);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  function drawPickups(g, world) {
    for (const pickup of world.pickups) {
      g.save();
      g.translate(pickup.x, pickup.y);

      if (!pickup.flying) {
        const glow = 0.25 + Math.sin(world.time * 4 + pickup.x) * 0.12;
        g.fillStyle = `rgba(118,255,159,${glow})`;
        g.beginPath();
        g.ellipse(0, 0, 13, 13, 0, 0, 6.29);
        g.fill();
      }

      g.rotate(pickup.angle);
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillRect(-9, -1, 22, 5);
      g.translate(-10, 0);
      drawWeapon(g, pickup.weapon, 0, 0);
      g.restore();
    }
  }

  /*
   * Конус зрения нарисован намеренно: на телефоне без него не прочитать,
   * кто куда смотрит, и стелс превращается в лотерею.
   */
  function drawVision(g, world) {
    for (const enemy of world.enemies) {
      if (!enemy.alive || enemy.downed > 0) continue;

      const colour = enemy.state === 'chase' ? '255,45,90'
        : enemy.state === 'alert' ? '255,224,107'
          : '122,217,255';

      const range = enemy.state === 'chase' ? 150 : 230;
      const steps = 12;
      const half = 0.95;

      g.beginPath();
      g.moveTo(enemy.x, enemy.y);
      for (let i = 0; i <= steps; i += 1) {
        const a = enemy.angle - half + (half * 2 * i) / steps;
        let hit = range;
        for (let d = 8; d < range; d += 10) {
          const px = enemy.x + Math.cos(a) * d;
          const py = enemy.y + Math.sin(a) * d;
          const tx = Math.floor(px / TILE_SIZE);
          const ty = Math.floor(py / TILE_SIZE);
          if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) { hit = d; break; }
          const tile = world.tiles[ty * world.w + tx];
          if (tile === TILE.WALL || tile === TILE.DOOR) { hit = d; break; }
        }
        g.lineTo(enemy.x + Math.cos(a) * hit, enemy.y + Math.sin(a) * hit);
      }
      g.closePath();
      g.fillStyle = `rgba(${colour},.13)`;
      g.fill();
      g.strokeStyle = `rgba(${colour},.3)`;
      g.lineWidth = 1;
      g.stroke();
    }
  }

  function drawNoises(g, world) {
    for (const noise of world.noises) {
      const t = 1 - noise.life / noise.max;
      g.strokeStyle = `rgba(255,224,107,${(1 - t) * 0.5})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(noise.x, noise.y, noise.radius * t * 0.9, 0, 6.29);
      g.stroke();
    }
  }

  function drawEnemies(g, world) {
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;

      const palette = PALETTE[enemy.kind] || PALETTE.thug;

      if (enemy.downed > 0) {
        g.save();
        g.globalAlpha = 0.85;
        body(g, enemy.x, enemy.y, enemy.angle + 1.4, palette, { lean: 4 });
        g.restore();
        g.fillStyle = '#ffe06b';
        g.font = 'bold 9px ui-monospace, monospace';
        g.fillText('!', enemy.x - 2, enemy.y - 15);
        continue;
      }

      body(g, enemy.x, enemy.y, enemy.angle, palette, {
        weapon: enemy.weapon,
        swing: enemy.swing || 0,
        windup: enemy.windup || 0,
      });

      /* Замах — единственное предупреждение, и оно должно быть заметным. */
      if (enemy.windup > 0.05) {
        g.strokeStyle = `rgba(255,45,90,${Math.min(0.9, enemy.windup * 2.4)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(enemy.x, enemy.y, BODY + 6, 0, 6.29);
        g.stroke();
      }

      if (enemy.flash > 0) {
        g.fillStyle = 'rgba(255,224,107,.9)';
        g.beginPath();
        g.arc(enemy.x + Math.cos(enemy.angle) * 18, enemy.y + Math.sin(enemy.angle) * 18, 5, 0, 6.29);
        g.fill();
      }
    }
  }

  function drawPlayer(g, world) {
    const player = world.player;
    if (!player.alive) return;

    body(g, player.x, player.y, player.angle, PALETTE.player, {
      weapon: player.weapon,
      swing: player.swing,
    });

    if (player.swing > 0 && WEAPONS[player.weapon].kind === 'melee') {
      const weapon = WEAPONS[player.weapon];
      g.strokeStyle = `rgba(255,255,255,${player.swing * 4})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(player.x, player.y, weapon.reach, player.angle - weapon.arc / 2, player.angle + weapon.arc / 2);
      g.stroke();
    }

    if (player.flash > 0) {
      g.fillStyle = 'rgba(255,240,180,.95)';
      g.beginPath();
      g.arc(player.x + Math.cos(player.angle) * 19, player.y + Math.sin(player.angle) * 19, 6, 0, 6.29);
      g.fill();
    }
  }

  function drawBullets(g, world) {
    for (const bullet of world.bullets) {
      const angle = Math.atan2(bullet.vy, bullet.vx);
      g.save();
      g.translate(bullet.x, bullet.y);
      g.rotate(angle);
      g.fillStyle = bullet.from === 'player' ? '#fff6c9' : '#ff8f6b';
      g.fillRect(-9, -1, 12, 2);
      g.globalAlpha = 0.35;
      g.fillRect(-22, -0.5, 16, 1);
      g.restore();
      g.globalAlpha = 1;
    }
  }

  function drawParticles(g, world) {
    for (const particle of world.particles) {
      g.globalAlpha = Math.max(0, particle.life / particle.max);
      g.fillStyle = particle.color;
      g.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    g.globalAlpha = 1;
  }

  function vignette(g, theme) {
    const grad = g.createRadialGradient(
      viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.32,
      viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.78,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,.72)');
    g.fillStyle = grad;
    g.fillRect(0, 0, viewW, viewH);
  }

  return { resize, draw, invalidate, zoomFor };
}
