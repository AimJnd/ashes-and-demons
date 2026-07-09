/*
  systems.js  (merged: spawner + combat + progression)
  The "rules" layer — where most balancing/iteration happens. Operates on
  the world state object owned by game.js; holds no rendering code.
*/

import { CONFIG, ENEMIES, UPGRADES } from './config.js';
import { Enemy, Projectile, Pickup, FloatingText } from './entities.js';
import { Dragon } from './boss.js';

// Spawner / difficulty director -------------------------------------
export class Spawner {
  constructor() {
    this.wave = 1;
    this.timer = 0;
    this._spawnAccumulator = 0;
    this.bossSpawned = false;   // wave-25 dragon is on the field (or dead)
    this._wyvernQueue = 0;      // escort still waiting to fly in
    this._wyvernTimer = 0;
  }

  // True once the final wave has fully arrived — victory is then simply
  // "no living enemies left" (checked by game.js after the cull).
  get finalWaveArrived() {
    return this.bossSpawned && this._wyvernQueue === 0;
  }

  update(dt, world) {
    this.timer += dt;

    // Wave advances on a fixed interval, capped at the boss wave.
    this.wave = Math.min(
      CONFIG.waves.finalWave,
      1 + Math.floor(this.timer / CONFIG.waves.waveInterval)
    );

    // FINAL WAVE: regular spawning stops. The dragon flies in with its
    // wyvern escort trickling in behind it (staggered, from all bearings).
    if (this.wave >= CONFIG.waves.finalWave) {
      if (!this.bossSpawned) this._startBossWave(world);
      if (this._wyvernQueue > 0) {
        this._wyvernTimer -= dt;
        while (this._wyvernTimer <= 0 && this._wyvernQueue > 0) {
          this._wyvernQueue -= 1;
          this._wyvernTimer += 0.35; // one every ~0.35s: a rolling swarm
          this.spawnEnemy(world, 'wyvern');
        }
      }
      return;
    }

    // Spawn rate grows each wave; accumulate fractional spawns.
    const rate = CONFIG.waves.baseSpawnRate + (this.wave - 1) * CONFIG.waves.spawnRateGrowth;
    this._spawnAccumulator += dt * rate;
    while (this._spawnAccumulator >= 1) {
      this._spawnAccumulator -= 1;
      this.spawnEnemy(world);
    }
  }

  _startBossWave(world) {
    this.bossSpawned = true;
    const player = world.player;

    // The dragon flies in from well off-screen at a random bearing.
    const ang = Math.random() * Math.PI * 2;
    const boss = new Dragon(
      player.x + Math.cos(ang) * 1200,
      player.y + Math.sin(ang) * 1200
    );
    world.boss = boss;
    world.enemies.push(boss);

    this._wyvernQueue = CONFIG.waves.wyvernEscort;
    this._wyvernTimer = 0.8; // a beat after the dragon appears
  }

  spawnEnemy(world, forcedType) {
    const player = world.player;

    // Spawn just outside the player's view, at a random bearing.
    const ang = Math.random() * Math.PI * 2;
    const dist = 800;
    let x = player.x + Math.cos(ang) * dist;
    let y = player.y + Math.sin(ang) * dist;
    x = Math.max(20, Math.min(CONFIG.worldWidth - 20, x));
    y = Math.max(20, Math.min(CONFIG.worldHeight - 20, y));

    const e = new Enemy(x, y, forcedType ?? this._pickType());

    // Per-wave scaling on the instance (shared defs stay untouched).
    // Wyverns spawn at their config stats — the fight is tuned directly.
    if (!forcedType) {
      const hpMul = 1 + (this.wave - 1) * CONFIG.waves.hpScaling;
      const spMul = 1 + (this.wave - 1) * CONFIG.waves.speedScaling;
      e.hp *= hpMul;
      e.maxHp = e.hp;
      e.speed *= spMul;
    }

    world.enemies.push(e);
  }

  _pickType() {
    const r = Math.random();
    if (this.wave >= 4 && r < 0.2) return 'brute';
    if (r < 0.4) return 'swarm';
    return 'shade';
  }
}

// Combat: collision + damage resolution ------------------------------
function hits(a, b) {
  const rr = a.radius + b.radius;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= rr * rr;
}

