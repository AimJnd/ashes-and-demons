/*
  game.js  —  entry point + engine (merged: main + game loop + input +
  camera + math + master state machine). This is the only <script> the
  HTML loads; it imports everything else.
*/

import { CONFIG, isTrapTile, Progress } from './config.js';
import { FloatingText, drawBoomerang } from './entities.js';
import { Player } from './player.js';
import { Spawner, Combat, Progression, Separation } from './systems.js';
import { Hud, Screens, LevelUp, Leaderboard, Menu, PauseMenu } from './ui.js';
import { Sfx } from './audio.js';

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
      if (this.RUNES.some((c) => Vec.dist(x, y, c.x, c.y) < c.r + r)) continue;
      if (isTrapTile(Math.floor(x / this.TILE), Math.floor(y / this.TILE))) continue;
      if (out.some((t) => Vec.dist(x, y, t.x, t.y) < t.r + r + 20)) continue;
      out.push({ x, y, r, seed: i });
    }
    return (this._trees = out);
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

    // Base coat: dark mortar between flagstones, or black loam under grass.
    ctx.fillStyle = forest ? '#0d160e' : '#241d2e';
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
    for (let ix = Math.max(0, ix0); ix <= ix1; ix++) {
      for (let iy = Math.max(0, iy0); iy <= iy1; iy++) {
        if (ix >= CONFIG.worldWidth / T || iy >= CONFIG.worldHeight / T) continue;
        const sx = ix * T - camera.x, sy = iy * T - camera.y;
        if (isTrapTile(ix, iy)) { this.renderTrap(ctx, sx, sy, forest); continue; }
        const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
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

    // Forest canopies sit on the floor plane, under actors and runes.
    if (forest) {
      for (const t of this.trees()) {
        const s = camera.toScreen(t.x, t.y);
        if (s.x < -t.r * 2 || s.x > camera.w + t.r * 2 ||
            s.y < -t.r * 2 || s.y > camera.h + t.r * 2) continue;
        this.renderTree(ctx, s.x, s.y, t.r, t.seed);
      }
    }

    // Blood runes (see "blood rune.webp"), each ringed with candles.
    const now = performance.now() / 1000;
    this.RUNES.forEach((c, i) => {
      const s = camera.toScreen(c.x, c.y);
      if (s.x < -c.r - 60 || s.x > camera.w + c.r + 60 ||
          s.y < -c.r - 60 || s.y > camera.h + c.r + 60) return;
      this.renderBloodRune(ctx, s.x, s.y, c.r, i + 1, now);
    });

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

// Game: master state machine + fixed-timestep loop -------------------
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
      stage, // 1 | 2 — same rules for now; Stage 2 gets its own later
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
    w.time += dt;
    // Mouse in world coords (screen + camera) for mouse-follow movement.
    Input.mouseWorldX = Input.mouse.x + Camera.x;
    Input.mouseWorldY = Input.mouse.y + Camera.y;
    w.player.update(dt, Input, w);

    // Altar relic: materializes at the unlock wave; step onto the dais
    // to claim the Crimson Boomerang.
    if (!w.altarClaimed &&
        w.spawner.wave >= CONFIG.weapons.boomerang.unlockWave &&
        Vec.dist(w.player.x, w.player.y, CONFIG.altar.x, CONFIG.altar.y) < 60) {
      w.altarClaimed = true;
      w.player.stats.boomerang = true;
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
    w.enemies = w.enemies.filter((e) => e.alive);
    w.projectiles = w.projectiles.filter((p) => p.alive);
    w.hazards = w.hazards.filter((h) => h.alive);
    w.pickups = w.pickups.filter((k) => k.alive);
    w.floaters = w.floaters.filter((f) => f.alive);

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

    Arena.render(ctx, Camera, this.world.stage);

    // Pickups lie flat on the floor — always drawn under standing actors.
    for (const k of this.world.pickups) k.render(ctx, Camera);

    // The Gate of Descent (post-boss exit) stands on the floor plane.
    if (this.world.gate) {
      const g = this.world.gate;
      const s = Camera.toScreen(g.x, g.y);
      if (s.x > -160 && s.x < Camera.w + 160 &&
          s.y > -160 && s.y < Camera.h + 160) {
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
      // Corners darken toward violet-grey in the crypt, mossy grey in the forest.
      g.addColorStop(1, this.world.stage === 2 ? '#66785f' : '#6f6a80');
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
    LevelUp.open(Progression.rollChoices(3, this.world.player), (id) => {
      Progression.apply(this.world.player, id);
      Hud.syncAbilities(this.world.player); // sidebar reflects the new pick
      this.state = 'playing';
    });
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
    Screens.hideAll();
    Hud.hide();
    Screens.show('start');
  }

  gameOver() { this._end(false); }

  // GGs — the stair taken. Beating Stage 1 unlocks Stage 2 in the menu.
  victory() {
    if (this.world.stage === 1) Progress.unlockStage2();
    this._end(true);
  }

  _end(victory) {
    this.state = victory ? 'victory' : 'gameover';
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
    Screens.showEnd(victory);
    Leaderboard.show(stats); // render board + arm the save-score flow
  }
}

// Boot ---------------------------------------------------------------
function main() {
  const canvas = document.getElementById('game-canvas');

  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    Camera.w = innerWidth;
    Camera.h = innerHeight;
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
