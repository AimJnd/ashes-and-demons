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
  worldWidth: 2560,
  worldHeight: 1440,

  // Player base stats (player.js applies upgrades on top of these)
  player: {
    speed: 220,
    maxHealth: 100,
    pickupRadius: 60,
    fireRate: 2,        // shots per second
    damage: 10,
    projectileSpeed: 480,
  },

  // XP / leveling. xpForLevel(n) lives in progression (systems.js).
  xp: {
    baseToLevel: 5,
    growth: 1.35,       // each level needs growth x more
  },

  // Loot drops on enemy death (consumed by Combat in systems.js)
  drops: {
    healthChance: 0.08, // chance per kill that an enemy drops a health pickup
    healthValue: 15,    // flat HP restored when collected
  },

  // Wave pacing / difficulty curve (consumed by spawner in systems.js)
  waves: {
    firstWaveDelay: 1,
    waveInterval: 20,   // seconds between waves
    baseSpawnRate: 1.5, // enemies/sec at wave 1
    spawnRateGrowth: 0.15,
    hpScaling: 0.12,    // per-wave multiplier add-ons
    speedScaling: 0.04,
  },
};

// Enemy archetypes. `behavior` is a tag entities.js/systems.js switch on.
export const ENEMIES = {
  shade:  { hp: 20,  speed: 90,  damage: 8,  radius: 14, xp: 1, color: '#6c5ce7', behavior: 'chase' },
  brute:  { hp: 80,  speed: 55,  damage: 18, radius: 22, xp: 3, color: '#c0392b', behavior: 'chase' },
  swarm:  { hp: 8,   speed: 140, damage: 5,  radius: 9,  xp: 1, color: '#00cec9', behavior: 'chase' },
};

// Upgrade pool. id is stable; effect mutates the player's stat block.
export const UPGRADES = [
  { id: 'dmg_up',   name: 'Sharper Rites',  desc: '+25% damage',        effect: (p) => { p.stats.damage *= 1.25; } },
  { id: 'rate_up',  name: 'Quick Hands',    desc: '+20% fire rate',     effect: (p) => { p.stats.fireRate *= 1.20; } },
  { id: 'speed_up', name: 'Fleet Footed',   desc: '+15% move speed',    effect: (p) => { p.stats.speed *= 1.15; } },
  { id: 'hp_up',    name: 'Iron Will',      desc: '+25 max health',     effect: (p) => { p.stats.maxHealth += 25; p.health += 25; } },
  { id: 'magnet',   name: 'Soul Magnet',    desc: '+40% pickup radius', effect: (p) => { p.stats.pickupRadius *= 1.40; } },
  { id: 'pierce',   name: 'Piercing Shot',  desc: 'Projectiles pierce +1', effect: (p) => { p.stats.pierce = (p.stats.pierce || 0) + 1; } },
];