export const Combat = {
  // Single entry point for hurting an enemy — flash, damage number, and
  // death/drops all live here so every weapon (projectile, melee slash,
  // future DoTs) produces identical feedback and loot.
  damageEnemy(world, e, damage) {
    if (!e.alive) return; // guard: never double-kill / double-drop
    const player = world.player;
    e.hp -= damage;
    e.flash(); // subtle white tint so the struck enemy pops

    // Damage number: spawn just above the enemy's body.
    world.floaters.push(
      new FloatingText(e.x, e.y - e.radius * 1.6, Math.round(damage))
    );

    // Vampiric Rites: heal a fraction of damage dealt (capped at the hit's
    // real effect on the enemy so overkill doesn't over-heal).
    if (player.stats.lifesteal) {
      const dealt = Math.min(damage, Math.max(0, e.hp + damage));
      player.health = Math.min(
        player.stats.maxHealth,
        player.health + dealt * player.stats.lifesteal
      );
    }

    if (e.hp <= 0) {
      e.alive = false;
      world.kills += 1;
      world.pickups.push(new Pickup(e.x, e.y, 'xp', e.xp));
      // Random health drop — Lucky Charm adds to the base chance. Offset
      // slightly so it isn't hidden under the gem.
      if (Math.random() < CONFIG.drops.healthChance + (player.stats.luck || 0)) {
        world.pickups.push(
          new Pickup(e.x + 12, e.y, 'health', CONFIG.drops.healthValue)
        );
      }
    }
  },

  resolve(world) {
    const player = world.player;

    // Projectiles vs enemies -----------------------------------------
    for (const p of world.projectiles) {
      if (!p.alive) continue;
      for (const e of world.enemies) {
        if (!e.alive || p._hit.has(e)) continue;
        if (!hits(p, e)) continue;

        p._hit.add(e);
        this.damageEnemy(world, e, p.damage);

        // Spend one pierce per enemy; despawn when exhausted.
        if (p.pierce > 0) { p.pierce -= 1; }
        else { p.alive = false; break; }
      }
    }

    // Enemies vs player (contact damage, gated by i-frames) ----------
    if (player._hurtCd <= 0) {
      for (const e of world.enemies) {
        if (!e.alive) continue;
        if (hits(e, player)) {
          player.takeDamage(e.damage);
          player._hurtCd = 0.5;
          // Damage taken: red number above the player.
          world.floaters.push(
            new FloatingText(player.x, player.y - player.radius * 1.6,
              Math.round(e.damage), { color: '#ff5555' })
          );
          break; // one hit per i-frame window
        }
      }
    }

    // Hostile projectiles (dragon fireballs) vs player ----------------
    // Shares the same i-frame gate as contact damage so overlapping
    // fireballs can't melt the player in a single frame.
    for (const h of world.hazards) {
      if (!h.alive) continue;
      if (hits(h, player)) {
        h.alive = false; // fireball bursts on impact either way
        if (player._hurtCd <= 0) {
          player.takeDamage(h.damage);
          player._hurtCd = 0.5;
          world.floaters.push(
            new FloatingText(player.x, player.y - player.radius * 1.6,
              Math.round(h.damage), { color: '#ff8c42' })
          );
        }
      }
    }

    // Pickups vs player ----------------------------------------------
    for (const k of world.pickups) {
      if (!k.alive || !hits(k, player)) continue;
      if (k.kind === 'xp') {
        player.gainXp(k.value);
      } else if (k.kind === 'health') {
        player.health = Math.min(player.stats.maxHealth, player.health + k.value);
      }
      k.alive = false;
    }
  },
};

// Progression: XP curve + level-up choices ---------------------------
export const Progression = {
  xpForLevel(level) {
    return Math.round(CONFIG.xp.baseToLevel * Math.pow(CONFIG.xp.growth, level - 1));
  },
  init(player) {
    player.xpToNext = this.xpForLevel(player.level);
  },
  // Returns true if the player crossed a level threshold this frame.
  // Consumes one level per call; if enough XP remains for another level,
  // the next frame triggers again (so multiple modals queue naturally).
  checkLevelUp(player) {
    if (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level += 1;
      player.xpToNext = this.xpForLevel(player.level);
      return true;
    }
    return false;
  },
  // Pick N distinct random upgrade options for the modal.
  // Upgrades may declare:
  //   weight:   relative roll chance (default 1; rare upgrades use < 1)
  //   requires: fn(player) gate — hides options that don't apply
  //             (e.g. Spirit Blade once owned, pierce after going melee)
  rollChoices(count = 3, player) {
    const pool = UPGRADES.filter((u) => !u.requires || !player || u.requires(player));
    const out = [];
    while (out.length < count && pool.length) {
      // Weighted pick without replacement.
      const total = pool.reduce((sum, u) => sum + (u.weight ?? 1), 0);
      let r = Math.random() * total;
      let i = 0;
      while (i < pool.length - 1 && (r -= pool[i].weight ?? 1) > 0) i++;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  },
  apply(player, upgradeId) {
    const up = UPGRADES.find((u) => u.id === upgradeId);
    if (up) up.effect(player);
  },
};
