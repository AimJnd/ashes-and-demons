/*
  entities.js  (merged: Entity base + Enemy + Projectile + Pickup)
  The player lives in player.js; everything else that moves lives here.
  Each class extends Entity and implements update(dt, ...) + render(ctx, camera).
*/

import { CONFIG, ENEMIES } from './config.js';

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
    // Per-instance animation offset so a crowd doesn't move in lockstep.
    this._phase = Math.random() * Math.PI * 2;
  }

  // Trigger the subtle on-hit flash. Called by Combat when struck.
  flash() { this._hitFlash = ENEMY_FLASH; }

  update(dt, player) {
    // behavior switch — only 'chase' for now: move straight at the player.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    // Chrono Field: enemies inside the player's aura move at a fraction of
    // their speed. Computed per-frame — base speed is never mutated.
    let speed = this.speed;
    if (player.stats.chrono && d <= CONFIG.weapons.chrono.radius) {
      speed *= CONFIG.weapons.chrono.slowMul;
    }

    this.x += (dx / d) * speed * dt;
    this.y += (dy / d) * speed * dt;
    if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  // Character art (iterated visually against rendered previews).
  // Each type: cel-shaded gradient body, colored rim line, glowing eyes.
  // The main silhouette Path2D is kept so the on-hit flash can refill
  // the exact same shape in white.
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000 + this._phase;
    let body;
    switch (this.type) {
      case 'brute': body = this._renderBrute(ctx, s, t); break;
      case 'swarm': body = this._renderSwarm(ctx, s, t); break;
      default:      body = this._renderShade(ctx, s, t); break;
    }
    if (this._hitFlash > 0 && body) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / ENEMY_FLASH) * 0.7;
      ctx.fillStyle = '#fff';
      ctx.fill(body);
      ctx.restore();
    }
  }

  _shadow(ctx, s, w, alpha = 0.35) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, w, w * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _vgrad(ctx, x, y0, y1, c0, c1) {
    const g = ctx.createLinearGradient(x, y0, x, y1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  }

  _glowDot(ctx, x, y, r, color, blur = 8) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Shade: gothic wraith — curled drooping hood with a wisp-light at the
  // tip, flowing skirt dissolving into ragged streamers, slanted eyes.
  _renderShade(ctx, s, t) {
    const r = this.radius;
    const hover = Math.sin(t * 2.6) * 3;
    const h = r * 3.0, w = r * 2.2;
    const bot = s.y - 6 - hover, top = bot - h;
    const drift = Math.sin(t * 1.3) * r * 0.1;

    this._shadow(ctx, s, r * 0.7, 0.2);

    const p = new Path2D();
    const tipx = s.x + drift - r * 0.55, tipy = top - r * 0.30;
    p.moveTo(tipx, tipy);
    p.quadraticCurveTo(s.x + drift + r * 0.75, top - r * 0.15,
                       s.x + w * 0.26, top + h * 0.28);
    p.quadraticCurveTo(s.x + w * 0.60, top + h * 0.72, s.x + w * 0.44, bot - r * 0.15);
    // Ragged hem: streamers of uneven length, right to left.
    const frays = [
      [ 0.30, 0.55, 0.15], [ 0.10, 0.05, 0.42],
      [-0.10, 0.65, 0.20], [-0.30, 0.15, 0.48],
    ];
    let px = 0.44;
    for (const [fx, drop, rise] of frays) {
      const wob = Math.sin(t * 3.5 + fx * 9) * 1.8;
      p.quadraticCurveTo(s.x + w * (px + fx) / 2, bot - r * rise,
                         s.x + w * fx, bot + r * drop + wob);
      px = fx;
    }
    p.quadraticCurveTo(s.x - w * 0.40, bot - r * 0.3, s.x - w * 0.44, bot - r * 0.35);
    p.quadraticCurveTo(s.x - w * 0.58, top + h * 0.70, s.x - w * 0.24, top + h * 0.30);
    p.quadraticCurveTo(s.x + drift - r * 0.9, top + r * 0.35, tipx, tipy);
    p.closePath();

    ctx.fillStyle = this._vgrad(ctx, s.x, top, bot, '#3b2f5e', '#171126');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(140, 124, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke(p);

    // Wisp-light at the hood tip
    this._glowDot(ctx, tipx, tipy + 1, 1.6, '#8c7cff', 6);

    // Face void
    ctx.fillStyle = '#0a0714';
    ctx.beginPath();
    ctx.ellipse(s.x + drift * 0.5 + r * 0.06, top + h * 0.30,
                w * 0.22, h * 0.15, drift * 0.02, 0, Math.PI * 2);
    ctx.fill();

    // Slanted glowing eyes (rotated slivers)
    ctx.save();
    ctx.fillStyle = '#b7a8ff';
    ctx.shadowColor = '#b7a8ff';
    ctx.shadowBlur = 8;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + drift * 0.5 + d * r * 0.28 + r * 0.06, top + h * 0.29,
                  2.6, 1.1, d * -0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return p;
  }

  // Brute: horned crimson bruiser — gorilla stance with ground fists,
  // bone horns, under-bite fangs and a molten crack down the chest.
  _renderBrute(ctx, s, t) {
    const r = this.radius;
    const w = r * 2.5, h = r * 2.4;
    const breathe = Math.sin(t * 1.8) * r * 0.04;
    const top = s.y - h - breathe;

    this._shadow(ctx, s, r * 1.3);

    const p = new Path2D();
    p.moveTo(s.x - w * 0.46, s.y);
    p.quadraticCurveTo(s.x - w * 0.56, s.y - h * 0.45, s.x - w * 0.42, top + h * 0.22);
    p.quadraticCurveTo(s.x - w * 0.30, top - r * 0.10, s.x, top + r * 0.06);
    p.quadraticCurveTo(s.x + w * 0.30, top - r * 0.10, s.x + w * 0.42, top + h * 0.22);
    p.quadraticCurveTo(s.x + w * 0.56, s.y - h * 0.45, s.x + w * 0.46, s.y);
    p.lineTo(s.x + w * 0.24, s.y);
    p.quadraticCurveTo(s.x + w * 0.30, s.y - h * 0.34, s.x + w * 0.16, s.y - h * 0.30);
    p.quadraticCurveTo(s.x, s.y - h * 0.20, s.x - w * 0.16, s.y - h * 0.30);
    p.quadraticCurveTo(s.x - w * 0.30, s.y - h * 0.34, s.x - w * 0.24, s.y);
    p.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#4a1c20', '#200d12');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(220, 80, 60, 0.65)';
    ctx.lineWidth = 2;
    ctx.stroke(p);

    // Knuckle pads on the fists
    for (const dx of [-w * 0.35, w * 0.35]) {
      ctx.fillStyle = '#57262b';
      ctx.beginPath();
      ctx.ellipse(s.x + dx, s.y - r * 0.18, r * 0.30, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220, 80, 60, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Head sunk in the shoulder dip
    const hy = top + r * 0.34;
    ctx.fillStyle = '#2a1015';
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.52, hy - r * 0.30);
    ctx.quadraticCurveTo(s.x, hy - r * 0.62, s.x + r * 0.52, hy - r * 0.30);
    ctx.lineTo(s.x + r * 0.58, hy + r * 0.34);
    ctx.quadraticCurveTo(s.x, hy + r * 0.62, s.x - r * 0.58, hy + r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 80, 60, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bone horns curving from the temples
    for (const d of [-1, 1]) {
      const bx = s.x + d * r * 0.62, by = hy - r * 0.22;
      const horn = new Path2D();
      horn.moveTo(bx, by + r * 0.12);
      horn.quadraticCurveTo(bx + d * r * 0.62, by - r * 0.28, bx + d * r * 0.40, by - r * 0.95);
      horn.quadraticCurveTo(bx + d * r * 0.28, by - r * 0.52, bx - d * r * 0.05, by - r * 0.14);
      horn.closePath();
      ctx.fillStyle = '#d9c9b6';
      ctx.fill(horn);
      ctx.strokeStyle = '#3a241c';
      ctx.lineWidth = 1.5;
      ctx.stroke(horn);
    }

    // Eyes + under-bite fangs
    this._glowDot(ctx, s.x - r * 0.24, hy - r * 0.02, 2.6, '#ff7a5c', 9);
    this._glowDot(ctx, s.x + r * 0.24, hy - r * 0.02, 2.6, '#ff7a5c', 9);
    ctx.fillStyle = '#e8ddd0';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 0.30, hy + r * 0.44);
      ctx.lineTo(s.x + d * r * 0.20, hy + r * 0.16);
      ctx.lineTo(s.x + d * r * 0.10, hy + r * 0.44);
      ctx.closePath();
      ctx.fill();
    }

    // Molten crack down the chest (pulsing)
    ctx.save();
    ctx.strokeStyle = '#ff5a3c';
    ctx.shadowColor = '#ff5a3c';
    ctx.shadowBlur = 7;
    ctx.globalAlpha = 0.7 + Math.sin(t * 5) * 0.2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.06, hy + r * 0.7);
    ctx.lineTo(s.x + r * 0.12, s.y - h * 0.52);
    ctx.lineTo(s.x - r * 0.10, s.y - h * 0.40);
    ctx.lineTo(s.x + r * 0.06, s.y - h * 0.27);
    ctx.stroke();
    ctx.restore();
    return p;
  }

  // Swarm: teal bat imp — round body, scalloped membrane wings beating
  // fast, one big glossy cyclops eye and a fanged grin.
  _renderSwarm(ctx, s, t) {
    const r = this.radius;
    const bob = Math.sin(t * 10) * 2.5;
    const cy = s.y - r * 2.1 + bob;
    const flap = (Math.sin(t * 16) + 1) / 2;

    this._shadow(ctx, s, r * 0.65, 0.2);

    for (const d of [-1, 1]) {
      const shx = s.x + d * r * 0.55, shy = cy - r * 0.15;
      const tipx = shx + d * r * (1.6 + flap * 0.5);
      const tipy = shy - r * (1.3 * flap + 0.15);
      const wing = new Path2D();
      wing.moveTo(shx, shy);
      wing.quadraticCurveTo(shx + d * r * 0.9, shy - r * (1.2 * flap + 0.3), tipx, tipy);
      wing.quadraticCurveTo(tipx - d * r * 0.25, tipy + r * 0.75, shx + d * r * 1.05, shy + r * 0.28);
      wing.quadraticCurveTo(shx + d * r * 0.8,  shy + r * 0.05,  shx + d * r * 0.55, shy + r * 0.42);
      wing.quadraticCurveTo(shx + d * r * 0.25, shy + r * 0.2,   shx, shy + r * 0.3);
      wing.closePath();
      ctx.fillStyle = this._vgrad(ctx, shx, tipy, shy + r * 0.4, '#14494b', '#0a2426');
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(0, 206, 201, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke(wing);
    }

    // Body
    const body = new Path2D();
    body.arc(s.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = this._vgrad(ctx, s.x, cy - r, cy + r, '#17595c', '#0b2a2c');
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(0, 206, 201, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke(body);

    // Tiny horns
    ctx.fillStyle = '#0b2a2c';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 0.45, cy - r * 0.8);
      ctx.lineTo(s.x + d * r * 0.62, cy - r * 1.3);
      ctx.lineTo(s.x + d * r * 0.18, cy - r * 0.94);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 206, 201, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Big glossy cyclops eye
    ctx.fillStyle = '#04100f';
    ctx.beginPath(); ctx.arc(s.x, cy - r * 0.05, r * 0.52, 0, Math.PI * 2); ctx.fill();
    this._glowDot(ctx, s.x, cy - r * 0.05, r * 0.34, '#5ff7ef', 7);
    ctx.fillStyle = '#031312';
    ctx.beginPath(); ctx.arc(s.x + r * 0.08, cy - r * 0.02, r * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath(); ctx.arc(s.x - r * 0.10, cy - r * 0.18, r * 0.08, 0, Math.PI * 2); ctx.fill();

    // Grin fangs
    ctx.fillStyle = '#dff7f5';
    for (const d of [-0.28, 0.12]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 2 - r * 0.09, cy + r * 0.45);
      ctx.lineTo(s.x + d * r * 2,            cy + r * 0.72);
      ctx.lineTo(s.x + d * r * 2 + r * 0.09, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    return body;
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
  // Crimson talisman shard: an elongated diamond aligned to its velocity
  // with a fading trail — reads as directed intent, not a floating dot.
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const ang = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(ang);
    // Trail
    ctx.strokeStyle = 'rgba(255, 59, 92, 0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-6, 0);
    ctx.stroke();
    // Shard body
    ctx.fillStyle = '#fff0f3';
    ctx.shadowColor = '#ff3b5c';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-7, 0);
    ctx.lineTo(0, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
    const r = this.radius;
    // Cheap per-pickup phase from world position (no stored state needed).
    const t = performance.now() / 1000 + (this.x * 0.13 + this.y * 0.07);

    if (this.kind === 'xp') {
      // Soul flame: a pale-cyan teardrop that flickers and breathes.
      const fl = 1 + Math.sin(t * 9) * 0.18;
      ctx.save();
      ctx.fillStyle = '#7de8ff';
      ctx.shadowColor = '#00c8ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r * 1.7 * fl);                 // flame tip
      ctx.quadraticCurveTo(s.x + r, s.y - r * 0.4, s.x, s.y + r * 0.6);
      ctx.quadraticCurveTo(s.x - r, s.y - r * 0.4, s.x, s.y - r * 1.7 * fl);
      ctx.fill();
      // Hot core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y - r * 0.15, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Health: glowing crimson cross (gothic reliquary vibes).
      const a = r * 0.75, b = r * 1.9;
      ctx.save();
      ctx.fillStyle = '#ff5d6c';
      ctx.shadowColor = '#ff2440';
      ctx.shadowBlur = 7 + Math.sin(t * 5) * 2;
      ctx.beginPath();
      ctx.roundRect(s.x - a / 2, s.y - b / 2, a, b, 2);
      ctx.roundRect(s.x - b / 2, s.y - a / 2, b, a, 2);
      ctx.fill();
      ctx.restore();
    }
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
