/*
  entities.js  (merged: Entity base + Enemy + Projectile + Pickup)
  The player lives in player.js; everything else that moves lives here.
  Each class extends Entity and implements update(dt, ...) + render(ctx, camera).
*/

import { ENEMIES } from './config.js';

// Base ---------------------------------------------------------------
export class Entity {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.alive = true;
  }
  update(dt) { /* override */ }
  render(ctx, camera) { /* override */ }
}

// How long an enemy stays tinted white after being struck (seconds).
const ENEMY_FLASH = 0.08;

// Enemy --------------------------------------------------------------
export class Enemy extends Entity {
  constructor(x, y, typeKey) {
    const def = ENEMIES[typeKey];
    super(x, y, def.radius);
    this.type = typeKey;
    this.def = def;
    // Stats copied onto the instance so the spawner can scale them per wave
    // without touching the shared ENEMIES definition.
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.speed = def.speed;
    this.damage = def.damage;
    this.xp = def.xp;
    this.flip = false;
    this._hitFlash = 0; // counts down after a hit; drives the white tint
  }

  // Trigger the subtle on-hit flash. Called by Combat when struck.
  flash() { this._hitFlash = ENEMY_FLASH; }

  update(dt, player) {
    // behavior switch — only 'chase' for now: move straight at the player.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.x += (dx / d) * this.speed * dt;
    this.y += (dy / d) * this.speed * dt;
    if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const r = this.radius;
    const bodyH = r * 2.2;
    const bodyW = r * 1.6;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Upright body
    const topY = s.y - bodyH;
    ctx.fillStyle = this.def.color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(s.x - bodyW / 2, topY, bodyW, bodyH, bodyW / 2);
    ctx.fill();
    ctx.stroke();

    // On-hit flash: fade a white tint over the body for a couple frames.
    if (this._hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / ENEMY_FLASH) * 0.6; // subtle, fading
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(s.x - bodyW / 2, topY, bodyW, bodyH, bodyW / 2);
      ctx.fill();
      ctx.restore();
    }

    // Glowing eyes
    ctx.fillStyle = '#fff';
    const eyeY = topY + bodyH * 0.3;
    for (const ox of [-bodyW * 0.2, bodyW * 0.2]) {
      ctx.beginPath();
      ctx.arc(s.x + ox, eyeY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Projectile ---------------------------------------------------------
export class Projectile extends Entity {
  constructor(x, y, vx, vy, damage, pierce = 0) {
    super(x, y, 5);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;
    this.life = 2; // seconds before despawn
    this._hit = new Set(); // enemies already struck (for piercing shots)
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    ctx.fillStyle = '#ffe66d';
    ctx.shadowColor = '#ffe66d';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// Pickup (XP gems, drops) -------------------------------------------
export class Pickup extends Entity {
  constructor(x, y, kind, value) {
    super(x, y, 6);
    this.kind = kind;   // 'xp' | 'health' | ...
    this.value = value;
  }
  update(dt, player) {
    // Magnet: drift toward the player once inside their pickup radius.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < player.stats.pickupRadius) {
      const pull = 320;
      this.x += (dx / d) * pull * dt;
      this.y += (dy / d) * pull * dt;
    }
  }
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    ctx.fillStyle = this.kind === 'xp' ? '#00e5ff' : '#7CFC00';
    ctx.beginPath();
    // Little diamond gem
    ctx.moveTo(s.x, s.y - this.radius);
    ctx.lineTo(s.x + this.radius, s.y);
    ctx.lineTo(s.x, s.y + this.radius);
    ctx.lineTo(s.x - this.radius, s.y);
    ctx.closePath();
    ctx.fill();
  }
}

// FloatingText (damage numbers, etc.) --------------------------------
// Pure VFX: a short-lived label that drifts up from a world point and
// fades out. No collision, no gameplay effect — game.js ticks it and
// culls it like any other entity, and renders it above everyone.
export class FloatingText {
  constructor(x, y, text, opts = {}) {
    this.x = x;
    this.y = y;
    this.text = String(text);
    this.color = opts.color ?? '#ffe66d';
    this.size = opts.size ?? 16;
    this.maxLife = opts.life ?? 0.7;
    this.life = this.maxLife;
    // Pop upward then ease off; small sideways scatter so stacked hits
    // on one enemy don't perfectly overlap.
    this.vy = opts.vy ?? -70;
    this.vx = opts.vx ?? (Math.random() * 28 - 14);
    this.alive = true;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 90 * dt; // gravity: rise decelerates, giving a little arc
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = this.life / this.maxLife;          // 1 -> 0 over lifetime
    const scale = 1 + (1 - t) * 0.15;            // slight grow as it fades
    ctx.save();
    ctx.globalAlpha = Math.max(0, t);
    ctx.font = `bold ${this.size * scale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Outline for legibility against any background.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(this.text, s.x, s.y);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, s.x, s.y);
    ctx.restore();
  }
}
