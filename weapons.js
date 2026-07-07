/*
  weapons.js
  Weapon behaviors, pulled out of player.js so the player only owns
  movement/health/XP and simply delegates attacking to `this.weapon`.

  - RangedWeapon: the original auto-fire — shoots a projectile at the
    nearest enemy. Damage is resolved later by Combat (projectile vs enemy).
  - MeleeWeapon:  arc slash toward the nearest enemy in reach. Hits every
    enemy inside the cone instantly (via Combat.damageEnemy) and spawns a
    SlashVFX sweep so the attack reads on screen.

  Both read live values from player.stats each attack, so upgrades like
  dmg_up / rate_up keep working regardless of which weapon is equipped.
*/

import { CONFIG } from './config.js';
import { Projectile } from './entities.js';
import { Combat } from './systems.js';

// Nearest living enemy to (x, y), optionally capped to maxDist.
function nearestEnemy(world, x, y, maxDist = Infinity) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Base ---------------------------------------------------------------
export class Weapon {
  constructor() { this._cooldown = 0; }
  update(dt, player, world) {
    this._cooldown -= dt;
    if (this._cooldown > 0) return;
    if (this.attack(player, world)) {
      this._cooldown = 1 / this.attacksPerSecond(player);
    }
  }
  attacksPerSecond(player) { return player.stats.fireRate; }
  // Return true if an attack actually happened (starts the cooldown).
  attack(player, world) { return false; /* override */ }
}

// Ranged (starting weapon) --------------------------------------------
export class RangedWeapon extends Weapon {
  id = 'ranged';
  attack(player, world) {
    const target = nearestEnemy(world, player.x, player.y);
    if (!target) return false;
    const ang = Math.atan2(target.y - player.y, target.x - player.x);
    const sp = player.stats.projectileSpeed;

    // Twin Shot: fire a fan of `multishot` projectiles centered on target.
    const count = player.stats.multishot || 1;
    const spread = CONFIG.weapons.multishotSpread;
    for (let i = 0; i < count; i++) {
      const a = ang + (i - (count - 1) / 2) * spread;
      world.projectiles.push(new Projectile(
        player.x, player.y,
        Math.cos(a) * sp, Math.sin(a) * sp,
        player.stats.damage, player.stats.pierce || 0
      ));
    }
    return true;
  }
}

// Melee (rare upgrade) -------------------------------------------------
export class MeleeWeapon extends Weapon {
  id = 'melee';

  attacksPerSecond(player) {
    // Slower cadence than shooting, but rate_up still speeds it up.
    return player.stats.fireRate * CONFIG.weapons.melee.rateMul;
  }

  attack(player, world) {
    const cfg = CONFIG.weapons.melee;
    const target = nearestEnemy(world, player.x, player.y, cfg.range);
    if (!target) return false; // stay ready until something is in reach

    const ang = Math.atan2(target.y - player.y, target.x - player.x);
    const dmg = player.stats.damage * cfg.damageMul * (player.stats.meleeMul || 1);

    this._slash(player, world, ang, dmg, 0);
    // Echo Slash: a spectral reverse slash covers the player's back,
    // a beat behind the main one so the two sweeps read separately.
    if (player.stats.echo) {
      this._slash(player, world, ang + Math.PI, dmg * cfg.echoMul, 0.09);
    }
    return true;
  }

  // Damage every living enemy inside the cone and spawn the sweep VFX.
  _slash(player, world, ang, dmg, vfxDelay) {
    const cfg = CONFIG.weapons.melee;
    const halfArc = cfg.arc / 2;
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      if (Math.hypot(dx, dy) > cfg.range + e.radius) continue;
      // Smallest signed angle between slash direction and enemy bearing.
      let diff = Math.atan2(dy, dx) - ang;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > halfArc) continue;
      Combat.damageEnemy(world, e, dmg);
    }
    // Visual sweep — floaters is the generic VFX list game.js already ticks.
    world.floaters.push(
      new SlashVFX(player.x, player.y, ang, cfg.range, cfg.arc, vfxDelay)
    );
  }
}

