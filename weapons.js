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
import { Projectile, Boomerang } from './entities.js';
import { Combat } from './systems.js';
import { Sfx } from './audio.js';

// Fog gate: you can't aim at what you can't see. Targets past the
// half-faded edge are unacquirable — Stage 2's fog, or the Mummy King's
// sandstorm at half that sight. Everywhere else sees forever.
function sightRange(world) {
  const base = CONFIG.fog.radius + CONFIG.fog.edge / 2;
  if (world.sandstorm) return base * CONFIG.boss3.stormSightMul;
  return world.stage === 2 ? base : Infinity;
}

// Nearest living enemy to (x, y), optionally capped to maxDist.
// Skips invulnerable ones (the fly-by dragon) — no wasting aim on them.
// Creatures outrank structures: autofire only chews on a tower or
// obelisk when nothing is actually coming for you.
function nearestEnemy(world, x, y, maxDist = Infinity) {
  let best = null, bestD = maxDist * maxDist;
  let bestS = null, bestSD = maxDist * maxDist;
  for (const e of world.enemies) {
    if (!e.alive || e.invulnerable) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (e.def?.structure) {
      if (d < bestSD) { bestSD = d; bestS = e; }
    } else if (d < bestD) { bestD = d; best = e; }
  }
  return best || bestS;
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
    const target = nearestEnemy(world, player.x, player.y, sightRange(world));
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
    Sfx.shoot();
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
    // Ranged legacy: Piercing Shot stacks picked before the swap sharpen
    // the blade permanently.
    const legacy = 1 + (player.stats.pierce || 0) * cfg.pierceBonus;
    const dmg = player.stats.damage * cfg.damageMul * (player.stats.meleeMul || 1) * legacy;

    this._slash(player, world, ang, dmg, 0);
    // Ranged legacy: each Twin Shot level manifests a specter blade that
    // repeats the slash a beat later at a fraction of its damage.
    const specters = (player.stats.multishot || 1) - 1;
    for (let i = 1; i <= specters; i++) {
      this._slash(player, world, ang, dmg * cfg.specterMul, 0.06 * i);
    }
    // Echo Slash: a spectral reverse slash covers the player's back,
    // a beat behind the main one so the two sweeps read separately.
    if (player.stats.echo) {
      this._slash(player, world, ang + Math.PI, dmg * cfg.echoMul, 0.09);
    }
    Sfx.slash();
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

  // Crescent blade sweep: a filled crescent — thick right behind the
  // leading edge, tapering to a point at the trail — with a white-hot
  // blade line at the front. Reads as a sword swing, not a projectile.
  render(ctx, camera) {
    if (this.delay > 0) return;
    const s = camera.toScreen(this.x, this.y);
    const t = 1 - this.life / SLASH_LIFE; // 0 -> 1 over lifetime
    const from = this.angle - this.arc / 2;
    const lead = from + this.arc * Math.min(1, t * 1.75);
    const fade = 1 - t;
    const span = lead - from;
    if (span <= 0.02) return;

    // Outer edge hugs the cone rim from trail to lead; inner edge bows
    // in behind the blade and rejoins the rim at the trailing tip.
    const crescent = (Rout, depth) => {
      const p = new Path2D();
      p.arc(s.x, s.y, Rout, from, lead);
      const N = 12;
      for (let i = N; i >= 0; i--) {
        const u = i / N; // 1 = leading edge, 0 = trailing tip
        const a = from + span * u;
        const r = Rout - depth * Math.pow(u, 0.65);
        p.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      p.closePath();
      return p;
    };

    ctx.save();
    ctx.lineCap = 'round';
    const R = this.range;
    // Wide spectral body, then a tighter hot core inside it.
    ctx.globalAlpha = 0.30 * fade;
    ctx.fillStyle = SLASH_COLOR;
    ctx.fill(crescent(R, R * 0.5));
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = '#e6fbff';
    ctx.fill(crescent(R * 0.96, R * 0.28));

    // The blade itself: a white-hot edge at the leading angle.
    ctx.globalAlpha = Math.min(1, 1.2 * fade);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x + Math.cos(lead) * R * 0.4, s.y + Math.sin(lead) * R * 0.4);
    ctx.lineTo(s.x + Math.cos(lead) * R, s.y + Math.sin(lead) * R);
    ctx.stroke();
    ctx.restore();
  }
}

// Crimson Boomerang (altar relic passive) --------------------------------
// Dormant until stats.boomerang is set by claiming the altar. Every
// cooldown, hurls a piercing boomerang in a random direction.
export class BoomerangPassive {
  constructor() { this._cd = 0; }

  update(dt, player, world) {
    if (!player.stats.boomerang) return;
    this._cd -= dt;
    if (this._cd > 0) return;
    this._cd = CONFIG.weapons.boomerang.cooldown;
    world.projectiles.push(new Boomerang(player, Math.random() * Math.PI * 2));
    Sfx.boomerang();
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
    Sfx.nova();
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
    // Main expanding ring with echo rings trailing behind it. (No radial
    // gradients — transparent stops render inconsistently across canvases.)
    ctx.strokeStyle = `rgba(${NOVA_COLOR}, 1)`;
    ctx.globalAlpha = 0.85 * (1 - t);
    ctx.lineWidth = 6 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    for (const [lag, a] of [[0.82, 0.30], [0.62, 0.14]]) {
      ctx.globalAlpha = a * (1 - t);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * lag, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Stormcall (epic passive) ---------------------------------------------
// No-ops until stats.boltLevel is set by the upgrade. Every cooldown,
// lightning strikes `targets` distinct random enemies; stacks add damage.
export class BoltPassive {
  constructor() { this._cd = 0; }

  update(dt, player, world) {
    const level = player.stats.boltLevel || 0;
    if (level <= 0) return;
    this._cd -= dt;
    if (this._cd > 0) return;
    const sight = sightRange(world);
    const alive = world.enemies.filter((e) => e.alive && !e.invulnerable &&
      Math.hypot(e.x - player.x, e.y - player.y) <= sight);
    if (!alive.length) return; // stay armed until something exists

    const cfg = CONFIG.weapons.bolt;
    this._cd = cfg.cooldown;
    const dmg = player.stats.damage * cfg.damageMul * level;
    const strikes = Math.min(cfg.targets, alive.length);
    for (let i = 0; i < strikes; i++) {
      // splice = distinct targets per burst
      const e = alive.splice(Math.floor(Math.random() * alive.length), 1)[0];
      world.floaters.push(new BoltVFX(e.x, e.y));
      Combat.damageEnemy(world, e, dmg);
    }
    Sfx.bolt();
  }
}

const BOLT_LIFE = 0.22;

export class BoltVFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.life = BOLT_LIFE;
    this.alive = true;
    // Jagged strike path down from the sky, seeded once at creation so
    // the bolt doesn't rewrite itself every frame.
    this.pts = [];
    const top = y - 340;
    let px = x + (Math.random() * 2 - 1) * 30;
    for (let i = 0; i < 6; i++) {
      this.pts.push([px + (Math.random() * 2 - 1) * 26, top + (340 / 6) * i]);
    }
    this.pts.push([x, y]);
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const a = this.life / BOLT_LIFE;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#eaf6ff';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#7bdfff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < this.pts.length; i++) {
      const s = camera.toScreen(this.pts[i][0], this.pts[i][1]);
      i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
    }
    ctx.stroke();
    // Impact flash at the struck enemy
    const s = camera.toScreen(this.x, this.y);
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12 * a, 0, Math.PI * 2);
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
