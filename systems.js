/*
  systems.js  (merged: spawner + combat + progression)
  The "rules" layer — where most balancing/iteration happens. Operates on
  the world state object owned by game.js; holds no rendering code.
*/

import { CONFIG, ENEMIES, UPGRADES, Bank, Progress } from './config.js';
import { Enemy, Projectile, Pickup, FloatingText, Burst, BloodPuddle } from './entities.js';
import { Dragon, Serpent, MummyKing } from './boss.js';

// Spawner / difficulty director -------------------------------------
export class Spawner {
  constructor() {
    this.wave = 1;
    this.timer = 0;
    this._spawnAccumulator = 0;
    this.bossSpawned = false;   // wave-25 dragon is on the field (or dead)
    this._wyvernQueue = 0;      // escort still waiting to fly in
    this._wyvernTimer = 0;
    this._flybyWave = CONFIG.boss.flyby.every; // next dragon cameo wave
    this._nextElite = CONFIG.elite.every;      // kill count for the next elite
  }

  update(dt, world) {
    this.timer += dt;

    // Wave advances on a fixed interval, capped at the boss wave.
    this.wave = Math.min(
      CONFIG.waves.finalWave,
      1 + Math.floor(this.timer / CONFIG.waves.waveInterval)
    );

    // Dragon fly-by every N waves before the real fight — a taste of the
    // boss: untouchable, strafing fire, trampling the horde. Stage 1
    // only: Ashmaw is that stage's boss; the serpent doesn't fly.
    if ((world.stage ?? 1) === 1 &&
        this.wave >= this._flybyWave && this.wave < CONFIG.waves.finalWave) {
      this._flybyWave += CONFIG.boss.flyby.every;
      this._spawnFlyby(world);
    }

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

    // Stage 3: mummies march in on their own clock — 4+wave of them
    // spread evenly across each wave (5 at wave 1, 6 at wave 2, ...).
    if (world.stage >= 3) {
      if (this._mummyWave !== this.wave) {
        this._mummyWave = this.wave;
        this._mummyQuota = 4 + this.wave;
        this._mummyT = 0;
        // Each wave blows in on a brief sandstorm (game.js ticks it down;
        // the fog + weapon sight read it alongside the boss's storm).
        world.stormT = CONFIG.waves.waveStorm;
      }
      this._mummyT -= dt;
      if (this._mummyQuota > 0 && this._mummyT <= 0) {
        this._mummyT += CONFIG.waves.waveInterval / (4 + this.wave);
        this._mummyQuota -= 1;
        this.spawnEnemy(world, 'mummy');
      }
    }

    // Spawn rate grows each wave; accumulate fractional spawns.
    let rate = CONFIG.waves.baseSpawnRate + (this.wave - 1) * CONFIG.waves.spawnRateGrowth;
    if (world.stage >= 3) rate *= CONFIG.waves.stage3SpawnMul;
    else if (world.stage >= 2) rate *= CONFIG.waves.stage2SpawnMul;
    this._spawnAccumulator += dt * rate;
    while (this._spawnAccumulator >= 1) {
      this._spawnAccumulator -= 1;
      this.spawnEnemy(world);
    }
  }

  // Fly-by cameo: enters from off-screen on a straight line drawn through
  // the player's current position, crosses the arena, and exits.
  _spawnFlyby(world) {
    const p = world.player;
    const ang = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(ang) * 900;
    const y = p.y + Math.sin(ang) * 900;
    const aim = Math.atan2(p.y - y, p.x - x);
    const sp = CONFIG.boss.flyby.speed;
    world.enemies.push(new Dragon(x, y, {
      vx: Math.cos(aim) * sp,
      vy: Math.sin(aim) * sp,
    }));
    world.flybyRoar = true; // game.js: roar + camera rumble
    world.floaters.push(new FloatingText(
      p.x, p.y - 120, 'ASHMAW PASSES OVERHEAD...',
      { color: '#ff8c42', size: 20, life: 2 }
    ));
  }