// Slash VFX ------------------------------------------------------------
// A spectral arc that sweeps across the cone over its short lifetime,
// then fades. Pure visuals; damage was already applied on the attack frame.
const SLASH_LIFE = 0.22;
const SLASH_COLOR = '#9ff5ff'; // icy spirit-blade tint, distinct from projectiles

export class SlashVFX {
  constructor(x, y, angle, range, arc, delay = 0) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.range = range;
    this.arc = arc;
    this.delay = delay; // stay invisible this long (Echo Slash offset)
    this.life = SLASH_LIFE;
    this.alive = true;
  }

  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return; }
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    if (this.delay > 0) return;
    const s = camera.toScreen(this.x, this.y);
    const t = 1 - this.life / SLASH_LIFE; // 0 -> 1 over lifetime
    // Sweep: leading edge travels across the cone; trail fades behind it.
    const from = this.angle - this.arc / 2;
    const lead = from + this.arc * Math.min(1, t * 1.6);

    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - t);
    const grad = ctx.createRadialGradient(s.x, s.y, this.range * 0.25, s.x, s.y, this.range);
    grad.addColorStop(0, 'rgba(159, 245, 255, 0)');
    grad.addColorStop(1, SLASH_COLOR);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, this.range, from, lead);
    ctx.closePath();
    ctx.fill();

    // Bright leading edge line for a "blade" feel.
    ctx.globalAlpha = 0.9 * (1 - t);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s.x + Math.cos(lead) * this.range * 0.3, s.y + Math.sin(lead) * this.range * 0.3);
    ctx.lineTo(s.x + Math.cos(lead) * this.range, s.y + Math.sin(lead) * this.range);
    ctx.stroke();
    ctx.restore();
  }
}

// Holy Nova (epic passive) ---------------------------------------------
// Owned by the player alongside the weapon; no-ops until stats.novaLevel
// is set by the upgrade. Bursts on a fixed cooldown, damaging every enemy
// in the radius, with an expanding ring VFX.
export class NovaPassive {
  constructor() { this._cd = 0; }

  update(dt, player, world) {
    const level = player.stats.novaLevel || 0;
    if (level <= 0) return;
    this._cd -= dt;
    if (this._cd > 0) return;
    this._cd = CONFIG.weapons.nova.cooldown;

    const cfg = CONFIG.weapons.nova;
    const dmg = player.stats.damage * cfg.damageMul * level;
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - player.x, e.y - player.y) <= cfg.radius + e.radius) {
        Combat.damageEnemy(world, e, dmg);
      }
    }
    world.floaters.push(new NovaVFX(player.x, player.y, cfg.radius));
  }
}

const NOVA_LIFE = 0.5;
const NOVA_COLOR = '255, 214, 102'; // warm holy gold (rgb triplet)

export class NovaVFX {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = NOVA_LIFE;
    this.alive = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = 1 - this.life / NOVA_LIFE;      // 0 -> 1
    const ease = 1 - (1 - t) * (1 - t);       // fast start, soft landing
    const r = this.radius * ease;

    ctx.save();
    // Expanding ring
    ctx.globalAlpha = 0.85 * (1 - t);
    ctx.strokeStyle = `rgba(${NOVA_COLOR}, 1)`;
    ctx.lineWidth = 6 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Soft inner glow that lags the ring
    ctx.globalAlpha = 0.25 * (1 - t);
    const grad = ctx.createRadialGradient(s.x, s.y, r * 0.4, s.x, s.y, r);
    grad.addColorStop(0, `rgba(${NOVA_COLOR}, 0)`);
    grad.addColorStop(1, `rgba(${NOVA_COLOR}, 1)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Factory so config upgrades can swap weapons by id without importing classes.
export function createWeapon(id) {
  switch (id) {
    case 'melee': return new MeleeWeapon();
    case 'ranged':
    default: return new RangedWeapon();
  }
}
