/*
  config.js  —  the balancing file (merged: config + upgrades + enemies)
  Pure data, no logic. Everything tunable lives here so you can balance
  the game without touching gameplay code.
    - CONFIG:   global constants (canvas, player base stats, XP curve, pacing)
    - ENEMIES:  enemy type definitions (stats + behavior tag + appearance)
    - UPGRADES: declarative upgrade pool. Each effect is a fn(player) so
                progression.js can apply a chosen upgrade with one call.
*/

export const CONFIG = {
  // Viewport / world
  worldWidth: 5120,
  worldHeight: 2880,

  // Player base stats (player.js applies upgrades on top of these)
  player: {
    speed: 220,
    maxHealth: 100,
    pickupRadius: 60,
    fireRate: 2,        // shots per second
    damage: 10,
    projectileSpeed: 480,
  },

  // Weapon tuning (consumed by weapons.js). Ranged reads player stats
  // directly; melee layers these multipliers on top so dmg_up / rate_up
  // upgrades keep mattering after the weapon swap.
  weapons: {
    melee: {
      damageMul: 2.5,           // slash dmg = stats.damage * this (* meleeMul)
      rateMul: 0.55,            // slashes/sec = stats.fireRate * this
      range: 110,               // reach in world units
      arc: (130 * Math.PI) / 180, // cone width
      echoMul: 0.6,             // Echo Slash: reverse slash deals this fraction
    },
    // Holy Nova (epic passive): periodic shockwave centered on the player.
    nova: {
      cooldown: 4,              // seconds between bursts
      radius: 240,
      damageMul: 1.2,           // dmg = stats.damage * this * novaLevel
    },
    // Chrono Field (epic passive): slow aura around the player.
    chrono: {
      radius: 200,
      slowMul: 0.55,            // enemy speed factor inside the field
    },
    // Twin Shot: angular gap between projectiles in the fan.
    multishotSpread: (10 * Math.PI) / 180,
    // Crimson Boomerang (altar relic): auto-thrown, pierces everything,
    // flies out `range` then homes back to the player.
    boomerang: {
      unlockWave: 10,   // relic materializes on the altar at this wave
      cooldown: 4,
      damageMul: 4.5,   // dmg = stats.damage * this; 45 at base damage,
                        // one-shots wave-10 shades (~41.6 hp) and swarms
      speed: 420,
      range: 380,
      radius: 14,
    },
  },

  // The altar (far from spawn) where the Crimson Boomerang relic waits.
  altar: { x: 4520, y: 520 },

  // Spike-trap tiles (see bg.webp). Standing on one past the grace
  // period deals damage every tick interval until you step off.
  trap: {
    damage: 8,
    grace: 0.8,      // seconds you can stand on spikes before they bite
    interval: 0.75,  // seconds between damage ticks while you stay
  },

  // XP / leveling. xpForLevel(n) lives in progression (systems.js).
  xp: {
    baseToLevel: 5,
    growth: 1.35,       // each level needs growth x more
  },

  // Loot drops on enemy death (consumed by Combat in systems.js)
  drops: {
    healthChance: 0.008, // chance per kill that an enemy drops a health pickup
    healthValue: 15,    // flat HP restored when collected
  },

  // Wave pacing / difficulty curve (consumed by spawner in systems.js)
  waves: {
    firstWaveDelay: 1,
    waveInterval: 30,   // seconds between waves
    baseSpawnRate: 1.5, // enemies/sec at wave 1
    spawnRateGrowth: 0.15,
    hpScaling: 0.12,    // per-wave multiplier add-ons
    damageScaling: 0.05,    //contact damage
    speedScaling: 0.04,
    finalWave: 15,      // boss wave: regular spawning stops, the dragon arrives
    wyvernEscort: 30,   // wyverns that fly in alongside the dragon
  },

  // Final boss (consumed by boss.js). Tuned to be a real fight: the dragon
  // is fast enough that pure kiting fails, firebreath punishes standing
  // still, and the claw swipe punishes hugging it.
  boss: {
    hp: 3500,
    radius: 46,
    speed: 85,             // combat chase speed (enrage multiplies this)
    arriveSpeed: 260,      // fly-in speed at wave start
    contactDamage: 22,     // touching the dragon hurts
    xp: 50,
    enrageAt: 0.3,         // hp fraction; below this it speeds up + fires faster
    fire: {
      cooldown: 4.5,       // seconds between breaths
      range: 720,          // only breathes when player is within this
      sweep: (80 * Math.PI) / 180, // total sweep arc of the breath
      duration: 1.1,       // seconds the breath lasts
      interval: 0.09,      // seconds between fireballs during the sweep
      speed: 270,          // fireball travel speed
      damage: 16,          // per fireball
    },
    melee: {
      range: 170,          // swipe reach (from dragon center)
      arc: (120 * Math.PI) / 180,
      damage: 38,
      windup: 0.75,        // telegraph time before the swipe lands
      cooldown: 4,
    },
  },
};

