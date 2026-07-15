/*
  game.js  —  entry point + engine (merged: main + game loop + input +
  camera + math + master state machine). This is the only <script> the
  HTML loads; it imports everything else.
*/

import { CONFIG, isTrapTile, isPoisonTile, isQuicksandTile, Progress, CHAR_LEGS } from './config.js';
import { FloatingText, drawBoomerang, Enemy } from './entities.js';
import { Player } from './player.js';
import { Spawner, Combat, Progression, Separation } from './systems.js';
import { Hud, Screens, LevelUp, Leaderboard, Menu, PauseMenu } from './ui.js';
import { Sfx, Music } from './audio.js';

// Math helpers (merged from math.js) ---------------------------------
export const Vec = {
  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
  lerp(a, b, t) { return a + (b - a) * t; },
  angle(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
  rand(min, max) { return min + Math.random() * (max - min); },
};

// Input (merged from input.js) — queryable state, not event-driven ----
const Input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
  // Active touch joystick: anchored where the finger lands, vector follows
  // the drag. Movement only — weapons already auto-aim at the nearest enemy.
  touch: null, // { id, ox, oy, x, y }
  init(canvas) {
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup',   (e) => this.keys.delete(e.code));
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    addEventListener('mousedown', () => { this.mouse.down = true; });
    addEventListener('mouseup',   () => { this.mouse.down = false; });

    // Touch listeners live on the canvas so DOM buttons keep normal taps.
    // preventDefault stops scroll/zoom gestures and synthetic mouse events.
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.touch) return; // first finger owns the stick
      const t = e.changedTouches[0];
      this.touch = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.touch && t.identifier === this.touch.id) {
          this.touch.x = t.clientX;
          this.touch.y = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.touch && t.identifier === this.touch.id) this.touch = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  },
  // Normalized joystick direction, {0,0} inside the deadzone, null when idle.
  joyVec() {
    if (!this.touch) return null;
    const dx = this.touch.x - this.touch.ox;
    const dy = this.touch.y - this.touch.oy;
    const len = Math.hypot(dx, dy);
    if (len < 12) return { x: 0, y: 0 }; // deadzone: resting finger = stand still
    return { x: dx / len, y: dy / len };
  },
};

// Camera (merged from camera.js) — world->screen, follows player ------
const Camera = {
  x: 0, y: 0, w: 0, h: 0,
  zoom: 1, // canvas px per CSS px: >1 on touch devices = wider world view
  follow(target) {
    // Center on target, then clamp so we never show outside the arena.
    this.x = Vec.clamp(target.x - this.w / 2, 0, Math.max(0, CONFIG.worldWidth - this.w));
    this.y = Vec.clamp(target.y - this.h / 2, 0, Math.max(0, CONFIG.worldHeight - this.h));
  },
  toScreen(wx, wy) { return { x: wx - this.x, y: wy - this.y }; },
};

