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

    this.moving = (dx !== 0 || dy !== 0); // drives the walk-bob animation
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
      // No fill — a filled disk this large reads as a hole in the floor.
      // Two slowly counter-rotating dashed rims sell the "field" instead.
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = (performance.now() / 40) % 24;
      ctx.beginPath();
      ctx.arc(s.x, s.y, cr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 10]);
      ctx.lineDashOffset = -(performance.now() / 55) % 14;
      ctx.beginPath();
      ctx.arc(s.x, s.y, cr * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- The exorcist: fitted coat with a cinched waist and flaring
    // --- skirt, swept-back pale hair, ribbon scarf, glowing amulet.
    // --- (Design iterated against rendered previews.)
    const t = performance.now() / 1000;
    const dir = this.flip ? -1 : 1;
    const bob = this.moving ? Math.sin(t * 9) * 1.8 : Math.sin(t * 2) * 0.8;
    const sway = this.moving ? Math.sin(t * 9 + Math.PI / 2) * 1.4 : 0;
    const H = r * 2.7;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 0.95, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    const topY = s.y - H + bob;
    const headR = r * 0.5;
    const headY = topY + headR + r * 0.30;
    const neckY = headY + headR * 0.95;
    const shW = r * 1.15;

    const vgrad = (y0, y1, c0, c1) => {
      const g = ctx.createLinearGradient(s.x, y0, s.x, y1);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      return g;
    };

    // Ribbon scarf: tapered filled shape with a forked, fluttering tail.
    const flut = Math.sin(t * 6) * 2.5 + (this.moving ? Math.sin(t * 13) * 1.8 : 0);
    const s0x = s.x - dir * r * 0.2, s0y = neckY - r * 0.05;
    const endx = s.x - dir * r * 2.0, endy = neckY + r * 0.15 + flut;
    const scarf = new Path2D();
    scarf.moveTo(s0x, s0y - r * 0.18);
    scarf.quadraticCurveTo(s.x - dir * r * 1.05, s0y - r * 0.1 + flut * 0.35, endx, endy - r * 0.05);
    scarf.lineTo(endx + dir * r * 0.5, endy + r * 0.16);
    scarf.lineTo(endx - dir * r * 0.12, endy + r * 0.42 + flut * 0.2);
    scarf.quadraticCurveTo(s.x - dir * r * 1.0, s0y + r * 0.42 + flut * 0.3, s0x, s0y + r * 0.24);
    scarf.closePath();
    ctx.fillStyle = '#b32738';
    ctx.fill(scarf);
    ctx.strokeStyle = '#6e1220';
    ctx.lineWidth = 1.2;
    ctx.stroke(scarf);

    // Coat: fitted shoulders, cinched waist, long flaring notched skirt.
    const coat = new Path2D();
    coat.moveTo(s.x - shW * 0.52, neckY);
    coat.quadraticCurveTo(s.x - shW * 0.60, neckY + r * 0.85,
                          s.x - shW * 0.42, s.y - H * 0.42);
    coat.quadraticCurveTo(s.x - shW * 0.95 - sway, s.y - r * 0.55,
                          s.x - shW * 1.05 - sway, s.y - 2);
    coat.lineTo(s.x - shW * 0.30, s.y - r * 0.50);
    coat.lineTo(s.x + shW * 0.05, s.y - 2);
    coat.lineTo(s.x + shW * 0.45, s.y - r * 0.35);
    coat.lineTo(s.x + shW * 0.90 + sway, s.y - 2);
    coat.quadraticCurveTo(s.x + shW * 0.70, s.y - H * 0.40,
                          s.x + shW * 0.44, s.y - H * 0.62);
    coat.quadraticCurveTo(s.x + shW * 0.58, neckY + r * 0.6,
                          s.x + shW * 0.52, neckY);
    coat.closePath();
    ctx.fillStyle = vgrad(topY, s.y, '#2e2a3d', '#161320');
    ctx.fill(coat);
    ctx.strokeStyle = 'rgba(214, 206, 236, 0.9)';
    ctx.lineWidth = 1.7;
    ctx.stroke(coat);

    // Cel shadow on the off side + a hint of the facing-side sleeve.
    ctx.save();
    ctx.clip(coat);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.fillRect(s.x - dir * shW * 2, topY, shW * 2, H + 4);
    ctx.strokeStyle = 'rgba(214, 206, 236, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(s.x + dir * shW * 0.40, neckY + r * 0.35);
    ctx.quadraticCurveTo(s.x + dir * shW * 0.52, s.y - H * 0.45,
                         s.x + dir * shW * 0.34, s.y - H * 0.22);
    ctx.stroke();
    ctx.restore();

    // Belt sash at the waist
    ctx.strokeStyle = '#8a2be2';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(s.x - shW * 0.42, s.y - H * 0.44);
    ctx.quadraticCurveTo(s.x, s.y - H * 0.38, s.x + shW * 0.44, s.y - H * 0.46);
    ctx.stroke();

    // Amulet on a cord
    ctx.strokeStyle = 'rgba(214, 206, 236, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.18, neckY + r * 0.06);
    ctx.lineTo(s.x, neckY + r * 0.48);
    ctx.lineTo(s.x + r * 0.18, neckY + r * 0.06);
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = '#a45cff';
    ctx.shadowColor = '#a45cff';
    ctx.shadowBlur = 8 + Math.sin(t * 4) * 3;
    ctx.beginPath();
    ctx.arc(s.x, neckY + r * 0.55, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Scarf knot at the neck
    ctx.fillStyle = '#c9314a';
    ctx.beginPath();
    ctx.ellipse(s.x, neckY - r * 0.02, r * 0.42, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6e1220';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Head
    ctx.fillStyle = '#efe9f0';
    ctx.beginPath();
    ctx.arc(s.x, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Hair: swept-back sharp spikes, hairline high so the face reads.
    const hair = new Path2D();
    hair.moveTo(s.x + dir * headR * 0.98, headY - headR * 0.30);
    hair.quadraticCurveTo(s.x + dir * headR * 0.30, headY - headR * 1.10,
                          s.x - dir * headR * 0.20, headY - headR * 0.95);
    hair.lineTo(s.x - dir * headR * 0.42, headY - headR * 1.45);
    hair.lineTo(s.x - dir * headR * 0.78, headY - headR * 0.70);
    hair.lineTo(s.x - dir * headR * 1.45, headY - headR * 0.92);
    hair.lineTo(s.x - dir * headR * 1.05, headY - headR * 0.22);
    hair.lineTo(s.x - dir * headR * 1.72, headY - headR * 0.02);
    hair.lineTo(s.x - dir * headR * 0.92, headY + headR * 0.38);
    hair.quadraticCurveTo(s.x - dir * headR * 0.35, headY - headR * 0.28,
                          s.x + dir * headR * 0.98, headY - headR * 0.30);
    hair.closePath();
    ctx.fillStyle = '#d6cfec';
    ctx.fill(hair);
    ctx.strokeStyle = '#8f86b8';
    ctx.lineWidth = 1.2;
    ctx.stroke(hair);

    // Eyes: sharp ticks with thin slanted brows above.
    ctx.strokeStyle = '#2f2b3e';
    ctx.lineCap = 'round';
    const eyeY = headY + headR * 0.14;
    for (const d of [-1, 1]) {
      const ex = s.x + d * headR * 0.34 + dir * headR * 0.14;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex, eyeY - 1.4);
      ctx.lineTo(ex + d * 0.6, eyeY + 1.2);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(ex - d * 1.8, eyeY - 3.4);
      ctx.lineTo(ex + d * 1.4, eyeY - 4.4);
      ctx.stroke();
    }
  }
}