// Enemy archetypes. `behavior` is a tag entities.js/systems.js switch on.
export const ENEMIES = {
  shade:  { hp: 20,  speed: 90,  damage: 8,  radius: 14, xp: 1, color: '#6c5ce7', behavior: 'chase' },
  brute:  { hp: 80,  speed: 55,  damage: 18, radius: 22, xp: 3, color: '#c0392b', behavior: 'chase' },
  swarm:  { hp: 8,   speed: 140, damage: 5,  radius: 9,  xp: 1, color: '#00cec9', behavior: 'chase' },
  // The dragon's brood — only spawn as the wave-25 escort.
  wyvern: { hp: 70,  speed: 115, damage: 14, radius: 15, xp: 5, color: '#ff8c42', behavior: 'chase' },
};

// Upgrade pool. id is stable; effect mutates the player's stat block.
// Optional fields (see Progression.rollChoices):
//   tier:     'rare' | 'epic' — styles the level-up card; commons have none
//   weight:   relative roll chance (default 1; rare ~0.25, epic ~0.1)
//   requires: fn(player) — option only offered when this returns true
//   note:     shown in the Abilities compendium (availability / stack info)
export const UPGRADES = [
  // Commons ------------------------------------------------------------
  { id: 'dmg_up',   name: 'Sharper Rites',  desc: '+25% damage',        effect: (p) => { p.stats.damage *= 1.25; } },
  { id: 'rate_up',  name: 'Quick Hands',    desc: '+20% attack speed',  effect: (p) => { p.stats.fireRate *= 1.20; } },
  { id: 'speed_up', name: 'Fleet Footed',   desc: '+15% move speed',    effect: (p) => { p.stats.speed *= 1.15; } },
  { id: 'hp_up',    name: 'Iron Will',      desc: '+25 max health',     effect: (p) => { p.stats.maxHealth += 25; p.health += 25; } },
  { id: 'magnet',   name: 'Soul Magnet',    desc: '+40% pickup radius', effect: (p) => { p.stats.pickupRadius *= 1.40; } },
  { id: 'lucky',    name: 'Lucky Charm',    desc: '+5% health drop chance', note: 'Stacks ×3',
    requires: (p) => (p.stats.luck || 0) < 0.15, // cap at 3 stacks
    effect: (p) => { p.stats.luck = (p.stats.luck || 0) + 0.05; } },
  // Ranged-only: pointless once the Spirit Blade replaces shooting.
  { id: 'pierce',   name: 'Piercing Shot',  desc: 'Projectiles pierce +1', note: 'Ranged only',
    requires: (p) => p.hasWeapon('ranged'),
    effect: (p) => { p.stats.pierce = (p.stats.pierce || 0) + 1; } },
  // Melee-only follow-up so the blade has its own growth path.
  { id: 'melee_edge', name: 'Honed Edge', desc: '+30% slash damage', note: 'Spirit Blade only',
    requires: (p) => p.hasWeapon('melee'),
    effect: (p) => { p.stats.meleeMul = (p.stats.meleeMul || 1) * 1.30; } },

  // Rares ----------------------------------------------------------------
  // Spirit Blade — replaces shooting with a sweeping melee slash.
  { id: 'melee_unlock', name: 'Spirit Blade', tier: 'rare', weight: 0.25,
    desc: 'Trade your shots for a spectral blade — sweeping slashes cleave every foe in reach',
    note: 'Once per run · replaces shooting',
    requires: (p) => p.hasWeapon('ranged'),
    effect: (p) => { p.stats.meleeMul = 1; p.setWeapon('melee'); } },
  // Twin Shot — ranged evolution, stacks to a 3-shot fan.
  { id: 'twin_shot', name: 'Twin Shot', tier: 'rare', weight: 0.25,
    desc: 'Fire an extra projectile in a spread (stacks up to 3 shots)',
    note: 'Ranged only · stacks ×2',
    requires: (p) => p.hasWeapon('ranged') && (p.stats.multishot || 1) < 3,
    effect: (p) => { p.stats.multishot = (p.stats.multishot || 1) + 1; } },
  // Echo Slash — melee evolution: a spectral reverse slash covers your back.
  { id: 'echo_slash', name: 'Echo Slash', tier: 'rare', weight: 0.25,
    desc: 'Every slash echoes behind you at 60% damage — no more backstabs',
    note: 'Spirit Blade only · once per run',
    requires: (p) => p.hasWeapon('melee') && !p.stats.echo,
    effect: (p) => { p.stats.echo = true; } },
  // Vampiric Rites — lifesteal on ALL damage dealt (any weapon, nova too).
  { id: 'lifesteal', name: 'Vampiric Rites', tier: 'rare', weight: 0.25,
    desc: 'Heal 6% of all damage you deal (stacks up to 18%)',
    note: 'Stacks ×3',
    requires: (p) => (p.stats.lifesteal || 0) < 0.18,
    effect: (p) => { p.stats.lifesteal = (p.stats.lifesteal || 0) + 0.06; } },

  // Epics ------------------------------------------------------------------
  // Chrono Field — permanent slow aura around the player.
  { id: 'chrono', name: 'Chrono Field', tier: 'epic', weight: 0.1,
    desc: 'Time thickens around you — enemies inside your field move at half speed',
    note: 'Once per run · the dragon resists it',
    requires: (p) => !p.stats.chrono,
    effect: (p) => { p.stats.chrono = true; } },
  // Holy Nova — periodic shockwave; stacks add damage per burst.
  { id: 'nova', name: 'Holy Nova', tier: 'epic', weight: 0.1,
    desc: 'Every 4s an expanding shockwave sears everything around you (stacks)',
    note: 'Stacks ×3',
    requires: (p) => (p.stats.novaLevel || 0) < 3,
    effect: (p) => { p.stats.novaLevel = (p.stats.novaLevel || 0) + 1; } },
];

