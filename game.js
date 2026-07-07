/*
  game.js  —  entry point + engine (merged: main + game loop + input +
  camera + math + master state machine). This is the only <script> the
  HTML loads; it imports everything else.
*/

import { CONFIG } from './config.js';
import { Player } from './player.js';
import { Spawner, Combat, Progression } from './systems.js';
import { Hud, Screens, LevelUp, Leaderboard } from './ui.js';

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

// Arena: floor, grid, and boundary walls -----------------------------
const Arena = {
  GRID: 80,
  render(ctx, camera) {
    // Floor
    const o = camera.toScreen(0, 0);
    ctx.fillStyle = '#101018';
    ctx.fillRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);

    // Grid lines — only draw the ones in view for cheapness.
    ctx.strokeStyle = 'rgba(138, 43, 226, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(camera.x / this.GRID) * this.GRID;
    const startY = Math.floor(camera.y / this.GRID) * this.GRID;
    for (let x = startX; x <= camera.x + camera.w; x += this.GRID) {
      const sx = x - camera.x;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, camera.h);
    }
    for (let y = startY; y <= camera.y + camera.h; y += this.GRID) {
      const sy = y - camera.y;
      ctx.moveTo(0, sy); ctx.lineTo(camera.w, sy);
    }
    ctx.stroke();

    // Boundary walls
    ctx.strokeStyle = '#8a2be2';
    ctx.lineWidth = 4;
    ctx.strokeRect(o.x, o.y, CONFIG.worldWidth, CONFIG.worldHeight);
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
    for (const e of w.enemies)     e.update(dt, w.player);
    for (const p of w.projectiles) p.update(dt);
    for (const k of w.pickups)     k.update(dt, w.player);
    Combat.resolve(w); // may push new floaters on hit
    for (const f of w.floaters)    f.update(dt);

    // Cull the dead so arrays don't grow unbounded.
    w.enemies = w.enemies.filter((e) => e.alive);
    w.projectiles = w.projectiles.filter((p) => p.alive);
    w.pickups = w.pickups.filter((k) => k.alive);
    w.floaters = w.floaters.filter((f) => f.alive);

    if (Progression.checkLevelUp(w.player)) this.openLevelUp();
    if (!w.player.alive) this.gameOver();
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

    // Damage numbers sit above everything in the world.
    for (const f of this.world.floaters) f.render(ctx, Camera);

    Hud.render(this.world);
  }

  openLevelUp() {
    this.state = 'levelup';
    LevelUp.open(Progression.rollChoices(3, this.world.player), (id) => {
      Progression.apply(this.world.player, id);
      this.state = 'playing';
    });
  }

  gameOver() {
    this.state = 'gameover';
    const w = this.world;
    const stats = {
      score: (w.kills * 10 + Math.floor(w.time)) * 0.5*w.player.level,
      wave: w.spawner.wave,
      time: w.time,
      kills: w.kills,
    };
    Screens.show('gameover');
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
  const game = new Game(canvas);
  Screens.bind({ onStart: () => game.start(), onRestart: () => game.start() });
  Screens.show('start');
  requestAnimationFrame((t) => { game._last = t; game.frame(t); });
}

main();
