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

import { CONFIG, Settings, TILE, isTrapTile } from './config.js';
import { Entity, FloatingText } from './entities.js';
import { RangedWeapon, createWeapon, NovaPassive, BoomerangPassive } from './weapons.js';

// Body radius used for drawing/collision (pickupRadius is much larger and
// only governs gem attraction, so we keep a separate visual radius).
const PLAYER_RADIUS = 16;

// Pixel sprite (matches "player design.jpg", which is a pixel-art sheet):
// 12x19 cells drawn facing right, mirrored via `flip`. '.' = transparent.
const PAL = {
  H: '#1b2233', // hair (black-navy)
  S: '#e9ddd2', // skin
  E: '#6fe0ff', // eyes / amulet gem (redrawn with a glow pass)
  M: '#223046', // face mask
  C: '#262f4a', // coat
  L: '#39486d', // sleeve highlight
  B: '#3f6fd0', // belt
  K: '#141b2e', // cape (trails behind)
  P: '#1a2135', // pants
  O: '#0d1320', // boots
};
const SPRITE_TORSO = [
  '....HHHH....',
  '..HHHHHHHH..',
  '..HHHHHHHH..',
  '.H.HHHHHH...',
  '...HSSSSH...',
  '...SESSES...',
  '...MMMMMM...',
  '....MMMM....',
  '.K.CCECCC...',
  '.KKCCCCCCC..',
  'KKLCCCCCCL..',
  'KKLCCBBCCL..',
  '.KKCCCCCC...',
  '.KCCCCCCC...',
];
const LEGS_STAND = [
  '...PP..PP...',
  '...PP..PP...',
  '...PP..PP...',
  '...OO..OO...',
  '..OOO..OOO..',
];
const LEGS_STEP = [
  '...PP..PP...',
  '..PP....PP..',
  '..PP....PP..',
  '..OO....OO..',
  '.OOO....OOO.',
];

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
    this.boomerang = new BoomerangPassive(); // dormant until the altar relic
    this.acquired = {};      // upgradeId -> times picked (pause menu reads this)
    this._hurtCd = 0;        // i-frame timer after taking contact damage
    this.facing = 0;         // radians, last movement direction
    this.flip = false;       // billboard faces left when true
  }

  update(dt, input, world) {
    // --- Movement: touch joystick, else keys OR mouse (Settings) ---------
    let dx = 0, dy = 0;
    const joy = input.joyVec?.();
    if (joy) {
      dx = joy.x; dy = joy.y;
    } else if (Settings.controls === 'mouse') {
      // Walk toward the cursor; deadzone so we don't jitter on arrival.
      const mx = input.mouseWorldX - this.x;
      const my = input.mouseWorldY - this.y;
      if (Math.hypot(mx, my) > this.radius * 0.5) { dx = mx; dy = my; }
    } else {
      const k = input.keys;
      if (k.has('KeyW') || k.has('ArrowUp'))    dy -= 1;
      if (k.has('KeyS') || k.has('ArrowDown'))  dy += 1;
      if (k.has('KeyA') || k.has('ArrowLeft'))  dx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    }

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

    // Spike traps: linger past the grace period and they bite, then keep
    // ticking until you step off. Separate from _hurtCd — traps punish
    // camping, so enemy-hit i-frames shouldn't mask them.
    const trap = CONFIG.trap;
    if (isTrapTile(Math.floor(this.x / TILE), Math.floor(this.y / TILE))) {
      this._trapT = (this._trapT || 0) + dt;
      if (this._trapT >= trap.grace) {
        this._trapTick = (this._trapTick ?? 0) - dt;
        if (this._trapTick <= 0) {
          this.takeDamage(trap.damage);
          world.floaters?.push(
            new FloatingText(this.x, this.y - this.radius * 1.6,
              trap.damage, { color: '#c9b8ff' })
          );
          this._trapTick = trap.interval;
        }
      }
    } else {
      this._trapT = 0;
      this._trapTick = 0;
    }

    // Attack: fully owned by the equipped weapon (weapons.js).
    this.weapon.update(dt, this, world);
    this.nova.update(dt, this, world); // epic passive (no-op until unlocked)
    this.boomerang.update(dt, this, world); // altar relic (no-op until claimed)
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

    // --- Kaelen Thorne (see "player design.jpg"): pixel-sprite humanoid —
    // --- spiky hair, glowing eyes over a mask, coat, cape, belt, two legs.
    const t = performance.now() / 1000;
    const dir = this.flip ? -1 : 1;
    const bob = this.moving ? Math.sin(t * 9) * 1.8 : Math.sin(t * 2) * 0.8;

    // Ground shadow (stays planted — drawn before the walk lean)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 0.95, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    // Walk cycle: the whole body leans into the stride and counter-wobbles
    // with each step. Pivot at the feet so ground contact stays planted.
    const lean = this.moving ? dir * 0.05 + Math.sin(t * 9) * 0.035 : 0;
    ctx.save();
    if (lean) {
      ctx.translate(s.x, s.y);
      ctx.rotate(lean);
      ctx.translate(-s.x, -s.y);
    }

    // Build this frame's cell grid: torso + whichever leg pose the stride
    // calls for (two-frame walk cycle, toggled by the step sine).
    const stepping = this.moving && Math.sin(t * 9) > 0;
    const rows = [...SPRITE_TORSO, ...(stepping ? LEGS_STEP : LEGS_STAND)];
    const cols = rows[0].length;
    const p = (r * 2.9) / rows.length;      // cell size; feet land on s.y
    const x0 = s.x - (cols * p) / 2;
    const y0 = s.y - rows.length * p + bob * 0.6;

    // Void aura: a dark body-shaped blob with a blue glow shadow, drawn
    // under the sprite so the silhouette rims in blue flame.
    ctx.save();
    ctx.shadowColor = 'rgba(80, 150, 255, 0.8)';
    ctx.shadowBlur = 13 + Math.sin(t * 3) * 3;
    ctx.fillStyle = '#131a2c';
    ctx.beginPath();
    ctx.ellipse(s.x, y0 + rows.length * p * 0.52,
                cols * p * 0.34, rows.length * p * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Sprite pass. Cells overlap by a hair so no seams show between rects.
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry];
      for (let cx = 0; cx < cols; cx++) {
        const ch = row[this.flip ? cols - 1 - cx : cx];
        if (ch === '.') continue;
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(x0 + cx * p, y0 + ry * p, p + 0.4, p + 0.4);
      }
    }

    // Glow pass: eyes + amulet gem burn ice-blue over the flat pixels.
    ctx.save();
    ctx.fillStyle = '#a5ecff';
    ctx.shadowColor = '#3fc8ff';
    ctx.shadowBlur = 3.5 + Math.sin(t * 4) * 1.5;
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry];
      for (let cx = 0; cx < cols; cx++) {
        if (row[this.flip ? cols - 1 - cx : cx] !== 'E') continue;
        ctx.fillRect(x0 + cx * p, y0 + ry * p, p + 0.4, p + 0.4);
      }
    }
    ctx.restore();

    // Void wand — ranged mode only; the Spirit Blade swap goes bare-handed
    // (its presence on screen is the slash VFX itself).
    if (this.weapon.id === 'ranged') {
      const hx = s.x + dir * p * 4.2;       // hand at the sleeve edge
      const hy = y0 + p * 11;               // belt-row height
      const tx = hx + dir * r * 0.75;       // crescent head, up-forward
      const ty = hy - r * 1.15;
      const bx = hx - dir * r * 0.28;       // shaft butt, down-behind
      const by = hy + r * 0.42;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#232a3d';          // dark shaft…
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = 'rgba(130, 185, 255, 0.5)'; // …with a blue edge light
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = '#141b2b';
      ctx.beginPath(); ctx.arc(hx, hy, r * 0.16, 0, Math.PI * 2); ctx.fill();
      // Crescent head cradling a smoldering void orb (the Voidcaller motif).
      ctx.save();
      ctx.strokeStyle = '#9fd8ff';
      ctx.shadowColor = '#3fc8ff';
      ctx.shadowBlur = 9;
      ctx.lineWidth = 2;
      const aim = Math.atan2(ty - by, tx - bx); // crescent opens along the shaft
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.26, aim + 0.7, aim - 0.7);
      ctx.stroke();
      ctx.fillStyle = '#d9f4ff';
      ctx.shadowBlur = 12 + Math.sin(t * 5) * 4;
      ctx.beginPath(); ctx.arc(tx, ty, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      // Voidcaller greatsword — melee mode. Dark tapered blade with a
      // blue edge glow and the crescent guard from the design sheet.
      const hx = s.x + dir * p * 4.2;       // same sleeve-edge hand
      const hy = y0 + p * 11;
      const a = Math.atan2(-1.55, dir);     // blade angle: up-forward
      const ca = Math.cos(a), sa = Math.sin(a);
      const gx = hx + ca * r * 0.28;        // guard sits just above the fist
      const gy = hy + sa * r * 0.28;
      const tipL = r * 2.0;                 // greatsword reach
      const tx = hx + ca * tipL, ty = hy + sa * tipL;
      const nx = -sa, ny = ca;              // blade width direction
      const w = r * 0.24;

      // Grip + glowing pommel behind the fist
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#232a3d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx - ca * r * 0.32, hy - sa * r * 0.32);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.fillStyle = '#6fc4ff';
      ctx.beginPath();
      ctx.arc(hx - ca * r * 0.36, hy - sa * r * 0.36, 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Blade: dark steel, hazed in void-blue, bright edge line
      const blade = new Path2D();
      blade.moveTo(gx + nx * w, gy + ny * w);
      blade.lineTo(tx, ty);
      blade.lineTo(gx - nx * w, gy - ny * w);
      blade.closePath();
      ctx.save();
      ctx.shadowColor = '#3fc8ff';
      ctx.shadowBlur = 5;
      ctx.fillStyle = '#1c2438';
      ctx.fill(blade);
      ctx.restore();
      ctx.strokeStyle = 'rgba(159, 216, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke(blade);
      // Fuller: faint runic light down the blade's center
      ctx.strokeStyle = 'rgba(130, 185, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(hx + ca * tipL * 0.8, hy + sa * tipL * 0.8);
      ctx.stroke();

      // Crescent-moon crossguard, opening toward the blade
      ctx.save();
      ctx.strokeStyle = '#9fd8ff';
      ctx.shadowColor = '#3fc8ff';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, r * 0.24, a + 0.8, a - 0.8);
      ctx.stroke();
      ctx.restore();

      // Gloved fist over the grip
      ctx.fillStyle = '#141b2b';
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore(); // end walk lean
  }
}