// Arena: gothic stone floor, rune circles, ornate boundary ------------
const Arena = {
  TILE: 100, // big flagstones

  // Faint ceremonial circles baked into the floor (world coords).
  RUNES: [
    { x: 2560 / 2, y: 1440 / 2, r: 260 },
    { x: 560,  y: 380,  r: 170 },
    { x: 2010, y: 1080, r: 190 },
  ],

  // Spike-trap tile: dark pit with five spikes in a quincunx, matching
  // the trap tile on the bg.webp sheet. Standing here hurts (player.js).
  // Stage 2 recolors it as an earthen pit with sharpened wooden stakes.
  renderTrap(ctx, sx, sy, forest) {
    const T = this.TILE;
    ctx.fillStyle = forest ? '#0e1409' : '#16101f'; // pit floor
    ctx.fillRect(sx + 3, sy + 3, T - 6, T - 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // inner shadow rim
    ctx.fillRect(sx + 3, sy + 3, T - 6, 6);
    ctx.fillRect(sx + 3, sy + 3, 6, T - 6);
    for (const [ox, oy] of [[0.5, 0.5], [0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]]) {
      const cx = sx + ox * T, cy = sy + oy * T;
      ctx.fillStyle = forest ? '#070b04' : '#0b0812'; // socket hole
      ctx.beginPath();
      ctx.ellipse(cx, cy + 7, 8, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = forest ? '#8a6b45' : '#978ea6'; // spike / stake
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + 7);
      ctx.lineTo(cx, cy - 12);
      ctx.lineTo(cx + 6, cy + 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; // edge catch-light
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx + 2.5, cy + 2);
      ctx.lineTo(cx, cy + 4);
      ctx.closePath();
      ctx.fill();
    }
  },

  // Stage 3 quicksand: a sunken pit of wet sand with slow counter-swirls
  // pulling toward a dark throat. Wading through it slows you (player.js).
  renderQuicksand(ctx, sx, sy, h) {
    const T = this.TILE;
    ctx.fillStyle = '#5d4c2e'; // wet, sunken sand
    ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
    const cx = sx + T / 2, cy = sy + T / 2;
    const t = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(40, 30, 14, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const rr = T * (0.42 - i * 0.12);
      const a0 = t * (0.4 + i * 0.25) + (h % 7);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a0, a0 + Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#3a2d16'; // the throat
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  // Stage 2 poison pool: sunken sludge tile with seeded bubbles that
  // swell and pop on a slow cycle. Wading in it stings (player.js).
  renderPoison(ctx, sx, sy, h) {
    const T = this.TILE;
    ctx.fillStyle = '#101c08'; // sunken bank
    ctx.fillRect(sx + 2, sy + 2, T - 4, T - 4);
    ctx.fillStyle = '#2c4d14'; // sludge surface
    ctx.fillRect(sx + 8, sy + 8, T - 16, T - 16);
    ctx.fillStyle = '#3f6b1c'; // lit far rim
    ctx.fillRect(sx + 8, sy + 8, T - 16, 5);
    const t = performance.now() / 1000;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const bx = sx + 16 + ((h >> (i * 5)) % 67);
      const by = sy + 20 + ((h >> (i * 3 + 4)) % 59);
      const ph = (t * 0.8 + i * 0.33 + (h % 7) / 7) % 1; // bubble life 0->1
      ctx.strokeStyle = `rgba(140, 200, 90, ${0.5 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(bx, by, 2 + ph * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  // Blood rune, styled after "blood rune.webp": a hand-painted ring with
  // uneven brush passes, an inscribed hexagram, a spiral at the heart,
  // splatter droplets — encircled by flickering candles. All jitter is
  // seeded so each rune keeps its own fixed imperfections every frame.
  renderBloodRune(ctx, cx, cy, R, seed, t) {
    const rand = (n) => {
      const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const BLOOD = '#8c1414';
    const DARK = '#5f0c0c';
    ctx.save();
    ctx.lineCap = 'round';

    // Ring: three offset arc passes fake a brush of uneven thickness,
    // each stopping just short of a full turn so the stroke has ends.
    for (const [dx, dy, w, col, a] of [
      [0, 0, 9, BLOOD, 0.85],
      [3, 2, 4, DARK, 0.6],
      [-2, 3, 3, '#a52020', 0.5],
    ]) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      const start = rand(w) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, R - w / 2, start, start + 6.15);
      ctx.stroke();
    }

    // Hexagram: two hand-drawn triangles, corners nudged off-true.
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = BLOOD;
    ctx.lineWidth = 5;
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = off + (i % 3) * (Math.PI * 2 / 3) - Math.PI / 2
                + (rand(i + off * 7) - 0.5) * 0.07;
        const x = cx + Math.cos(a) * R * 0.92;
        const y = cy + Math.sin(a) * R * 0.92;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    // Spiral at the heart
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 4 + seed;
      const rr = R * 0.22 * (i / 40);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // Splatter droplets flung around the ring
    ctx.fillStyle = DARK;
    for (let i = 0; i < 14; i++) {
      const a = rand(i + 10) * Math.PI * 2;
      const rr = R * (0.88 + rand(i + 30) * 0.3);
      ctx.globalAlpha = 0.35 + rand(i + 50) * 0.4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr,
              1.5 + rand(i + 70) * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Candles around the seal: wax stub, melt blob, flickering flame.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand(i + 90) * 0.5;
      const x = cx + Math.cos(a) * (R + 18 + rand(i) * 14);
      const y = cy + Math.sin(a) * (R + 18 + rand(i) * 14);
      const hgt = 9 + rand(i + 5) * 6;
      const flick = 0.75 + Math.sin(t * (6 + rand(i) * 3) + i * 2.1) * 0.25;
      // warm light pool on the floor
      ctx.fillStyle = `rgba(255, 160, 60, ${0.04 + 0.05 * flick})`;
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 22, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      // wax body with a shaded side and melted base
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(x - 3, y - hgt, 6, hgt);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(x + 1, y - hgt, 2, hgt);
      ctx.fillStyle = '#e8dcc0';
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // flame
      ctx.save();
      ctx.shadowColor = 'rgba(255, 150, 40, 0.9)';
      ctx.shadowBlur = 8 + flick * 6;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.ellipse(x, y - hgt - 4, 2, 3.6 + flick * 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c8';
      ctx.beginPath();
      ctx.ellipse(x, y - hgt - 3.2, 1, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  // Stage 2 tree scatter, seeded once: kept clear of the spawn point,
  // the altar, the rune circles, and trap tiles so nothing playable is
  // ever hidden under a canopy. Positions are world coords.
  trees() {
    if (this._trees) return this._trees;
    const rand = (n) => {
      const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const out = [];
    const cx = CONFIG.worldWidth / 2, cy = CONFIG.worldHeight / 2;
    // Density scales with arena area: roughly one tree per 150k px².
    const N = Math.round(CONFIG.worldWidth * CONFIG.worldHeight / 150000);
    for (let i = 0; i < N * 6 && out.length < N; i++) {
      const x = 80 + rand(i * 2) * (CONFIG.worldWidth - 160);
      const y = 80 + rand(i * 2 + 1) * (CONFIG.worldHeight - 160);
      const r = 38 + rand(i * 3) * 24;
      if (Vec.dist(x, y, cx, cy) < 260) continue;                 // spawn
      if (Vec.dist(x, y, CONFIG.altar.x, CONFIG.altar.y) < 200) continue;
      const tix = Math.floor(x / this.TILE), tiy = Math.floor(y / this.TILE);
      if (isTrapTile(tix, tiy) || isPoisonTile(tix, tiy)) continue;
      if (out.some((t) => Vec.dist(x, y, t.x, t.y) < t.r + r + 20)) continue;
      out.push({ x, y, r, seed: i });
    }
    return (this._trees = out);
  },

  // Stage 2 ground decor, seeded like the trees: mossy boulders, still
  // puddles, and broken ruin walls — the forest-floor clutter from the
  // reference sheets. Kept clear of spawn, altar, traps, and canopies.
  decor() {
    if (this._decor) return this._decor;
    const rand = (n) => {
      const v = Math.sin(n * 217.3 + 96.1) * 43758.5453;
      return v - Math.floor(v);
    };
    const out = [];
    const cx = CONFIG.worldWidth / 2, cy = CONFIG.worldHeight / 2;
    const N = Math.round(CONFIG.worldWidth * CONFIG.worldHeight / 280000);
    for (let i = 0; i < N * 6 && out.length < N; i++) {
      const x = 100 + rand(i * 2) * (CONFIG.worldWidth - 200);
      const y = 100 + rand(i * 2 + 1) * (CONFIG.worldHeight - 200);
      if (Vec.dist(x, y, cx, cy) < 220) continue;
      if (Vec.dist(x, y, CONFIG.altar.x, CONFIG.altar.y) < 180) continue;
      const tix = Math.floor(x / this.TILE), tiy = Math.floor(y / this.TILE);
      if (isTrapTile(tix, tiy) || isPoisonTile(tix, tiy)) continue;
      if (this.trees().some((t) => Vec.dist(x, y, t.x, t.y) < t.r + 70)) continue;
      if (out.some((o) => Vec.dist(x, y, o.x, o.y) < 130)) continue;
      out.push({ x, y, kind: Math.floor(rand(i * 5 + 3) * 3), seed: i });
    }
    return (this._decor = out);
  },

  renderDecorItem(ctx, x, y, kind, seed, t) {
    const rand = (n) => {
      const v = Math.sin(seed * 53.7 + n * 31.9) * 43758.5453;
      return v - Math.floor(v);
    };
    if (kind === 0) {
      // Boulder cluster: 2-3 mossy grey stones with a lit crown.
      for (let i = 0; i < 2 + (seed % 2); i++) {
        const bx = x + (rand(i) - 0.5) * 46;
        const by = y + (rand(i + 3) - 0.5) * 30;
        const br = 12 + rand(i + 6) * 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath(); ctx.ellipse(bx + 4, by + 5, br, br * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = i % 2 ? '#49514a' : '#3f463f';
        ctx.beginPath(); ctx.ellipse(bx, by, br, br * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(180, 200, 160, 0.18)'; // moss catch-light
        ctx.beginPath(); ctx.ellipse(bx - br * 0.25, by - br * 0.3, br * 0.5, br * 0.3, -0.4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 1) {
      // Still puddle: dark water with a rim and a drifting moon-glint.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, 40, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#132b30';
      ctx.beginPath(); ctx.ellipse(x, y, 38, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120, 190, 170, 0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = `rgba(190, 230, 220, ${0.10 + Math.sin(t * 1.3 + seed) * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(x - 10 + Math.sin(t * 0.5 + seed) * 4, y - 4, 10, 3.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Ruin: a broken wall stub of mossy blocks, one block tumbled off.
      const blocks = 3 + (seed % 2);
      for (let i = 0; i < blocks; i++) {
        const bx = x + i * 24 - blocks * 12;
        const bh = 14 + rand(i) * 10; // uneven broken top line
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(bx + 3, y - bh + 4, 22, bh);
        ctx.fillStyle = i % 2 ? '#4d544c' : '#565e54';
        ctx.fillRect(bx, y - bh, 22, bh);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(bx, y - bh, 22, 3);
        ctx.fillStyle = 'rgba(120, 170, 110, 0.2)'; // creeping moss
        ctx.fillRect(bx, y - 5, 22, 5);
      }
      ctx.fillStyle = '#49514a'; // the tumbled block
      ctx.fillRect(x + blocks * 12 + 6, y - 8, 18, 12);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(x + blocks * 12 + 6, y - 8, 18, 3);
    }
  },

  // Top-down canopy like the reference sheets: hard shadow pooling
  // south-east, lobed dark crown, moonlit lobes on top.
  renderTree(ctx, x, y, r, seed) {
    const rand = (n) => {
      const v = Math.sin(seed * 91.7 + n * 47.3) * 43758.5453;
      return v - Math.floor(v);
    };
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, y + r * 0.4, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [rr, dx, dy, col] of [
      [1.0, 0, 0, '#13241a'],
      [0.72, -r * 0.12, -r * 0.14, '#1b3322'],
      [0.42, -r * 0.2, -r * 0.24, '#254430'],
    ]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rand(i) * 0.9;
        ctx.moveTo(x + dx, y + dy);
        ctx.arc(x + dx + Math.cos(a) * r * rr * 0.45,
                y + dy + Math.sin(a) * r * rr * 0.45,
                r * rr * 0.55, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  },

  render(ctx, camera, stage = 1) {
    const o = camera.toScreen(0, 0);
    const forest = stage === 2;
    const desert = stage === 3;

    // Base coat: dark mortar between flagstones, black loam under grass,
    // or packed earth under the dunes.
    ctx.fillStyle = desert ? '#332818' : forest ? '#0d160e' : '#241d2e';
    ctx.fillRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);

    // Beveled flagstones, styled after the bg.webp tileset: per-tile tone
    // from a hash, light catching the top/left edge, shadow pooling
    // bottom/right, pock marks on worn stones. Trap tiles render spikes.
    // Stage 2 swaps the pass for dark-forest grass (see forest bg.png /
    // forest2 bg.png): mottled moss tones, grass tufts, flower speckles.
    const T = this.TILE;
    const ix0 = Math.floor(camera.x / T), iy0 = Math.floor(camera.y / T);
    const ix1 = Math.ceil((camera.x + camera.w) / T);
    const iy1 = Math.ceil((camera.y + camera.h) / T);
    const STONES = ['#4d4360', '#484057', '#524866', '#453d52'];
    // Tones kept close so the tile grid melts into soft mottling.
    const GRASS = ['#182a1a', '#16281a', '#1a2c1d', '#152618'];
    const SAND = ['#8a7448', '#84704a', '#8f7a4c', '#7d6a42'];
    for (let ix = Math.max(0, ix0); ix <= ix1; ix++) {
      for (let iy = Math.max(0, iy0); iy <= iy1; iy++) {
        if (ix >= CONFIG.worldWidth / T || iy >= CONFIG.worldHeight / T) continue;
        const sx = ix * T - camera.x, sy = iy * T - camera.y;
        // The desert has no spike pits — quicksand is its floor hazard.
        if (!desert && isTrapTile(ix, iy)) { this.renderTrap(ctx, sx, sy, forest); continue; }
        const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
        if (forest && isPoisonTile(ix, iy)) { this.renderPoison(ctx, sx, sy, h); continue; }
        if (desert && isQuicksandTile(ix, iy)) { this.renderQuicksand(ctx, sx, sy, h); continue; }
        if (desert) {
          // Sun-baked sand (see "desert tileset.jpg"): mottled dune tones,
          // wind ripples, bleached pebbles on some tiles.
          ctx.fillStyle = SAND[h % SAND.length];
          ctx.fillRect(sx, sy, T, T);
          ctx.strokeStyle = 'rgba(255, 235, 180, 0.10)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const rx = sx + 8 + ((h >> (i * 4)) % 67);
            const ry = sy + 12 + ((h >> (i * 3 + 2)) % 73);
            ctx.moveTo(rx, ry);
            ctx.quadraticCurveTo(rx + 12, ry - 5, rx + 24, ry);
          }
          ctx.stroke();
          if (h % 11 === 0) {
            ctx.fillStyle = 'rgba(226, 214, 180, 0.5)';
            const px = sx + 18 + (h % 59), py = sy + 20 + (h % 51);
            ctx.fillRect(px, py, 4, 3);
            ctx.fillRect(px + 9, py + 6, 3, 3);
          }
          continue;
        }
        if (forest) {
          ctx.fillStyle = GRASS[h % GRASS.length];
          ctx.fillRect(sx, sy, T, T);
          // Grass tufts: paired blades, seeded per tile like the pocks.
          ctx.strokeStyle = 'rgba(70, 120, 70, 0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const tx = sx + 8 + ((h >> (i * 4)) % 79);
            const ty = sy + 14 + ((h >> (i * 3 + 2)) % 73);
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx + 2, ty - 8);
            ctx.moveTo(tx + 5, ty);
            ctx.lineTo(tx + 6, ty - 5);
          }
          ctx.stroke();
          // Sparse flower speckles, like the pink/yellow dots in the refs.
          if (h % 7 === 0) {
            ctx.fillStyle = h % 2 ? '#b06a8f' : '#a89b4e';
            const fx = sx + 20 + (h % 57), fy = sy + 24 + (h % 47);
            ctx.fillRect(fx, fy, 3, 3);
            ctx.fillRect(fx + 8, fy + 5, 2, 2);
            ctx.fillRect(fx + 3, fy + 10, 2, 2);
          }
          continue;
        }
        // Stone face
        ctx.fillStyle = STONES[h % STONES.length];
        ctx.fillRect(sx + 3, sy + 3, T - 6, T - 6);
        // Bevel: lit top/left, shaded bottom/right
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(sx + 3, sy + 3, T - 6, 5);
        ctx.fillRect(sx + 3, sy + 3, 5, T - 6);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
        ctx.fillRect(sx + 3, sy + T - 8, T - 6, 5);
        ctx.fillRect(sx + T - 8, sy + 3, 5, T - 6);
        // Wear: pock marks on some stones
        if (h % 5 === 0) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          const px = sx + 14 + (h % 61), py = sy + 12 + (h % 53);
          ctx.fillRect(px, py, 7, 5);
          ctx.fillRect(px + 12, py + 18, 5, 4);
        }
      }
    }

    const now = performance.now() / 1000;
    if (forest) {
      // Forest-floor clutter first, then canopies over it.
      for (const d of this.decor()) {
        const s = camera.toScreen(d.x, d.y);
        if (s.x < -100 || s.x > camera.w + 100 ||
            s.y < -100 || s.y > camera.h + 100) continue;
        this.renderDecorItem(ctx, s.x, s.y, d.kind, d.seed, now);
      }
      for (const t of this.trees()) {
        const s = camera.toScreen(t.x, t.y);
        if (s.x < -t.r * 2 || s.x > camera.w + t.r * 2 ||
            s.y < -t.r * 2 || s.y > camera.h + t.r * 2) continue;
        this.renderTree(ctx, s.x, s.y, t.r, t.seed);
      }
    } else if (!desert) {
      // Blood runes (see "blood rune.webp"), each ringed with candles —
      // the crypt's summoning circles. Forest and desert floors stay natural.
      this.RUNES.forEach((c, i) => {
        const s = camera.toScreen(c.x, c.y);
        if (s.x < -c.r - 60 || s.x > camera.w + c.r + 60 ||
            s.y < -c.r - 60 || s.y > camera.h + c.r + 60) return;
        this.renderBloodRune(ctx, s.x, s.y, c.r, i + 1, now);
      });
    }

    // Altar of the Crimson Relic: a raised dais with a rune ring and a
    // pedestal table — reads as a special spot from across the arena.
    const alt = camera.toScreen(CONFIG.altar.x, CONFIG.altar.y);
    if (alt.x > -160 && alt.x < camera.w + 160 &&
        alt.y > -160 && alt.y < camera.h + 160) {
      const pulse = 0.5 + Math.sin(performance.now() / 400) * 0.2;
      // Crimson glow bleeding onto the floor
      ctx.save();
      ctx.shadowColor = `rgba(255, 47, 78, ${pulse})`;
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#3b3049';
      ctx.beginPath();
      ctx.ellipse(alt.x, alt.y, 110, 46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Dais steps: two stacked stone slabs
      ctx.strokeStyle = 'rgba(255, 120, 140, 0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#484057';
      ctx.beginPath();
      ctx.ellipse(alt.x, alt.y - 6, 84, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.stroke();
      // Rune ring etched into the top step
      ctx.strokeStyle = `rgba(255, 47, 78, ${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.ellipse(alt.x, alt.y - 6, 64, 25, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Pedestal table: stone column with a slab top
      ctx.fillStyle = '#2a2338';
      ctx.fillRect(alt.x - 15, alt.y - 58, 30, 48);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // column side shading
      ctx.fillRect(alt.x + 5, alt.y - 58, 10, 48);
      ctx.fillStyle = '#4d4360';
      ctx.beginPath();
      ctx.ellipse(alt.x, alt.y - 58, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 120, 140, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Boundary: heavy dark wall with a thin inlay + corner sigils —
    // violet in the crypt, mossy green out in the dark forest.
    ctx.strokeStyle = forest ? '#0a130b' : '#231b30';
    ctx.lineWidth = 10;
    ctx.strokeRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);
    ctx.strokeStyle = forest ? 'rgba(92, 184, 116, 0.5)' : 'rgba(138, 43, 226, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x + 6, o.y + 6, CONFIG.worldWidth - 12, CONFIG.worldHeight - 12);
    ctx.fillStyle = forest ? 'rgba(92, 184, 116, 0.65)' : 'rgba(138, 43, 226, 0.7)';
    for (const [cx, cy] of [
      [0, 0], [CONFIG.worldWidth, 0],
      [0, CONFIG.worldHeight], [CONFIG.worldWidth, CONFIG.worldHeight],
    ]) {
      const s = camera.toScreen(cx, cy);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 12);
      ctx.lineTo(s.x + 12, s.y);
      ctx.lineTo(s.x, s.y + 12);
      ctx.lineTo(s.x - 12, s.y);
      ctx.closePath();
      ctx.fill();
    }
  },
};

// The Gate of Descent — styled after the bg.webp tiles: an arched wooden
// door with iron bands and a skull emblem set in a stone frame, and the
// stair tile behind it. Spawns where the dragon fell (systems.js); the
// leaves swing open as the player nears, revealing the stairway down.
// (x, y) is the ground point at the center of the threshold.
function drawGate(ctx, x, y, open, t) {
  const W = 96, H = 118, AR = W / 2; // doorway width / height / arch radius

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, W * 0.85, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Doorway silhouette: pillars up into a round arch. Interior, glow and
  // door leaves all clip to it so nothing bleeds past the stone frame.
  const doorway = new Path2D();
  doorway.moveTo(x - W / 2, y);
  doorway.lineTo(x - W / 2, y - (H - AR));
  doorway.arc(x, y - (H - AR), AR, Math.PI, 0);
  doorway.lineTo(x + W / 2, y);
  doorway.closePath();

  // Interior: darkness with the stair sinking away from the viewer —
  // steps shrink and fade as they descend (bg.webp stair tile).
  ctx.save();
  ctx.clip(doorway);
  ctx.fillStyle = '#0b0812';
  ctx.fillRect(x - W / 2, y - H, W, H);
  let sy = y;
  for (let i = 0; i < 6; i++) {
    const stepH = 13 - i * 1.3;
    const stepW = W - 8 - i * 10;
    ctx.fillStyle = `rgba(120, 106, 145, ${Math.max(0.06, 0.85 - i * 0.15)})`;
    ctx.fillRect(x - stepW / 2, sy - stepH, stepW, stepH - 2.5);
    sy -= stepH;
  }
  // Eerie light welling up the stairwell once the doors part.
  if (open > 0) {
    ctx.fillStyle = `rgba(150, 110, 255, ${open * (0.10 + 0.05 * Math.sin(t * 2.6))})`;
    ctx.fillRect(x - W / 2, y - H, W, H);
  }
  ctx.restore();

  // Door leaves: oak planks + iron bands, hinged at the jambs. Each leaf
  // swings away by shrinking toward its hinge as `open` runs 0 → 1.
  if (open < 1) {
    ctx.save();
    ctx.clip(doorway);
    for (const side of [-1, 1]) {
      const w = (W / 2) * (1 - open);
      const lx = side < 0 ? x - W / 2 : x + W / 2 - w;
      ctx.fillStyle = '#5f4130';
      ctx.fillRect(lx, y - H, w, H);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // plank seams
      for (let i = 1; i < 3; i++) ctx.fillRect(lx + (w * i) / 3 - 0.75, y - H, 1.5, H);
      ctx.fillStyle = '#39344b'; // iron bands
      ctx.fillRect(lx, y - H * 0.78, w, 6);
      ctx.fillRect(lx, y - H * 0.34, w, 6);
      // Leading-edge catch-light so the pair reads as two doors.
      ctx.fillStyle = 'rgba(255, 200, 140, 0.14)';
      ctx.fillRect(side < 0 ? lx + w - 2 : lx, y - H, 2, H);
    }
    ctx.restore();
  }

  // Stone frame over everything, with a faint bevel inlay.
  ctx.strokeStyle = '#4d4360';
  ctx.lineWidth = 12;
  ctx.stroke(doorway);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 3;
  ctx.stroke(doorway);
  ctx.fillStyle = '#3b3049'; // pillar feet
  ctx.fillRect(x - W / 2 - 14, y - 8, 22, 14);
  ctx.fillRect(x + W / 2 - 8, y - 8, 22, 14);

  // Keystone skull (the tile's door emblem, perched on the arch).
  const ky = y - H;
  ctx.fillStyle = '#cfc3b0';
  ctx.beginPath();
  ctx.arc(x, ky - 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 5, ky + 3, 10, 6);
  ctx.fillStyle = '#1a1424';
  ctx.beginPath();
  ctx.arc(x - 3.5, ky - 3, 2.6, 0, Math.PI * 2);
  ctx.arc(x + 3.5, ky - 3, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 1, ky + 1, 2, 3); // nasal notch

  // Light spilling onto the flagstones once open — beckons from afar.
  if (open > 0) {
    ctx.fillStyle = `rgba(150, 110, 255, ${0.09 * open})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 8, W * 0.7, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The Jungle Vault — the treasure room behind Stage 2's gate. One big
// chest in the middle holding the Dash powerup. World-coords room carved
// out of darkness around the arena center.
const VAULT = {
  x: CONFIG.worldWidth / 2 - 600,
  y: CONFIG.worldHeight / 2 - 420,
  w: 1200,
  h: 840,
};

// The big treasure chest. (x, y) is the ground under its front face;
// `open` runs 0 (shut) -> 1 (lid tipped back, gold light pouring out).
function drawChest(ctx, x, y, open, t) {
  const W = 116, H = 58, lh = 46; // body width/height, lid rise
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, W * 0.62, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Gold light welling out as the lid parts.
  if (open > 0) {
    const g = ctx.createRadialGradient(x, y - H, 6, x, y - H, 140);
    g.addColorStop(0, `rgba(255, 214, 110, ${0.5 * open})`);
    g.addColorStop(1, 'rgba(255, 200, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - H, 140, 0, Math.PI * 2); ctx.fill();
    // Shafts of light reaching up from the mouth
    ctx.save();
    ctx.globalAlpha = 0.3 * open;
    ctx.fillStyle = '#ffe9a0';
    for (const dx of [-28, 0, 28]) {
      const hgt = 74 + Math.sin(t * 3 + dx) * 7;
      ctx.beginPath();
      ctx.moveTo(x + dx - 6, y - H + 4);
      ctx.lineTo(x + dx - 14, y - H - hgt);
      ctx.lineTo(x + dx + 14, y - H - hgt);
      ctx.lineTo(x + dx + 6, y - H + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Body: iron-banded oak strongbox.
  ctx.fillStyle = '#5d3b21';
  ctx.fillRect(x - W / 2, y - H, W, H);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; // plank seams
  for (let i = 1; i < 4; i++) ctx.fillRect(x - W / 2, y - H + (H * i) / 4, W, 2);
  ctx.fillStyle = '#c9a23c'; // gold straps
  ctx.fillRect(x - W * 0.34 - 5, y - H, 10, H);
  ctx.fillRect(x + W * 0.34 - 5, y - H, 10, H);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - W / 2, y - H, W, H);

  // Open mouth: dark interior + smoldering gold, revealed under the lid.
  if (open > 0.15) {
    ctx.fillStyle = '#241605';
    ctx.fillRect(x - W / 2 + 4, y - H - 6, W - 8, 10);
    ctx.fillStyle = `rgba(255, 214, 110, ${0.8 * open})`;
    ctx.fillRect(x - W / 2 + 8, y - H - 4, W - 16, 5);
  }

  // Lid: arched, hinged at the back — tips away by squashing upward.
  ctx.save();
  ctx.translate(x, y - H);
  ctx.scale(1, Math.max(0.12, 1 - open * 0.88));
  const lid = new Path2D();
  lid.moveTo(-W / 2, 0);
  lid.quadraticCurveTo(-W * 0.48, -lh, 0, -lh);
  lid.quadraticCurveTo(W * 0.48, -lh, W / 2, 0);
  lid.closePath();
  ctx.fillStyle = '#6b4527';
  ctx.fill(lid);
  ctx.strokeStyle = '#c9a23c';
  ctx.lineWidth = 3;
  ctx.stroke(lid);
  ctx.fillStyle = '#c9a23c'; // straps continue over the lid
  ctx.fillRect(-W * 0.34 - 5, -lh * 0.92, 10, lh * 0.92);
  ctx.fillRect(W * 0.34 - 5, -lh * 0.92, 10, lh * 0.92);
  ctx.restore();

  // Lock plate + keyhole on the front.
  ctx.fillStyle = '#e0bb52';
  ctx.fillRect(x - 10, y - H - 4, 20, 22);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.strokeRect(x - 10, y - H - 4, 20, 22);
  ctx.fillStyle = '#241605';
  ctx.beginPath(); ctx.arc(x, y - H + 3, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - 1.5, y - H + 3, 3, 7);
}

// The pyramid dungeon revealed by the Mummy King's fall. (x, y) is the
// ground under the doorway — the Gate of Descent is drawn over it, so
// the pyramid is the backdrop the gate is set into.
function drawPyramid(ctx, x, y) {
  const W = 440, H = 330; // half-base, height
  ctx.save();
  // Ground shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, W * 1.05, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body.
  const g = ctx.createLinearGradient(x, y - H, x, y);
  g.addColorStop(0, '#d9bd82');
  g.addColorStop(1, '#8a6f42');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - W, y);
  ctx.lineTo(x, y - H);
  ctx.lineTo(x + W, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(50, 35, 12, 0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Shaded face: the right slope falls into its own shadow.
  ctx.fillStyle = 'rgba(40, 28, 10, 0.28)';
  ctx.beginPath();
  ctx.moveTo(x, y - H);
  ctx.lineTo(x + W, y);
  ctx.lineTo(x + W * 0.25, y);
  ctx.closePath();
  ctx.fill();
  // Masonry courses, tighter toward the top.
  ctx.strokeStyle = 'rgba(70, 50, 20, 0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 9; i++) {
    const f = i / 9;
    const yy = y - H * f;
    const half = W * (1 - f);
    ctx.beginPath();
    ctx.moveTo(x - half, yy);
    ctx.lineTo(x + half, yy);
    ctx.stroke();
  }
  // Gold capstone catching the light.
  ctx.fillStyle = '#ffd166';
  ctx.shadowColor = '#ffb020';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(x - W * 0.09, y - H * 0.91);
  ctx.lineTo(x, y - H);
  ctx.lineTo(x + W * 0.09, y - H * 0.91);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // Dark doorway the gate stands in.
  ctx.fillStyle = '#160f06';
  ctx.beginPath();
  ctx.moveTo(x - 60, y);
  ctx.lineTo(x - 60, y - 120);
  ctx.quadraticCurveTo(x, y - 175, x + 60, y - 120);
  ctx.lineTo(x + 60, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// A massive weathered statue of the vault's builder — the player's own
// sprite carved in grey stone, skull bared, eyes hollowed, on a mossy
// plinth. (x, y) is the ground under the plinth; flip mirrors the pose.
function drawStatue(ctx, x, y, look, flip, seed) {
  const rows = [...look.torso, ...CHAR_LEGS.stand];
  const cols = rows[0].length;
  const p = 7; // cell size — roughly triple the in-game sprite
  const wpx = cols * p, hpx = rows.length * p;
  const rand = (n) => {
    const v = Math.sin(seed * 77.7 + n * 41.3) * 43758.5453;
    return v - Math.floor(v);
  };

  // Ground shadow + two-step stone plinth with creeping moss.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, wpx * 0.8, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#454b41';
  ctx.fillRect(x - wpx * 0.72, y - 15, wpx * 1.44, 15);
  ctx.fillStyle = '#535948';
  ctx.fillRect(x - wpx * 0.58, y - 28, wpx * 1.16, 13);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; // slab catch-lights
  ctx.fillRect(x - wpx * 0.72, y - 15, wpx * 1.44, 3);
  ctx.fillRect(x - wpx * 0.58, y - 28, wpx * 1.16, 3);
  ctx.fillStyle = 'rgba(110, 160, 100, 0.3)';
  ctx.fillRect(x - wpx * 0.72, y - 4, wpx * 1.44, 4);

  // The figure: stone greys, bone-white skull where skin was, hollow eyes.
  const x0 = x - wpx / 2, y0 = y - 28 - hpx;
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry];
    for (let cx = 0; cx < cols; cx++) {
      const ch = row[flip ? cols - 1 - cx : cx];
      if (ch === '.') continue;
      ctx.fillStyle =
        ch === 'S' ? '#c2bcab' :                       // skull
        ch === 'E' ? '#252a23' :                       // hollow sockets
        (ch === 'O' || ch === 'K') ? '#575d52' :       // boots / cape, darker
        '#6d7367';                                     // the rest: plain stone
      ctx.fillRect(x0 + cx * p, y0 + ry * p, p + 0.4, p + 0.4);
    }
  }

  // Weathering: one long crack down the torso + moss clinging up top.
  ctx.strokeStyle = 'rgba(28, 32, 26, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let kx = x + (rand(1) - 0.5) * wpx * 0.4, ky = y0 + hpx * 0.3;
  ctx.moveTo(kx, ky);
  for (let i = 0; i < 4; i++) {
    kx += (rand(i + 2) - 0.5) * 14;
    ky += hpx * 0.14;
    ctx.lineTo(kx, ky);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(110, 160, 100, 0.28)';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x0 + rand(i + 8) * (wpx - 14), y0 + rand(i + 12) * hpx * 0.4, 12, 6);
  }
}

// The Dash powerup icon: a glowing badge with a double chevron, gold-rimmed.
function drawDashIcon(ctx, x, y, sc, alpha, t) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
  g.addColorStop(0, '#1c3a52');
  g.addColorStop(1, '#0c1826');
  ctx.fillStyle = g;
  ctx.shadowColor = '#5fd8ff';
  ctx.shadowBlur = 14 + Math.sin(t * 5) * 4;
  ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Double chevron » with speed ticks trailing behind
  ctx.strokeStyle = '#bdeeff';
  ctx.shadowColor = '#5fd8ff';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const ox of [-5, 5]) {
    ctx.beginPath();
    ctx.moveTo(ox - 4, -8);
    ctx.lineTo(ox + 4, 0);
    ctx.lineTo(ox - 4, 8);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha * 0.6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-15, -5); ctx.lineTo(-11, -5);
  ctx.moveTo(-16, 2);  ctx.lineTo(-12, 2);
  ctx.stroke();
  ctx.restore();
}

// Game: master state machine + fixed-timestep loop -------------------
// Compact an entity array in place, keeping only the living —
// avoids allocating five fresh arrays every frame.
function cullDead(arr) {
  let n = 0;
  for (const e of arr) if (e.alive) arr[n++] = e;
  arr.length = n;
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'start'; // start | playing | levelup | paused | gameover
    this.world = null;
    this._acc = 0;
    this._last = 0;
    this.STEP = 1 / 60; // fixed update step
  }

  newWorld(stage) {
    this.world = {
      stage, // 1 crypt | 2 dark forest | 3 desert kingdom
      player: new Player(CONFIG.worldWidth / 2, CONFIG.worldHeight / 2),
      enemies: [],
      projectiles: [],
      pickups: [],
      floaters: [], // floating damage numbers / VFX text
      hazards: [],  // hostile projectiles (dragon fireballs)
      boss: null,   // set by the spawner on the final wave
      spawner: new Spawner(),
      time: 0,
      kills: 0,
    };
    // Stage 3: seed the desert kingdom's breakable structures — towers
    // (some manned by an archer) and obelisks — kept off the spawn area
    // and each other. They ride the enemies list: hittable, solid,
    // depth-sorted like everyone else.
    if (stage === 3) {
      const cfg = CONFIG.structures;
      const rand = (n) => {
        const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return v - Math.floor(v);
      };
      const placed = [];
      const total = cfg.towers + cfg.obelisks;
      for (let i = 0; i < total * 8 && placed.length < total; i++) {
        const x = 150 + rand(i * 2) * (CONFIG.worldWidth - 300);
        const y = 150 + rand(i * 2 + 1) * (CONFIG.worldHeight - 300);
        if (Vec.dist(x, y, CONFIG.worldWidth / 2, CONFIG.worldHeight / 2) < 400) continue;
        if (placed.some((p) => Vec.dist(x, y, p.x, p.y) < cfg.spacing)) continue;
        const e = new Enemy(x, y, placed.length < cfg.towers ? 'tower' : 'obelisk');
        if (e.type === 'tower') e.hasShooter = rand(i * 3 + 7) < cfg.armedChance;
        placed.push(e);
        this.world.enemies.push(e);
      }
    }
    // Claimed the Crimson Boomerang in a past run: start armed, and mark
    // the altar claimed so the relic never re-materializes on the dais.
    if (Progress.boomerang) {
      this.world.player.stats.boomerang = true;
      this.world.altarClaimed = true;
    }
    this.world.player.stage = stage;
    Progression.init(this.world.player);
    // Juice state: deltas watched each update drive shake/flash/SFX, so
    // combat code never needs a reference back into the game shell.
    this._lastHp = this.world.player.health;
    this._lastXp = 0;
    this._lastKills = 0;
    this._killSfxT = -1;
    this._xpSfxT = -1;
    this._shake = 0;
    this._hurtFlash = 0;
  }

  start(stage = 1) {
    this.newWorld(stage);
    this.state = 'playing';
    Screens.hideAll(); // clear start / game-over / any leftover modal
    Hud.init();
    Music.start(stage); // per-stage loop; the click satisfies autoplay rules
  }

  // Fixed-timestep accumulator loop.
  frame(ts) {
    const dt = Math.min(0.25, (ts - this._last) / 1000) || 0;
    this._last = ts;
    if (this._hurtFlash > 0) this._hurtFlash -= dt; // fades in real time
    if (this.state === 'playing') {
      this._acc += dt;
      // Re-check state each step: an update may open the level-up modal,
      // which must immediately halt further simulation this frame.
      while (this._acc >= this.STEP && this.state === 'playing') {
        this.update(this.STEP);
        this._acc -= this.STEP;
      }
    } else {
      this._acc = 0; // drop backlog so resuming doesn't fast-forward
    }
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const w = this.world;
    // Mouse in world coords (screen + camera) for mouse-follow movement —
    // computed before the vault branch so it steers there too.
    Input.mouseWorldX = Input.mouse.x * Camera.zoom + Camera.x;
    Input.mouseWorldY = Input.mouse.y * Camera.zoom + Camera.y;
    if (w.treasure) return this.updateTreasure(dt);
    w.time += dt;
    w.player.update(dt, Input, w);

    // Altar relic: materializes at the unlock wave; step onto the dais
    // to claim the Crimson Boomerang.
    if (!w.altarClaimed &&
        w.spawner.wave >= CONFIG.weapons.boomerang.unlockWave &&
        Vec.dist(w.player.x, w.player.y, CONFIG.altar.x, CONFIG.altar.y) < 60) {
      w.altarClaimed = true;
      w.player.stats.boomerang = true;
      // Not permanent yet — Combat makes it stick if the dragon falls
      // while you hold it (claim + boss kill in the same run).
      w.floaters.push(new FloatingText(
        CONFIG.altar.x, CONFIG.altar.y - 90,
        'CRIMSON BOOMERANG!', { color: '#ff3b5c', size: 20, life: 1.6 }
      ));
    }
    w.spawner.update(dt, w);
    for (const e of w.enemies)     e.update(dt, w.player, w); // boss needs world
    Separation.resolve(w); // un-stack the crowd after everyone has moved
    for (const p of w.projectiles) p.update(dt);
    for (const h of w.hazards)     h.update(dt);
    for (const k of w.pickups)     k.update(dt, w.player);
    Combat.resolve(w); // may push new floaters on hit
    for (const f of w.floaters)    f.update(dt);

    // Cull the dead so arrays don't grow unbounded.
    cullDead(w.enemies);
    cullDead(w.projectiles);
    cullDead(w.hazards);
    cullDead(w.pickups);
    cullDead(w.floaters);

    if (Progression.checkLevelUp(w.player)) this.openLevelUp();
    // Victory goes through the Gate of Descent (spawned on the boss kill):
    // the doors swing open as the player nears; stepping onto the stair
    // in the doorway ends the stage — even with stragglers still alive.
    if (w.gate && w.player.alive) {
      const d = Vec.dist(w.player.x, w.player.y, w.gate.x, w.gate.y);
      if (d < 170) w.gate.open = Math.min(1, w.gate.open + dt / 0.9);
      if (w.gate.open >= 1 && d < 40) this.victory();
    }
    if (!w.player.alive) this.gameOver();
    Camera.follow(w.player);

    // Juice: react to what changed this tick (any damage source counts).
    if (w.player.health < this._lastHp) {
      Sfx.hurt();
      this._shake = 0.25;
      this._hurtFlash = 0.25;
    }
    this._lastHp = w.player.health;
    // Kill / XP blips, throttled so a mowed-down horde doesn't clip audio.
    if (w.kills > this._lastKills && w.time - this._killSfxT > 0.06) {
      Sfx.kill();
      this._killSfxT = w.time;
    }
    this._lastKills = w.kills;
    if (w.player.xp > this._lastXp && w.time - this._xpSfxT > 0.05) {
      Sfx.xp();
      this._xpSfxT = w.time;
    }
    this._lastXp = w.player.xp;
    // The dragon's entrance: one roar + a long rumble of the camera.
    if (w.boss && !w.bossAnnounced) {
      w.bossAnnounced = true;
      Sfx.roar();
      this._shake = 0.6;
    }
    // Fly-by cameo: same roar, shorter rumble (flag set by the spawner).
    if (w.flybyRoar) {
      w.flybyRoar = false;
      Sfx.roar();
      this._shake = 0.4;
    }
    // Screen shake: random camera offset that decays to nothing.
    if (this._shake > 0) {
      this._shake = Math.max(0, this._shake - dt);
      const m = 24 * this._shake;
      Camera.x += (Math.random() * 2 - 1) * m;
      Camera.y += (Math.random() * 2 - 1) * m;
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.world) return;
    if (this.world.treasure) return this.renderTreasure();

    Arena.render(ctx, Camera, this.world.stage);

    // Pickups lie flat on the floor — always drawn under standing actors.
    for (const k of this.world.pickups) k.render(ctx, Camera);

    // The Gate of Descent (post-boss exit) stands on the floor plane.
    // Stage 3's gate is set into the revealed pyramid dungeon.
    if (this.world.gate) {
      const g = this.world.gate;
      const s = Camera.toScreen(g.x, g.y);
      if (s.x > -520 && s.x < Camera.w + 520 &&
          s.y > -420 && s.y < Camera.h + 420) {
        if (g.pyramid) drawPyramid(ctx, s.x, s.y);
        drawGate(ctx, s.x, s.y, g.open, performance.now() / 1000);
      }
    }

    // The relic hovers over the altar pedestal from its unlock wave until
    // claimed, slowly spinning and bobbing so it beacons from a distance.
    if (!this.world.altarClaimed &&
        this.world.spawner.wave >= CONFIG.weapons.boomerang.unlockWave) {
      const now = performance.now() / 1000;
      const alt = Camera.toScreen(CONFIG.altar.x, CONFIG.altar.y);
      drawBoomerang(ctx, alt.x, alt.y - 78 + Math.sin(now * 2.2) * 5,
                    1.35, now * 1.8);
    }

    // Billboard depth sort: actors lower on screen (higher y) draw in front,
    // so closer characters overlap those behind them. This is the core of
    // the Vampire-Survivors look on a flat movement plane.
    const actors = [this.world.player, ...this.world.enemies];
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) a.render(ctx, Camera);

    // Projectiles render on top of everyone.
    for (const p of this.world.projectiles) p.render(ctx, Camera);

    // Hostile fireballs blaze above the crowd.
    for (const h of this.world.hazards) h.render(ctx, Camera);

    // Damage numbers sit above everything in the world.
    for (const f of this.world.floaters) f.render(ctx, Camera);

    // Fog of war: clear around the player, opaque past the sight edge,
    // so nothing outside can be seen (or targeted — weapons.js). Stage 2's
    // forest murk, or the Mummy King's sandstorm — sand-colored, half the
    // sight. Same-color alpha ramp with a doubled inner stop, dodging the
    // transparent-stop gradient bug noted below. Rebuilt every frame —
    // it tracks the player.
    if (this.world.stage === 2 || this.world.sandstorm) {
      const F = CONFIG.fog;
      const mul = this.world.sandstorm ? CONFIG.boss3.stormSightMul : 1;
      const R = F.radius * mul, E = F.edge * mul;
      const rgb = this.world.sandstorm ? '148, 118, 66' : '7, 13, 6';
      const p = Camera.toScreen(this.world.player.x, this.world.player.y);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R + E);
      g.addColorStop(0, `rgba(${rgb}, 0)`);
      g.addColorStop(R / (R + E), `rgba(${rgb}, 0)`);
      g.addColorStop(1, `rgba(${rgb}, 0.96)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Screen-space vignette: darkened corners focus the eye on the player
    // and sell the gothic mood. Uses a multiply gradient with fully opaque
    // stops (transparent stops render inconsistently across canvas
    // implementations). Cached per canvas size.
    const vKey = `${canvas.width}x${canvas.height}s${this.world.stage}`;
    if (!this._vignette || this._vignetteKey !== vKey) {
      // r0 = 0 with a doubled white stop: same look, but avoids the
      // inner-radius rendering bug some canvas implementations have.
      const g = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.hypot(canvas.width, canvas.height) * 0.6
      );
      const plateau = (Math.min(canvas.width, canvas.height) * 0.45) /
                      (Math.hypot(canvas.width, canvas.height) * 0.6);
      g.addColorStop(0, '#ffffff');        // multiply by white = unchanged
      g.addColorStop(plateau, '#ffffff');  // flat center plateau
      // Corners darken toward violet-grey in the crypt, mossy grey in the
      // forest, sun-scorched umber in the desert.
      g.addColorStop(1, this.world.stage === 3 ? '#8a7452'
                     : this.world.stage === 2 ? '#66785f' : '#6f6a80');
      this._vignette = g;
      this._vignetteKey = vKey;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Hurt flash: a red wash over everything that fades out fast.
    if (this._hurtFlash > 0) {
      ctx.fillStyle = `rgba(255, 40, 60, ${0.28 * (this._hurtFlash / 0.25)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    Hud.render(this.world);

    // Touch joystick overlay (screen space): faint base ring where the
    // finger landed, knob clamped to the rim, tracking the drag.
    if (Input.touch && this.state === 'playing') {
      const { ox, oy, x, y } = Input.touch;
      const R = 48;
      const dx = x - ox, dy = y - oy;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(len, R);
      ctx.save();
      // Joystick coords are CSS pixels; scale the whole overlay so the
      // ring keeps its on-screen size regardless of the zoom-out.
      ctx.scale(Camera.zoom, Camera.zoom);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#c9b8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#c9b8ff';
      ctx.beginPath();
      ctx.arc(ox + (dx / len) * k, oy + (dy / len) * k, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  openLevelUp() {
    this.state = 'levelup';
    Sfx.levelup();
    const player = this.world.player;
    // Each card can be swapped for gold. ui.js owns the button + the
    // Bank charge; this just rolls the replacement.
    const rerollOne = (excludeIds) =>
      Progression.rollChoices(1, player, excludeIds)[0] ?? null;
    LevelUp.open(Progression.rollChoices(3, player), (id) => {
      Progression.apply(player, id);
      Hud.syncAbilities(player); // sidebar reflects the new pick
      this.state = 'playing';
    }, rerollOne);
  }

  // Esc: pause/resume during play; also closes start-menu panels.
  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      PauseMenu.open(this.world); // snapshot of stats + build
    } else if (this.state === 'paused') {
      Screens.hide('pause');
      this.state = 'playing';
    } else if (this.state === 'start') {
      Screens.hide('abilities');
      Screens.hide('menu-leaderboard');
      Screens.hide('settings');
      Screens.hide('shop');
      Screens.hide('stage');
      Screens.show('start');
    }
    // levelup / gameover / victory: Esc deliberately does nothing —
    // the level-up choice is mandatory and the run is already over.
  }

  // Exit to the start menu from the end screen. The dead world is
  // dropped so nothing keeps rendering behind the menu.
  exitToMenu() {
    this.state = 'start';
    this.world = null;
    Music.stop();
    Screens.hideAll();
    Hud.hide();
    Screens.show('start');
  }

  gameOver() { this._end(false); }

  // GGs — the stair taken. Beating Stage 1 unlocks Stage 2 in the menu.
  // Stage 2's stair always descends into the Jungle Vault: the chest
  // holds the Dash (until claimed), and the desert gate in the far
  // corner walks straight down into Stage 3.
  victory() {
    if (this.world.stage === 1) Progress.unlockStage2();
    if (this.world.stage === 2) return this.enterTreasure();
    this._end(true);
  }

  // Morph the live world into the vault: same run (score/kills/time kept),
  // but combat is over — just the room, the player, and the chest.
  enterTreasure() {
    const w = this.world;
    for (const arr of [w.enemies, w.projectiles, w.hazards, w.pickups, w.floaters]) arr.length = 0;
    w.boss = null;
    w.gate = null;
    w.treasure = {
      // Dash already claimed in a past run: the chest is gone and the
      // gate is live from the start (t is large so no grab-flash plays).
      phase: Progress.dash ? 'got' : 'closed', // closed -> opening -> float -> got
      t: Progress.dash ? 99 : 0,
      looted: Progress.dash, // chest despawns once its prize is taken
      chest: { x: VAULT.x + VAULT.w / 2, y: VAULT.y + VAULT.h / 2 - 30 },
      icon: null,
      // The Desert Gate, top-left: the vault's one exit — stepping
      // through descends straight into Stage 3.
      gate3: { x: VAULT.x + 130, y: VAULT.y + 155, open: 0 },
    };
    w.player.x = VAULT.x + VAULT.w / 2;
    w.player.y = VAULT.y + VAULT.h - 90;
    Camera.follow(w.player);
  }

  // Vault sim: walk, touch the chest, watch the powerup ceremony, leave.
  updateTreasure(dt) {
    const w = this.world, T = w.treasure;
    w.player.update(dt, Input, w);
    // Keep the player inside the vault walls.
    const m = 34 + w.player.radius;
    w.player.x = Vec.clamp(w.player.x, VAULT.x + m, VAULT.x + VAULT.w - m);
    w.player.y = Vec.clamp(w.player.y, VAULT.y + m + 30, VAULT.y + VAULT.h - m);
    for (const f of w.floaters) f.update(dt);
    cullDead(w.floaters);
    Camera.follow(w.player);

    T.t += dt;
    const headX = w.player.x, headY = w.player.y - w.player.radius * 4.4;
    if (T.phase === 'closed') {
      if (Vec.dist(w.player.x, w.player.y, T.chest.x, T.chest.y) < 90) {
        T.phase = 'opening';
        T.t = 0;
        Sfx.kill(); // creaking-latch stand-in
      }
    } else if (T.phase === 'opening') {
      if (T.t >= 0.6) {
        T.phase = 'float';
        T.t = 0;
        T.icon = { x: T.chest.x, y: T.chest.y - 70 };
      }
    } else if (T.phase === 'float') {
      // Icon drifts from the chest mouth to above the player's head.
      const f = Math.min(1, T.t / 1.2);
      const e = f * f * (3 - 2 * f); // smoothstep
      T.icon.x = T.chest.x + (headX - T.chest.x) * e;
      T.icon.y = (T.chest.y - 70) + (headY - (T.chest.y - 70)) * e - Math.sin(e * Math.PI) * 34;
      if (f >= 1) {
        T.phase = 'got';
        T.t = 0;
        Progress.unlockDash();
        w.player.glowT = 1.5;
        Sfx.levelup();
        w.floaters.push(new FloatingText(
          headX, headY - 34,
          'DASH UNLOCKED!', { color: '#ffd76a', size: 22, life: 1.8 }
        ));
      }
    } else { // got: icon hovers over the glowing player while it fades
      if (T.icon) {
        T.icon.x = w.player.x;
        T.icon.y = w.player.y - w.player.radius * 4.4;
      }
      // Ceremony over: the emptied chest crumbles away for good.
      if (T.t > 2.2) T.looted = true;
    }

    // The Desert Gate stays sealed until the Dash is claimed, then swings
    // open as the player nears; stepping through unlocks Stage 3 and
    // walks straight down into it — smooth progression, no detours.
    if (T.phase === 'got') {
      const d3 = Vec.dist(w.player.x, w.player.y, T.gate3.x, T.gate3.y);
      if (d3 < 170) T.gate3.open = Math.min(1, T.gate3.open + dt / 0.9);
      if (T.gate3.open >= 1 && d3 < 40) {
        Progress.unlockStage3();
        this.start(3);
      }
    }
  }

  renderTreasure() {
    const { ctx, canvas } = this;
    const w = this.world, T = w.treasure;
    const t = performance.now() / 1000;

    // Darkness beyond the vault walls.
    ctx.fillStyle = '#040703';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const o = Camera.toScreen(VAULT.x, VAULT.y);

    // Floor: mottled jungle moss, tile-hashed like the arenas.
    const TL = Arena.TILE;
    const MOSS = ['#1c3120', '#193021', '#203726', '#172b1d'];
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, VAULT.w, VAULT.h);
    ctx.clip();
    for (let ix = Math.floor(VAULT.x / TL); ix <= Math.floor((VAULT.x + VAULT.w) / TL); ix++) {
      for (let iy = Math.floor(VAULT.y / TL); iy <= Math.floor((VAULT.y + VAULT.h) / TL); iy++) {
        const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
        const s = Camera.toScreen(ix * TL, iy * TL);
        ctx.fillStyle = MOSS[h % MOSS.length];
        ctx.fillRect(s.x, s.y, TL, TL);
        // Sparse fern tufts
        ctx.strokeStyle = 'rgba(90, 150, 80, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const fx = s.x + 12 + ((h >> (i * 4)) % 79);
          const fy = s.y + 16 + ((h >> (i * 3 + 2)) % 71);
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx - 4, fy - 9);
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + 4, fy - 9);
        }
        ctx.stroke();
      }
    }
    // Warm ambience pooled around the chest.
    const cs = Camera.toScreen(T.chest.x, T.chest.y);
    const amb = ctx.createRadialGradient(cs.x, cs.y - 30, 20, cs.x, cs.y - 30, 300);
    amb.addColorStop(0, 'rgba(255, 200, 110, 0.14)');
    amb.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = amb;
    ctx.fillRect(o.x, o.y, VAULT.w, VAULT.h);

    // Spilled coins glinting around the chest — treasure that didn't fit.
    ctx.fillStyle = '#e0bb52';
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4, rr = 70 + (i * 53 % 60);
      const gx = cs.x + Math.cos(a) * rr, gy = cs.y + Math.sin(a) * rr * 0.5 + 10;
      ctx.beginPath();
      ctx.ellipse(gx, gy, 4, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glowing mushroom clusters tucked along the walls.
    for (const [fx, fy] of [
      [0.09, 0.16], [0.91, 0.62], [0.08, 0.85], [0.55, 0.09], [0.35, 0.93], [0.93, 0.28],
    ]) {
      const mx = o.x + fx * VAULT.w, my = o.y + fy * VAULT.h;
      ctx.save();
      ctx.shadowColor = '#5fd8ff';
      for (let i = 0; i < 3; i++) {
        const sx2 = mx + i * 11 - 11, sy2 = my + (i % 2) * 6;
        const h2 = 8 + (i * 3) % 6;
        ctx.shadowBlur = 7 + Math.sin(t * 2.5 + mx + i) * 3;
        ctx.fillStyle = '#8a9b86';
        ctx.fillRect(sx2 - 1.5, sy2 - h2, 3, h2);
        ctx.fillStyle = '#7fd8e8';
        ctx.beginPath();
        ctx.ellipse(sx2, sy2 - h2, 6, 4, 0, Math.PI, 0);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

    // Walls: heavy jungle-stone border with a mossy inlay + hanging vines.
    ctx.strokeStyle = '#2b3627';
    ctx.lineWidth = 26;
    ctx.strokeRect(o.x, o.y, VAULT.w, VAULT.h);
    ctx.strokeStyle = 'rgba(122, 196, 124, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x + 15, o.y + 15, VAULT.w - 30, VAULT.h - 30);
    ctx.strokeStyle = 'rgba(70, 130, 70, 0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 13; i++) { // vines draped off the top wall
      const vx = o.x + 60 + i * (VAULT.w - 120) / 12;
      const len = 34 + ((i * 37) % 42);
      ctx.beginPath();
      ctx.moveTo(vx, o.y + 10);
      ctx.quadraticCurveTo(vx + 8, o.y + len * 0.6, vx + Math.sin(t * 0.8 + i) * 4, o.y + len);
      ctx.stroke();
    }

    // Braziers flanking the chest.
    for (const side of [-1, 1]) {
      const bx = cs.x + side * 150, by = cs.y - 6;
      const flick = 0.75 + Math.sin(t * 7 + side) * 0.25;
      ctx.fillStyle = `rgba(255, 160, 60, ${0.05 + 0.05 * flick})`;
      ctx.beginPath(); ctx.ellipse(bx, by + 4, 44, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a4437';
      ctx.fillRect(bx - 4, by - 26, 8, 26);
      ctx.beginPath(); ctx.ellipse(bx, by - 26, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = 'rgba(255, 150, 40, 0.9)';
      ctx.shadowBlur = 10 + flick * 8;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.ellipse(bx, by - 34, 5, 8 + flick * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // The Desert Gate, top-left — the way down to Stage 3.
    const g3 = Camera.toScreen(T.gate3.x, T.gate3.y);
    drawGate(ctx, g3.x, g3.y, T.gate3.open, t);
    ctx.save();
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 210, 120, 0.85)';
    ctx.fillText('THE DESERT GATE', g3.x, g3.y - 150);
    ctx.restore();

    // Four colossal statues of the fallen — the player carved in stone —
    // ringing the chest, each pair turned to face it.
    const statues = [
      [VAULT.x + VAULT.w * 0.22, VAULT.y + VAULT.h * 0.30],
      [VAULT.x + VAULT.w * 0.78, VAULT.y + VAULT.h * 0.30],
      [VAULT.x + VAULT.w * 0.22, VAULT.y + VAULT.h * 0.80],
      [VAULT.x + VAULT.w * 0.78, VAULT.y + VAULT.h * 0.80],
    ];

    // Statues + chest + player, depth-sorted so overlaps read right.
    const openFrac = T.phase === 'closed' ? 0
                   : T.phase === 'opening' ? Math.min(1, T.t / 0.6) : 1;
    const drawables = [
      // The chest despawns once its prize has been carried off.
      ...(T.looted ? [] : [{ y: T.chest.y, draw: () => drawChest(ctx, cs.x, cs.y, openFrac, t) }]),
      { y: w.player.y, draw: () => w.player.render(ctx, Camera) },
      ...statues.map(([sx, sy], i) => ({
        y: sy,
        draw: () => {
          const p = Camera.toScreen(sx, sy);
          drawStatue(ctx, p.x, p.y, w.player.look, sx > T.chest.x, i + 1);
        },
      })),
    ];
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    // The floating powerup icon.
    if (T.icon) {
      const si = Camera.toScreen(T.icon.x, T.icon.y);
      // Hovers in place after the flash, fading out with the ceremony.
      const alpha = T.phase === 'got' ? Vec.clamp(1 - (T.t - 1.0) / 0.6, 0, 1) : 1;
      const bobY = T.phase === 'got' ? Math.sin(t * 3) * 3 : 0;
      if (alpha > 0) drawDashIcon(ctx, si.x, si.y + bobY, 1.15, alpha, t);
    }

    // The grab flash: a quick white pop at the icon + a faint screen kiss.
    if (T.phase === 'got' && T.t < 0.35) {
      const f = T.t / 0.35;
      const si = Camera.toScreen(T.icon.x, T.icon.y);
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(si.x, si.y, 10 + f * 70, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.16 * (1 - f)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (const f of w.floaters) f.render(ctx, Camera);
    Hud.render(w);
  }

  _end(victory) {
    this.state = victory ? 'victory' : 'gameover';
    Music.stop();
    if (victory) Sfx.victory(); else Sfx.defeat();
    const w = this.world;
    const base = (w.kills * 10 + Math.floor(w.time)) * 0.5 * w.player.level;
    const stats = {
      // Winning doubles the run score and adds a flat clear bonus.
      score: Math.round(victory ? base * 2 + 5000 : base),
      wave: w.spawner.wave,
      time: w.time,
      kills: w.kills,
      win: victory, // persisted to the leaderboard (crown marker)
    };
    Screens.showEnd(victory, w.stage);
    Leaderboard.show(stats); // render board + arm the save-score flow
  }
}

// Boot ---------------------------------------------------------------
function main() {
  const canvas = document.getElementById('game-canvas');

  const resize = () => {
    // Coarse primary pointer = phone/tablet (not a touchscreen laptop):
    // render a 1.5x wider world slice and let the CSS 100% sizing scale
    // it down, so small screens aren't stuck with a keyhole view.
    Camera.zoom = matchMedia('(pointer: coarse)').matches ? 1.5 : 1;
    canvas.width = innerWidth * Camera.zoom;
    canvas.height = innerHeight * Camera.zoom;
    Camera.w = canvas.width;
    Camera.h = canvas.height;
  };
  resize();
  addEventListener('resize', resize);

  Input.init(canvas);
  Leaderboard.init(); // cache DOM + bind the save-score button once
  Menu.init();        // start-menu panels (Abilities / Leaderboard)
  const game = new Game(canvas);
  Screens.bind({
    onStart: (stage) => game.start(stage),
    // Play Again re-runs whatever stage just ended.
    onRestart: () => game.start(game.world?.stage ?? 1),
    onExit: () => game.exitToMenu(),
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') game.togglePause();
  });
  // HUD pause button + pause-screen Resume — same toggle as Esc.
  document.getElementById('btn-pause')?.addEventListener('click', () => game.togglePause());
  document.getElementById('btn-resume')?.addEventListener('click', () => game.togglePause());
  Screens.show('start');
  requestAnimationFrame((t) => { game._last = t; game.frame(t); });
}

main();
