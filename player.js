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
    - Holds ONE equipped weapon (weapons.js) and delegates attacking to it.
      Starts ranged; the rare Spirit Blade upgrade swaps it for melee.
    - Pickup collection radius.
*/

import { CONFIG } from './config.js';
import { Entity } from './entities.js';
import { RangedWeapon, createWeapon, NovaPassive } from './weapons.js';

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
    this.weapon = new RangedWeapon(); // game starts with the og shooting
    this.nova = new NovaPassive();    // dormant until the Holy Nova upgrade
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

    // Attack: fully owned by the equipped weapon (weapons.js).
    this.weapon.update(dt, this, world);
    this.nova.update(dt, this, world); // epic passive (no-op until unlocked)
    // (leveling is owned by systems.js, not here)
  }

  // Swap the equipped weapon by id ('ranged' | 'melee'). Used by upgrades.
  setWeapon(id) {
    this.weapon = createWeapon(id);
  }

  hasWeapon(id) {
    return this.weapon.id === id;
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

    // Chrono Field: translucent time-bubble on the floor, under everything.
    if (this.stats.chrono) {
      const cr = CONFIG.weapons.chrono.radius;
      ctx.save();
      const grad = ctx.createRadialGradient(s.x, s.y, cr * 0.35, s.x, s.y, cr);
      grad.addColorStop(0, 'rgba(120, 200, 255, 0.03)');
      grad.addColorStop(1, 'rgba(120, 200, 255, 0.12)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, cr, 0, Math.PI * 2);
      ctx.fill();
      // Slowly rotating dashed rim sells the "field" without being loud.
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = (performance.now() / 40) % 24;
      ctx.beginPath();
      ctx.arc(s.x, s.y, cr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

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
