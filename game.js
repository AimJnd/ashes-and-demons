/*
  game.js  —  entry point + engine (merged: main + game loop + input +
  camera + math + master state machine). This is the only <script> the
  HTML loads; it imports everything else.
*/

import { CONFIG } from './config.js';
import { Player } from './player.js';
import { Spawner, Combat, Progression } from './systems.js';
import { Hud, Screens, LevelUp, Leaderboard, Menu } from './ui.js';

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
  init() {
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup',   (e) => this.keys.delete(e.code));
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    addEventListener('mousedown', () => { this.mouse.down = true; });
    addEventListener('mouseup',   () => { this.mouse.down = false; });
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
  TILE: 200, // big flagstones

  // Faint ceremonial circles baked into the floor (world coords).
  RUNES: [
    { x: 2560 / 2, y: 1440 / 2, r: 260 },
    { x: 560,  y: 380,  r: 170 },
    { x: 2010, y: 1080, r: 190 },
  ],

  render(ctx, camera) {
    const o = camera.toScreen(0, 0);

    // Floor base
    ctx.fillStyle = '#0d0c12';
    ctx.fillRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);

    // Flagstones: deterministic per-tile tone variation (hash on indices)
    // so the floor has texture without any image assets.
    const T = this.TILE;
    const ix0 = Math.floor(camera.x / T), iy0 = Math.floor(camera.y / T);
    const ix1 = Math.ceil((camera.x + camera.w) / T);
    const iy1 = Math.ceil((camera.y + camera.h) / T);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
        const m = h % 9;
        if (m === 0)      ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        else if (m === 1) ctx.fillStyle = 'rgba(138, 43, 226, 0.028)';
        else if (m === 2) ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        else continue;
        ctx.fillRect(ix * T - camera.x, iy * T - camera.y, T, T);
      }
    }

    // Grout lines between flagstones (dark, not neon)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ix0 * T; x <= camera.x + camera.w; x += T) {
      const sx = x - camera.x;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, camera.h);
    }
    for (let y = iy0 * T; y <= camera.y + camera.h; y += T) {
      const sy = y - camera.y;
      ctx.moveTo(0, sy); ctx.lineTo(camera.w, sy);
    }
    ctx.stroke();

    // Ceremonial rune circles — double ring + tick marks, very faint.
    ctx.strokeStyle = 'rgba(138, 43, 226, 0.09)';
    for (const c of this.RUNES) {
      const s = camera.toScreen(c.x, c.y);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, c.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, c.r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      // 8 radial ticks between the rings
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.moveTo(s.x + Math.cos(a) * c.r * 0.78, s.y + Math.sin(a) * c.r * 0.78);
        ctx.lineTo(s.x + Math.cos(a) * c.r,        s.y + Math.sin(a) * c.r);
      }
      ctx.stroke();
    }

    // Boundary: heavy dark wall with a thin violet inlay + corner sigils.
    ctx.strokeStyle = '#231b30';
    ctx.lineWidth = 10;
    ctx.strokeRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);
    ctx.strokeStyle = 'rgba(138, 43, 226, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x + 6, o.y + 6, CONFIG.worldWidth - 12, CONFIG.worldHeight - 12);
    ctx.fillStyle = 'rgba(138, 43, 226, 0.7)';
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

  newWorld() {
    this.world = {
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
  }

  start() {
    this.newWorld();
    this.state = 'playing';
    Screens.hideAll(); // clear start / game-over / any leftover modal
    Hud.init();
  }

  // Fixed-timestep accumulator loop.
  frame(ts) {
    const dt = Math.min(0.25, (ts - this._last) / 1000) || 0;
    this._last = ts;
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
    w.player.update(dt, Input, w);
    w.spawner.update(dt, w);
    for (const e of w.enemies)     e.update(dt, w.player, w); // boss needs world
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
    // Victory: the final wave has fully arrived and nothing is left alive.
    // Checked before the death check so a mutual-kill frame goes to the player.
    if (w.player.alive && w.spawner.finalWaveArrived && w.enemies.length === 0) {
      this.victory();
    } else if (!w.player.alive) {
      this.gameOver();
    }
    Camera.follow(w.player);
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.world) return;

    Arena.render(ctx, Camera);

    // Pickups lie flat on the floor — always drawn under standing actors.
    for (const k of this.world.pickups) k.render(ctx, Camera);

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
    if (!this._vignette || this._vignetteKey !== `${canvas.width}x${canvas.height}`) {
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
      g.addColorStop(1, '#6f6a80');        // corners darken toward violet-grey
      this._vignette = g;
      this._vignetteKey = `${canvas.width}x${canvas.height}`;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    Hud.render(this.world);
  }

  openLevelUp() {
    this.state = 'levelup';
    LevelUp.open(Progression.rollChoices(3, this.world.player), (id) => {
      Progression.apply(this.world.player, id);
      this.state = 'playing';
    });
  }

  gameOver() { this._end(false); }

  // GGs — dragon down, field clear on the final wave.
  victory() { this._end(true); }

  _end(victory) {
    this.state = victory ? 'victory' : 'gameover';
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

  Input.init();
  Leaderboard.init(); // cache DOM + bind the save-score button once
  Menu.init();        // start-menu panels (Abilities / Leaderboard)
  const game = new Game(canvas);
  Screens.bind({ onStart: () => game.start(), onRestart: () => game.start() });
  Screens.show('start');
  requestAnimationFrame((t) => { game._last = t; game.frame(t); });
}

main();