// Arena tiles. One hash decides each tile's look AND whether it's a spike
// trap, so the renderer (game.js) and the damage check (player.js) can
// never disagree about where the traps are.
export const TILE = 100;
export function isTrapTile(ix, iy) {
  if (ix < 0 || iy < 0 ||
      ix >= CONFIG.worldWidth / TILE || iy >= CONFIG.worldHeight / TILE) return false;
  // Keep the spawn area and the altar dais safe.
  const cx = Math.floor(CONFIG.worldWidth / 2 / TILE);
  const cy = Math.floor(CONFIG.worldHeight / 2 / TILE);
  if (Math.abs(ix - cx) <= 2 && Math.abs(iy - cy) <= 2) return false;
  const ax = Math.floor(CONFIG.altar.x / TILE);
  const ay = Math.floor(CONFIG.altar.y / TILE);
  if (Math.abs(ix - ax) <= 1 && Math.abs(iy - ay) <= 1) return false;
  const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
  return h % 71 === 0; // ~1.4% of tiles
}

// Player-facing settings (persisted). ui.js writes, player.js reads.
// localStorage is guarded so the Node sim/test scripts can import this file.
const store = typeof localStorage !== 'undefined' ? localStorage : null;
export const Settings = {
  controls: store?.getItem('ws_controls') || 'keyboard', // 'keyboard' | 'mouse'
  setControls(mode) {
    this.controls = mode;
    store?.setItem('ws_controls', mode);
  },
};