  _startBossWave(world) {
    this.bossSpawned = true;
    const player = world.player;

    // The boss closes in from well off-screen at a random bearing:
    // Stage 1 the dragon, Stage 2 the venom serpent, Stage 3 the Mummy King.
    const ang = Math.random() * Math.PI * 2;
    const Boss = world.stage >= 3 ? MummyKing : world.stage === 2 ? Serpent : Dragon;
    const boss = new Boss(
      player.x + Math.cos(ang) * 1200,
      player.y + Math.sin(ang) * 1200
    );
    world.boss = boss;
    world.enemies.push(boss);

    // The Mummy King raises his own scarab court — no wyvern escort.
    this._wyvernQueue = world.stage >= 3 ? 0 : CONFIG.waves.wyvernEscort;
    this._wyvernTimer = 0.8; // a beat after the boss appears
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

    const e = new Enemy(x, y, forcedType ?? this._pickType(world.stage));

    // Per-wave scaling on the instance (shared defs stay untouched).
    // Escort wyverns spawn at config stats — that fight is tuned directly.
    // Quota mummies (stage 3) DO scale: they're wave spawns, just on
    // their own clock.
    if (forcedType !== 'wyvern') {
      const hpMul = 1 + (this.wave - 1) * CONFIG.waves.hpScaling;
      const spMul = 1 + (this.wave - 1) * CONFIG.waves.speedScaling;
      e.hp *= hpMul;
      e.maxHp = e.hp;
      e.speed *= spMul;

      // Elite: every N kills the next spawn comes out oversized and
      // glowing, with a guaranteed gold purse (Combat pays it out).
      if (world.kills >= this._nextElite) {
        this._nextElite += CONFIG.elite.every;
        const el = CONFIG.elite;
        e.elite = true;
        e.hp *= el.hpMul;
        e.maxHp = e.hp;
        e.radius *= el.sizeMul;
        e.eliteGold = el.goldMin +
          Math.floor(Math.random() * (el.goldMax - el.goldMin + 1));
      }
    }

    world.enemies.push(e);
  }

  _pickType(stage) {
    // Stage 3 remix: scarabs are the bread-and-butter charger, swarms
    // fill the gaps. Mummies arrive on their own quota clock (update),
    // and shooters only ever come from collapsed towers.
    if (stage >= 3) {
      const r = Math.random();
      if (r < Math.min(0.7, 0.35 + this.wave * 0.05)) return 'scarab';
      return 'swarm';
    }
    // Stage 2 remix: no shades — wyverns are the bread-and-butter
    // chaser (their share ramps up by wave so wave 1 doesn't maul you),
    // and spitters show up early and often.
    if (stage >= 2) {
      if (this.wave >= 3 && Math.random() < 0.2) return 'spitter';
      const r = Math.random();
      if (this.wave >= 4 && r < 0.18) return 'brute';
      if (r < Math.min(0.68, 0.32 + this.wave * 0.04)) return 'wyvern';
      return 'swarm';
    }
    // Spitters join from wave 8 — a separate roll so the existing mix
    // keeps its proportions.
    if (this.wave >= 8 && Math.random() < 0.12) return 'spitter';
    const r = Math.random();
    if (this.wave >= 4 && r < 0.2) return 'brute';
    if (r < 0.4) return 'swarm';
    return 'shade';
  }
}

