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
      // Ranged legacy: picks made before the Spirit Blade swap carry over,
      // so an early ranged build isn't wasted by going melee.
      specterMul: 0.2,          // per Twin Shot level: specter follow-up slash dmg fraction
      pierceBonus: 0.05,        // per Piercing Shot stack: +dmg fraction on the blade
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
    // Stormcall (epic passive): lightning strikes random enemies.
    bolt: {
      cooldown: 3,              // seconds between storm bursts
      targets: 2,               // enemies struck per burst
      damageMul: 3,             // dmg = stats.damage * this * boltLevel
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

  // Dash (unlocked in the jungle vault after Stage 2). Space/Shift burns
  // stamina for a burst of speed along the current heading.
  dash: {
    max: 100,       // stamina pool
    cost: 50,       // per dash
    regen: 2,       // stamina per second
    speed: 760,     // burst speed
    duration: 0.2,  // seconds the burst lasts
  },

  // Spike-trap tiles (see bg.webp). Standing on one past the grace
  // period deals damage every tick interval until you step off.
  trap: {
    damage: 8,
    grace: 0.8,      // seconds you can stand on spikes before they bite
    interval: 0.75,  // seconds between damage ticks while you stay
  },

  // Stage 2 poison pools: sting on contact and keep ticking while you
  // wade. No grace period — the green sludge is its own warning.
  poison: {
    damage: 3,
    interval: 0.5,   // seconds between ticks while you stand in it
  },

  // Stage 2 fog: sight is clear out to `radius`, fades to opaque over
  // `edge`. Weapons can't acquire targets past the fade (weapons.js).
  fog: {
    radius: 380,
    edge: 160,
  },

  // Stage 3 quicksand: wading through it slows the stride (dash still
  // punches through at full speed — it's the escape tool).
  quicksand: {
    slowMul: 0.45,
  },

  // Stage 3 structures scattered at map gen (game.js): breakable towers
  // (some manned by an archer that drops down when it collapses) and
  // obelisks. Counts + spacing for the seeded scatter.
  structures: {
    towers: 12,
    obelisks: 16,
    armedChance: 0.6,  // fraction of towers that carry an archer
    spacing: 300,      // min distance between structures
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
    goldChance: 0.1,    // chance per kill of a gold drop (amount = enemy def)
  },

  // Wave pacing / difficulty curve (consumed by spawner in systems.js)
  waves: {
    firstWaveDelay: 1,
    waveInterval: 30,   // seconds between waves
    baseSpawnRate: 1.5, // enemies/sec at wave 1
    spawnRateGrowth: 0.15,
    stage2SpawnMul: 1.2, // Stage 2 spawns a bit faster — the player arrives stronger
    stage3SpawnMul: 1.3, // Stage 3 a touch denser still
    waveStorm: 5,        // Stage 3: seconds of sandstorm blown in at each wave start
    hpScaling: 0.12,    // per-wave multiplier add-ons
    damageScaling: 0.05,    //contact damage
    speedScaling: 0.04,
    finalWave: 15,      // boss wave: regular spawning stops, the dragon arrives
    wyvernEscort: 30,   // wyverns that fly in alongside the dragon
  },

  // Elite mobs: every N kills the next regular spawn comes out oversized,
  // glowing, and carrying a guaranteed gold purse.
  elite: {
    every: 25,
    hpMul: 5,
    sizeMul: 1.5,
    goldMin: 10,
    goldMax: 15,
  },

  // Level-up reroll: swap one offered upgrade for gold.
  rerollCost: 50,

  // Final boss (consumed by boss.js). Tuned to be a real fight: the dragon
  // is fast enough that pure kiting fails, firebreath punishes standing
  // still, and the claw swipe punishes hugging it.
  boss: {
    hp: 3500,
    radius: 46,
    speed: 85,             // combat chase speed (enrage multiplies this)
    arriveSpeed: 260,      // fly-in speed at wave start
    contactDamage: 16,     // touching the dragon hurts
    xp: 50,
    gold: 100,             // flat bounty, credited directly on the kill
    // Fly-by cameos before the real fight: every N waves the dragon
    // strafes the arena in a straight line — untouchable, spitting fire
    // at the player and trampling any mob it plows through.
    flyby: {
      every: 5,            // waves 5, 10, ... (stops at the final wave)
      speed: 380,          // straight-line strafe speed
      fireInterval: 0.5,   // seconds between fireballs during the pass
      trample: 40,         // damage to mobs caught under the body
    },
    enrageAt: 0.3,         // hp fraction; below this it speeds up + fires faster
    fire: {
      cooldown: 6,       // seconds between breaths
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

  // Stage 2 boss (boss.js: Serpent). A giant venom snake: spits glob
  // fans at range, and lunges — a telegraphed dash straight to the
  // player's marked position, then snaps back to where it coiled.
  boss2: {
    hp: 3800,
    radius: 40,            // head radius (the hittable body)
    speed: 115,            // slither chase speed
    arriveSpeed: 280,
    contactDamage: 18,
    xp: 60,
    gold: 120,
    venom: {
      cooldown: 2.8,       // seconds between spit fans
      range: 620,          // only spits when player is within this
      count: 7,            // globs per fan
      spread: (52 * Math.PI) / 180,
      speed: 380,
      damage: 16,          // per glob
    },
    dash: {
      range: 560,          // lunges when player is within this
      windup: 0.65,        // telegraph time — the beam shows the lane
      speed: 1500,         // lunge travel speed
      damage: 42,          // one hit if caught in the lane
      cooldown: 3.5,
    },
  },

  // Stage 3 boss (boss.js: MummyKing). A colossal mummy that shambles
  // after the player, reels them in with the bandage shot, and summons
  // scarab broods. At shieldAt hp it goes invincible behind a shield,
  // raises a permanent sandstorm (half sight), spawns `burst` scarabs —
  // the shield holds until every scarab on the field is dead — and from
  // then on also hurls big black orbs.
  boss3: {
    hp: 4500,
    radius: 70,            // a GIANT
    speed: 42,
    arriveSpeed: 240,
    contactDamage: 22,
    xp: 80,
    gold: 150,
    shieldAt: 0.5,         // hp fraction that triggers the storm phase
    stormSightMul: 0.5,    // sandstorm: half the Stage 2 fog's sight
    summon: {
      interval: 7,         // seconds between scarab broods
      count: 3,            // scarabs per brood
      burst: 20,           // scarabs raised with the shield
    },
    pull: {
      range: 640, windup: 1, speed: 950, damage: 14,
      cooldown: 5, pullSpeed: 1500,
    },
    shot: {                // black orbs, storm phase onward
      cooldown: 1.6, range: 640, speed: 300, damage: 20, radius: 14,
    },
  },
};

// Enemy archetypes. `behavior` is a tag entities.js/systems.js switch on.
// `gold` scales with toughness: coins dropped when the gold roll hits.
export const ENEMIES = {
  shade:  { hp: 20,  speed: 90,  damage: 8,  radius: 14, xp: 1, gold: 2, color: '#6c5ce7', behavior: 'chase' },
  brute:  { hp: 80,  speed: 55,  damage: 18, radius: 22, xp: 3, gold: 3, color: '#c0392b', behavior: 'chase' },
  swarm:  { hp: 8,   speed: 140, damage: 5,  radius: 9,  xp: 1, gold: 1, color: '#00cec9', behavior: 'chase' },
  // Skirmisher (wave 8+): holds its distance and spits venom globs.
  spitter: { hp: 35, speed: 70, damage: 12, radius: 16, xp: 4, gold: 3, color: '#9acd32', behavior: 'spit',
             range: 380, cooldown: 2.4, spitSpeed: 300 },
  // The dragon's brood — only spawn as the wave-25 escort.
  wyvern: { hp: 70,  speed: 115, damage: 14, radius: 15, xp: 5, gold: 4, color: '#ff8c42', behavior: 'chase' },

  // Stage 3 — the desert kingdom -------------------------------------
  // Demonic scarab: winds up and charges in a straight burst when far,
  // scuttles in for contact bites when close.
  scarab: { hp: 45, speed: 95, damage: 12, radius: 15, xp: 3, gold: 2, color: '#b3541e', behavior: 'charge',
            chargeRange: 320, chargeSpeed: 620, chargeTime: 0.55, chargeCooldown: 2.2, windup: 0.4,
            puddle: { life: 5, damage: 3, radius: 16 } }, // death leaves a blood puddle
  // Mummy: hulking bandaged colossus. Huge hp pool; rewraps to full if
  // left undamaged for healDelay. Fires a telegraphed bandage line that
  // reels the player in. The spawner marches in 4+wave of them per wave
  // (5 at wave 1, 6 at wave 2, ...) on their own clock.
  mummy: { hp: 210, speed: 50, damage: 24, radius: 30, xp: 12, gold: 8, color: '#cfc3a0', behavior: 'mummy',
           healDelay: 5,
           pull: { range: 520, windup: 0.9, speed: 900, damage: 10, cooldown: 4.5, pullSpeed: 1500 } },
  // The tower archer once its perch collapses — a ground skirmisher.
  shooter: { hp: 50, speed: 80, damage: 14, radius: 14, xp: 5, gold: 4, color: '#d9a441', behavior: 'spit',
             range: 420, cooldown: 2, spitSpeed: 340 },
  // Breakable structures (spawned at map gen, not by waves). Towers may
  // carry an archer (hasShooter, set at spawn) who shoots from the top —
  // out of melee reach until the tower falls and drops them down.
  tower:   { hp: 260, speed: 0, damage: 0, radius: 30, xp: 8, gold: 6, color: '#c8a86b', behavior: 'static',
             structure: true, range: 460, cooldown: 2.2, spitSpeed: 340, shotDamage: 14 },
  obelisk: { hp: 120, speed: 0, damage: 0, radius: 18, xp: 4, gold: 3, color: '#b59a68', behavior: 'static',
             structure: true, heal: 15 }, // toppling one restores flat hp
};

// Upgrade pool. id is stable; effect mutates the player's stat block.
// Optional fields (see Progression.rollChoices):
//   tier:     'rare' | 'epic' | 'legendary' — styles the level-up card; commons have none
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
  { id: 'pierce',   name: 'Piercing Shot',  desc: 'Projectiles pierce +1', note: 'Ranged only · carries to the Spirit Blade: +5% dmg each',
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
    note: 'Ranged only · stacks ×2 · carries to the Spirit Blade: specter follow-up slashes',
    requires: (p) => p.hasWeapon('ranged') && (p.stats.multishot || 1) < 2,
    effect: (p) => { p.stats.multishot = (p.stats.multishot || 1) + 1; } },
  // Echo Slash — melee evolution: a spectral reverse slash covers your back.
  { id: 'echo_slash', name: 'Echo Slash', tier: 'rare', weight: 0.25,
    desc: 'Every slash echoes behind you at 60% damage — no more backstabs',
    note: 'Spirit Blade only · once per run',
    requires: (p) => p.hasWeapon('melee') && !p.stats.echo,
    effect: (p) => { p.stats.echo = true; } },
  // Vampiric Rites — lifesteal on ALL damage dealt (any weapon, nova too).
  // Desert-blooded: only enters the pool from Stage 3 on (p.stage is
  // stamped on the player by game.js newWorld).
  { id: 'lifesteal', name: 'Vampiric Rites', tier: 'legendary', weight: 0.04,
    desc: 'Heal 2% of all damage you deal (stacks up to 6%)',
    note: 'Stage 3+ · stacks ×3',
    requires: (p) => p.stage >= 3 && (p.stats.lifesteal || 0) < 0.06,
    effect: (p) => { p.stats.lifesteal = (p.stats.lifesteal || 0) + 0.02; } },

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
  // Stormcall — periodic lightning on random enemies; stacks add damage.
  { id: 'bolt', name: 'Stormcall', tier: 'epic', weight: 0.1,
    desc: 'Every 3s lightning strikes 2 random foes (stacks)',
    note: 'Stacks ×3',
    requires: (p) => (p.stats.boltLevel || 0) < 3,
    effect: (p) => { p.stats.boltLevel = (p.stats.boltLevel || 0) + 1; } },
];

// Arena tiles. One hash decides each tile's look AND whether it's a
// hazard, so the renderer (game.js) and the damage checks (player.js)
// can never disagree about where the hazards are.
export const TILE = 100;

// Off-limits for hazards: out of bounds, the spawn area, the altar dais.
function hazardFree(ix, iy) {
  if (ix < 0 || iy < 0 ||
      ix >= CONFIG.worldWidth / TILE || iy >= CONFIG.worldHeight / TILE) return true;
  const cx = Math.floor(CONFIG.worldWidth / 2 / TILE);
  const cy = Math.floor(CONFIG.worldHeight / 2 / TILE);
  if (Math.abs(ix - cx) <= 2 && Math.abs(iy - cy) <= 2) return true;
  const ax = Math.floor(CONFIG.altar.x / TILE);
  const ay = Math.floor(CONFIG.altar.y / TILE);
  return Math.abs(ix - ax) <= 1 && Math.abs(iy - ay) <= 1;
}

export function isTrapTile(ix, iy) {
  if (hazardFree(ix, iy)) return false;
  const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
  return h % 71 === 0; // ~1.4% of tiles
}

// Stage 2 only — callers gate on world.stage. Same hash, different
// modulus; spikes win the rare tile that rolls both.
export function isPoisonTile(ix, iy) {
  if (hazardFree(ix, iy) || isTrapTile(ix, iy)) return false;
  const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
  return h % 29 === 11; // ~3.4% of tiles
}

// Stage 3 only — quicksand patches that slow the player (player.js).
export function isQuicksandTile(ix, iy) {
  if (hazardFree(ix, iy)) return false;
  const h = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
  return h % 19 === 7; // ~5.3% of tiles
}

// Playable characters: pixel-sprite sheets + palettes. player.js renders
// them in-world; ui.js paints the settings previews from the same data so
// the two can never drift apart. 12-wide rows, '.' = transparent.
// Legs are shared between characters (same two-frame walk cycle).
export const CHAR_LEGS = {
  stand: [
    '...PP..PP...',
    '...PP..PP...',
    '...PP..PP...',
    '...OO..OO...',
    '..OOO..OOO..',
  ],
  step: [
    '...PP..PP...',
    '..PP....PP..',
    '..PP....PP..',
    '..OO....OO..',
    '.OOO....OOO.',
  ],
};

export const CHARACTERS = {
  // Warrior/Hunter: spiky hair, ice-blue glow.
  hunter: {
    name: 'Hunter',
    pal: {
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
    },
    glow: { fill: '#a5ecff', shadow: '#3fc8ff' }, // eye/amulet glow pass
    aura: 'rgba(80, 150, 255, 0.8)',              // void-aura rim light
    auraBody: '#131a2c',                          // void-aura body blob
    torso: [
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
    ],
  },
  // The Huntress: same silhouette, pink theme, pointed witch hat.
  // Fast and frail, and her shots pierce from the start.
  huntress: {
    name: 'Huntress',
    stats: { speed: 250, maxHealth: 80, pierce: 1 }, // overrides CONFIG.player
    pal: {
      T: '#5a2a78', // witch hat
      H: '#ff6fb5', // hair (spills from under the brim)
      S: '#e9ddd2', // skin
      E: '#ffb8e2', // eyes / amulet gem
      M: '#46223f', // face mask (plum)
      C: '#43214a', // coat
      L: '#7a3d6e', // sleeve highlight
      B: '#ff4fa0', // belt + hat band
      K: '#2a1230', // cape
      P: '#331b3b', // pants
      O: '#170a20', // boots
    },
    glow: { fill: '#ffd0ec', shadow: '#ff5fbf' },
    aura: 'rgba(255, 95, 191, 0.8)',
    auraBody: '#2c1024',
    torso: [
      '.....TT.....',
      '.....TTT....',
      '....TTTT....',
      '....BBBB....',
      '.TTTTTTTTTT.',
      '..HHSSSSHH..',
      '...SESSES...',
      '...MMMMMM...',
      '....MMMM....',
      '.K.CCECCC...',
      '.KKCCCCCCC..',
      'KKLCCCCCCL..',
      'KKLCCBBCCL..',
      '.KKCCCCCC...',
      '.KCCCCCCC...',
    ],
  },
  // The Paladin: white-and-gold bulwark. Slow and soft-hitting, but twice
  // the Hunter's health and Holy Nova burns from the first step. Shop
  // unlock (500g) that only appears once Stage 2's serpent has fallen.
  paladin: {
    name: 'Paladin',
    stats: { speed: 180, damage: 7, maxHealth: 200, novaLevel: 1 },
    pal: {
      H: '#f0e9d8', // hair (white)
      S: '#e9ddd2', // skin
      E: '#ffd166', // eyes / amulet gem (gold)
      M: '#b8b09a', // face mask (pale)
      C: '#e6e0cf', // coat (white)
      L: '#c7bfa8', // sleeve shade
      B: '#e0a92e', // belt (gold)
      K: '#cfc7b2', // cape
      P: '#d8d2c0', // pants
      O: '#8f8468', // boots
    },
    glow: { fill: '#fff2c4', shadow: '#ffcf4d' },
    aura: 'rgba(255, 213, 110, 0.8)',
    auraBody: '#3a3322',
    // Staff repaint: white theme with a gold crescent + orb (player.js).
    wand: { shaft: '#7a6430', edge: 'rgba(255, 224, 130, 0.6)', grip: '#4a3c1c',
            head: '#ffd166', glow: '#ffb830', orb: '#fff3c9' },
    torso: [
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
    ],
  },
};

// Player-facing settings (persisted). ui.js writes, player.js reads.
// localStorage is guarded so the Node sim/test scripts can import this file.
const store = typeof localStorage !== 'undefined' ? localStorage : null;

// Shop catalog: permanent buys paid with gold, applied to the player's
// stat block at run start (player.js). Cost climbs with each level owned:
// cost of the NEXT level = base * (owned + 1).
export const SHOP = [
  // stage3Extra: bonus levels that open up once Stage 2 is beaten
  // (Progress.stage3). when: hides the item entirely until it returns true.
  { id: 'g_dmg',    name: 'Whetstone',      desc: '+2 damage per level',           base: 150, max: 5, stage3Extra: 3, apply: (s, lv) => { s.damage += 2 * lv; } },
  { id: 'g_hp',     name: 'Iron Constitution', desc: '+10 max health per level',   base: 150, max: 5, stage3Extra: 3, apply: (s, lv) => { s.maxHealth += 10 * lv; } },
  { id: 'g_speed',  name: 'Swift Boots',    desc: '+10 move speed per level',      base: 120,  max: 5, apply: (s, lv) => { s.speed += 10 * lv; } },
  { id: 'g_rate',   name: 'Talisman Focus', desc: '+0.2 shots/sec per level',      base: 150, max: 5, apply: (s, lv) => { s.fireRate += 0.2 * lv; } },
  { id: 'g_proj',   name: 'Spirit Winds',   desc: '+12.5% projectile speed per level', base: 120, max: 3, apply: (s, lv) => { s.projectileSpeed += 60 * lv; } },
  { id: 'g_pierce', name: 'Ghost Shots',    desc: 'Shots pierce +1 foe per level', base: 500, max: 2, apply: (s, lv) => { s.pierce = (s.pierce || 0) + lv; } },
  { id: 'huntress', name: 'Huntress',   desc: 'Unlock the Huntress — +30 speed, -20 max health, shots pierce from the start', base: 250, max: 1, apply: () => {} },
  { id: 'paladin',  name: 'Paladin',    desc: 'Unlock the Paladin — double health and Holy Nova from the start, but slow and soft-hitting', base: 500, max: 1, apply: () => {},
    when: () => Progress.stage3 },
];
export const shopCost = (item, owned) => item.base * (owned + 1);
export const shopMax = (item) => item.max + (Progress.stage3 ? item.stage3Extra || 0 : 0);

// Persistent meta-progression: gold balance + shop purchase levels.
export const Bank = {
  gold: Number(store?.getItem('ws_gold')) || 0,
  levels: JSON.parse(store?.getItem('ws_shop') || '{}'),
  addGold(n) {
    this.gold += n;
    store?.setItem('ws_gold', String(this.gold));
  },
  levelOf(id) { return this.levels[id] || 0; },
  // Spend gold on the next level of a shop item. False if maxed or broke.
  buy(item) {
    const owned = this.levelOf(item.id);
    const cost = shopCost(item, owned);
    if (owned >= shopMax(item) || this.gold < cost) return false;
    this.gold -= cost;
    this.levels[item.id] = owned + 1;
    store?.setItem('ws_gold', String(this.gold));
    store?.setItem('ws_shop', JSON.stringify(this.levels));
    return true;
  },
};

// Stage progression: Stage 2 unlocks once Stage 1's dragon falls and the
// player takes the stair through the Gate of Descent.
export const Progress = {
  stage2: store?.getItem('ws_stage2') === '1',
  // Stage 3: opened by walking the desert gate inside the jungle vault.
  stage3: store?.getItem('ws_stage3') === '1',
  // Crimson Boomerang: once claimed at the altar, every later run starts with it.
  boomerang: store?.getItem('ws_boomerang') === '1',
  // Dash: claimed from the jungle vault chest after Stage 2; permanent.
  dash: store?.getItem('ws_dash') === '1',
  unlockStage2() {
    this.stage2 = true;
    store?.setItem('ws_stage2', '1');
  },
  unlockStage3() {
    this.stage3 = true;
    store?.setItem('ws_stage3', '1');
  },
  unlockBoomerang() {
    this.boomerang = true;
    store?.setItem('ws_boomerang', '1');
  },
  unlockDash() {
    this.dash = true;
    store?.setItem('ws_dash', '1');
  },
};

// New Game: forget everything earned across runs — gold, shop levels
// (including the Huntress) and the Stage 2 unlock. Leaderboard and
// control settings survive; they're history/preferences, not progress.
export function wipeProgress() {
  Bank.gold = 0;
  Bank.levels = {};
  Progress.stage2 = false;
  Progress.stage3 = false;
  Progress.boomerang = false;
  Progress.dash = false;
  for (const k of ['ws_gold', 'ws_shop', 'ws_stage2', 'ws_stage3', 'ws_boomerang', 'ws_dash']) store?.removeItem(k);
  Settings.setCharacter('hunter'); // the Huntress is locked again
}

export const Settings = {
  controls: store?.getItem('ws_controls') || 'keyboard', // 'keyboard' | 'mouse'
  setControls(mode) {
    this.controls = mode;
    store?.setItem('ws_controls', mode);
  },
  character: store?.getItem('ws_character') || 'hunter', // key into CHARACTERS
  setCharacter(id) {
    // Shop-unlocked characters (huntress, paladin) stay refused until bought.
    if (SHOP.some((i) => i.id === id) && !Bank.levelOf(id)) return;
    this.character = id;
    store?.setItem('ws_character', id);
  },
  volume: (() => { const v = parseFloat(store?.getItem('ws_volume')); return Number.isFinite(v) ? v : 1; })(), // 0..1 master volume
  setVolume(v) {
    this.volume = v;
    store?.setItem('ws_volume', String(v));
  },
};
