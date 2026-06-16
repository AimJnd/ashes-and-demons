/*
  player.js
  The player entity — pulled into its own file because it carries the
  most logic and will keep growing.
  Responsibilities:
    - Movement from input state (read each update tick).
    - Health / damage / death.
    - XP accumulation + level state (progression.js decides WHEN to level;
      player just holds the numbers).
    - A mutable `stats` block seeded from CONFIG.player; upgrades mutate it.
    - Auto-firing weapon (emits projectiles via a callback/queue).
    - Pickup collection radius.
*/

import { CONFIG } from './config.js';
import { Entity, Projectile } from './entities.js';

// Body radius used for drawing/collision (pickupRadius is much larger and
// only governs gem attraction, so we keep a separate visual radius).
const PLAYER_RADIUS = 16;

export class Player extends Entity {
  constructor(x, y) {
    super(x, y, PLAYER_RADIUS);
    // Clone base stats so upgrades never mutate the shared CONFIG object.
    this.stats = { ...CONFIG.player };
    this.health = this.stats.maxHealth;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 0;       // set by progression on init
    this._fireCooldown = 0;
    this._hurtCd = 0;        // i-frame timer after taking contact damage
    this.facing = 0;         // radians, last movement direction
    this.flip = false;       // billboard faces left when true
  }

  update(dt, input, world) {
    // --- Movement: read queryable key state, build a direction vector ----
    let dx = 0, dy = 0;
    const k = input.keys;
    if (k.has('KeyW') || k.has('ArrowUp'))    dy -= 1;
    if (k.has('KeyS') || k.has('ArrowDown'))  dy += 1;
    if (k.has('KeyA') || k.has('ArrowLeft'))  dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      // Normalize so diagonals aren't faster than cardinals.
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      this.facing = Math.atan2(dy, dx);
      if (dx < 0) this.flip = true;
      else if (dx > 0) this.flip = false;
      this.x += dx * this.stats.speed * dt;
      this.y += dy * this.stats.speed * dt;
    }

    // Clamp to arena bounds (keep the body fully inside the walls).
    const r = this.radius;
    this.x = Math.max(r, Math.min(CONFIG.worldWidth - r, this.x));
    this.y = Math.max(r, Math.min(CONFIG.worldHeight - r, this.y));

    // Tick down the post-hit invulnerability window.
    if (this._hurtCd > 0) this._hurtCd -= dt;

    // Auto-fire at the nearest enemy on the fire-rate cadence.
    this._fireCooldown -= dt;
    if (this._fireCooldown <= 0) {
      const target = this._nearestEnemy(world);
      if (target) {
        this._fireCooldown = 1 / this.stats.fireRate;
        const ang = Math.atan2(target.y - this.y, target.x - this.x);
        const sp = this.stats.projectileSpeed;
        world.projectiles.push(new Projectile(
          this.x, this.y,
          Math.cos(ang) * sp, Math.sin(ang) * sp,
          this.stats.damage, this.stats.pierce || 0
        ));
      }
    }
    // (leveling is owned by systems.js, not here)
  }

  _nearestEnemy(world) {
    let best = null;
    let bestD = Infinity;
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  gainXp(amount) {
    this.xp += amount;
    // progression.checkLevelUp consumes against xpToNext.
  }

  render(ctx, camera) {
    // (x, y) is the character's FEET / ground position. The body is drawn
    // standing upright from there (billboard), with a shadow on the floor.
    // This is what gives the Vampire-Survivors angled look on a flat plane.
    const s = camera.toScreen(this.x, this.y);
    const r = this.radius;
    const bodyH = r * 2.4;   // how tall the upright sprite stands
    const bodyW = r * 1.5;

    // Ground shadow (flattened ellipse at the feet)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Upright body (capsule) rising from the feet
    const topY = s.y - bodyH;
    ctx.fillStyle = '#e8e8ef';
    ctx.strokeStyle = '#8a2be2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(s.x - bodyW / 2, topY, bodyW, bodyH, bodyW / 2);
    ctx.fill();
    ctx.stroke();

    // Simple face (two eyes) on the side it's facing, for character feel
    const eyeY = topY + bodyH * 0.32;
    const dir = this.flip ? -1 : 1;
    ctx.fillStyle = '#2d2d3a';
    for (const ox of [-bodyW * 0.18, bodyW * 0.18]) {
      ctx.beginPath();
      ctx.arc(s.x + ox + dir * bodyW * 0.08, eyeY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