// Soft-body separation (Vampire-Survivors style) ----------------------
// Enemies shove each other out of overlap so crowds form pressing rings
// instead of stacking into a single blob. Coarse spatial hash keeps it
// ~O(n); each pair resolves once, split by mass (radius²) so brutes
// plow through swarms and the dragon plows through everything.
export const Separation = {
  CELL: 80, // must exceed the largest radius-sum in play (boss+brute ≈ 61)

  resolve(world) {
    const es = world.enemies;
    if (es.length < 2) return;

    // Bin every enemy into a coarse grid keyed by cell coordinates.
    const grid = new Map();
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive) continue;
      e._si = i; // enumeration order: lets each pair resolve exactly once
      const k = ((e.x / this.CELL) | 0) * 100003 + ((e.y / this.CELL) | 0);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(e);
    }

    for (const e of es) {
      if (!e.alive) continue;
      const cx = (e.x / this.CELL) | 0;
      const cy = (e.y / this.CELL) | 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get((cx + ox) * 100003 + (cy + oy));
          if (!arr) continue;
          for (const o of arr) {
            if (!o.alive || o._si <= e._si) continue; // each pair once

            let dx = o.x - e.x;
            let dy = o.y - e.y;
            // 0.9: bodies may brush slightly — full radius looks too stiff.
            const rr = (e.radius + o.radius) * 0.9;
            let d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            if (d2 === 0) { // perfectly stacked: pick a random axis
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = dx * dx + dy * dy;
            }

            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            // Resolve a fraction of the overlap per frame — fully rigid
            // resolution makes dense crowds jitter.
            const push = (rr - d) * 0.6;
            const me = e.radius * e.radius;
            const mo = o.radius * o.radius;
            const total = me + mo;
            if (!e.isBoss && !e.def?.structure) {
              e.x -= nx * push * (mo / total);
              e.y -= ny * push * (mo / total);
            }
            if (!o.isBoss && !o.def?.structure) {
              o.x += nx * push * (me / total);
              o.y += ny * push * (me / total);
            }
          }
        }
      }
    }
  },
};

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
    // Fly-by dragon: untouchable until its natural final-wave spawn.
    // Throttled floater so a stream of hits doesn't wallpaper the screen.
    if (e.invulnerable) {
      if (!e._immuneT || world.time - e._immuneT > 0.4) {
        e._immuneT = world.time;
        world.floaters.push(new FloatingText(
          e.x, e.y - e.radius * 1.6, 'IMMUNE', { color: '#9aa0b4', size: 14 }
        ));
      }
      return;
    }
    const player = world.player;
    e.hp -= damage;
    e._lastHit = world.time; // mummies rewrap to full if this goes stale
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
      // Death burst: the body scatters into shards of its own color.
      world.floaters.push(new Burst(e.x, e.y, e.def?.color || '#c0392b'));
      // A collapsing tower drops its archer into the fight.
      if (e.hasShooter) world.enemies.push(new Enemy(e.x, e.y, 'shooter'));
      // Toppled obelisk releases its stored vitality.
      if (e.def?.heal) {
        player.health = Math.min(player.stats.maxHealth, player.health + e.def.heal);
        world.floaters.push(new FloatingText(
          player.x, player.y - player.radius * 1.6, `+${e.def.heal}`,
          { color: '#7dff9a' }
        ));
      }
      // Scarab guts: a blood puddle that lingers and bites on contact.
      if (e.def?.puddle) world.hazards.push(new BloodPuddle(e.x, e.y, e.def.puddle));
      world.pickups.push(new Pickup(e.x, e.y, 'xp', e.xp));
      // Random health drop — Lucky Charm adds to the base chance. Offset
      // slightly so it isn't hidden under the gem.
      if (Math.random() < CONFIG.drops.healthChance + (player.stats.luck || 0)) {
        world.pickups.push(
          new Pickup(e.x + 12, e.y, 'health', CONFIG.drops.healthValue)
        );
      }
      // Gold: the boss pays a flat bounty straight to the bank (victory
      // ends the run before a dropped coin could be walked over); everyone
      // else flips a coin for their def's gold value.
      if (e.isBoss) {
        // The relic only becomes permanent if its claimant fells the
        // Stage 1 dragon — claim + boss kill, same run.
        if (world.stage === 1 && world.player.stats.boomerang) Progress.unlockBoomerang();
        const bounty = (world.stage >= 3 ? CONFIG.boss3
                      : world.stage === 2 ? CONFIG.boss2 : CONFIG.boss).gold;
        Bank.addGold(bounty);
        world.floaters.push(new FloatingText(
          e.x, e.y - 60, `+${bounty} GOLD`,
          { color: '#ffd166', size: 20, life: 1.6 }
        ));
        // The exit rises a little away from the corpse, nudged toward the
        // arena center so it can never land outside the walls. game.js
        // animates it open and reads the stair as the exit. Stage 3: the
        // Mummy King's fall stills his sandstorm and reveals the pyramid
        // dungeon the gate is set into.
        world.sandstorm = false;
        const ang = Math.atan2(
          CONFIG.worldHeight / 2 - e.y, CONFIG.worldWidth / 2 - e.x
        );
        world.gate = {
          x: e.x + Math.cos(ang) * 340,
          y: e.y + Math.sin(ang) * 340,
          open: 0, // 0 closed → 1 fully open (door swing progress)
          pyramid: world.stage >= 3,
        };
        world.floaters.push(new FloatingText(
          world.gate.x, world.gate.y - 150,
          world.stage >= 3 ? 'THE GATES REVEAL THEMSELVES...' : 'A GATE RISES...',
          { color: world.stage >= 3 ? '#e0c37a' : '#c9a0ff', size: 20, life: 2.5 }
        ));
      } else if (e.elite) {
        // Elites always pay out — that's the whole point of hunting them.
        world.pickups.push(new Pickup(e.x - 12, e.y, 'gold', e.eliteGold));
      } else if (Math.random() < CONFIG.drops.goldChance) {
        world.pickups.push(new Pickup(e.x - 12, e.y, 'gold', e.def?.gold || 1));
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

    // Fly-by trample: the strafing dragon flattens mobs it plows through
    // (once per mob per pass — the set lives on that pass's flyby state).
    for (const fb of world.enemies) {
      if (!fb.alive || !fb.flyby) continue;
      for (const e of world.enemies) {
        if (!e.alive || e.isBoss || fb.flyby.trampled.has(e)) continue;
        if (hits(fb, e)) {
          fb.flyby.trampled.add(e);
          this.damageEnemy(world, e, CONFIG.boss.flyby.trample);
        }
      }
    }

    // Structures are solid: shove the player out of overlap so towers
    // and obelisks can't be walked through.
    for (const e of world.enemies) {
      if (!e.alive || !e.def?.structure) continue;
      const dx = player.x - e.x, dy = player.y - e.y;
      const rr = e.radius + player.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0) {
        const d = Math.sqrt(d2);
        player.x += (dx / d) * (rr - d);
        player.y += (dy / d) * (rr - d);
      }
    }

    // Enemies vs player (contact damage, gated by i-frames) ----------
    if (player._hurtCd <= 0) {
      for (const e of world.enemies) {
        if (!e.alive || e.damage <= 0) continue; // structures don't bite
        if (hits(e, player)) {
          if (!player.takeDamage(e.damage)) break; // dodged mid-dash
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
        if (!h.puddle) h.alive = false; // fireball bursts on impact; puddles linger
        if (player._hurtCd <= 0 && player.takeDamage(h.damage)) {
          player._hurtCd = 0.5;
          world.floaters.push(
            new FloatingText(player.x, player.y - player.radius * 1.6,
              Math.round(h.damage), { color: '#ff8c42' })
          );
          // Bandage shot: the wrap catches — the mummy reels the player
          // in (player.js drags until the slack runs out). A dash-dodged
          // hit never reaches here, so i-frames beat the pull too.
          if (h.pull) player._pull = { e: h.mummy, speed: h.pull };
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
      } else if (k.kind === 'gold') {
        Bank.addGold(k.value); // banked instantly — survives death
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
  // excludeIds: upgrades already on offer (used by the reroll so a
  // rerolled card can't duplicate one of the other options).
  rollChoices(count = 3, player, excludeIds = []) {
    const pool = UPGRADES.filter((u) =>
      !excludeIds.includes(u.id) &&
      (!u.requires || !player || u.requires(player)));
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
    if (up) {
      up.effect(player);
      // Remember the pick so the pause menu can list the build.
      player.acquired[upgradeId] = (player.acquired[upgradeId] || 0) + 1;
    }
  },
};
