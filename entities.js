/*
  entities.js  (merged: Entity base + Enemy + Projectile + Pickup)
  The player lives in player.js; everything else that moves lives here.
  Each class extends Entity and implements update(dt, ...) + render(ctx, camera).
*/

import { CONFIG, ENEMIES } from './config.js';

// Base ---------------------------------------------------------------
export class Entity {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.alive = true;
  }
  update(dt) { /* override */ }
  render(ctx, camera) { /* override */ }
}

// How long an enemy stays tinted white after being struck (seconds).
const ENEMY_FLASH = 0.08;

// Enemy --------------------------------------------------------------
export class Enemy extends Entity {
  constructor(x, y, typeKey) {
    const def = ENEMIES[typeKey];
    super(x, y, def.radius);
    this.type = typeKey;
    this.def = def;
    // Stats copied onto the instance so the spawner can scale them per wave
    // without touching the shared ENEMIES definition.
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.speed = def.speed;
    this.damage = def.damage;
    this.xp = def.xp;
    this.flip = false;
    this._hitFlash = 0; // counts down after a hit; drives the white tint
    // Per-instance animation offset so a crowd doesn't move in lockstep.
    this._phase = Math.random() * Math.PI * 2;
  }

  // Trigger the subtle on-hit flash. Called by Combat when struck.
  flash() { this._hitFlash = ENEMY_FLASH; }

  update(dt, player, world) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    // Chrono Field: enemies inside the player's aura move at a fraction of
    // their speed. Computed per-frame — base speed is never mutated.
    let speed = this.speed;
    if (player.stats.chrono && d <= CONFIG.weapons.chrono.radius) {
      speed *= CONFIG.weapons.chrono.slowMul;
    }

    if (this.def.behavior === 'spit') {
      // Skirmisher: hold preferred range — advance when far, back off
      // when the player closes in, stand ground in between.
      const want = this.def.range;
      const dir = d > want ? 1 : d < want * 0.65 ? -1 : 0;
      this.x += (dx / d) * speed * dir * dt;
      this.y += (dy / d) * speed * dir * dt;
      // Spit at the player on a cooldown while roughly in range. First
      // shot is randomized so a batch of spawns doesn't volley in sync.
      // (world is absent in the Node sim's calls — then it just moves.)
      this._spitCd = (this._spitCd ?? Math.random() * this.def.cooldown) - dt;
      if (world && this._spitCd <= 0 && d < want * 1.35) {
        this._spitCd = this.def.cooldown;
        const sp = this.def.spitSpeed;
        world.hazards.push(new Spit(
          this.x, this.y - this.radius,
          (dx / d) * sp, (dy / d) * sp, this.damage
        ));
      }
    } else if (this.def.behavior === 'static') {
      // Structure: rooted. An armed tower snipes from its top on a
      // spitter-style cadence; the arrow leaves the parapet, not the base.
      if (this.hasShooter && world) {
        this._spitCd = (this._spitCd ?? Math.random() * this.def.cooldown) - dt;
        if (this._spitCd <= 0 && d < this.def.range) {
          this._spitCd = this.def.cooldown;
          const oy = this.y - 84; // parapet height (matches the render)
          const adx = player.x - this.x, ady = (player.y - 10) - oy;
          const ad = Math.hypot(adx, ady) || 1;
          const sp = this.def.spitSpeed;
          world.hazards.push(new Spit(
            this.x, oy, (adx / ad) * sp, (ady / ad) * sp,
            this.def.shotDamage, '#e8d28a'
          ));
        }
      }
    } else if (this.def.behavior === 'charge') {
      // Scarab: far away it roots, aims, then barrels down a straight
      // lane; close in it just scuttles at you (contact damage bites).
      if (this._chargeT > 0) {
        this._chargeT -= dt;
        this.x += Math.cos(this._chargeAng) * this.def.chargeSpeed * dt;
        this.y += Math.sin(this._chargeAng) * this.def.chargeSpeed * dt;
      } else if (this._windupT > 0) {
        this._windupT -= dt; // rooted: the render shivers as a tell
        if (this._windupT <= 0) this._chargeT = this.def.chargeTime;
      } else {
        this._chargeCd = (this._chargeCd ?? 0) - dt;
        if (d > this.def.chargeRange && this._chargeCd <= 0) {
          this._windupT = this.def.windup;
          this._chargeAng = Math.atan2(dy, dx); // lane locked at windup
          this._chargeCd = this.def.chargeCooldown;
        } else {
          this.x += (dx / d) * speed * dt;
          this.y += (dy / d) * speed * dt;
        }
      }
    } else if (this.def.behavior === 'mummy') {
      const P = this.def.pull;
      if (this._bWindup > 0) {
        // Rooted; the render draws the bandage lane along _bAng.
        this._bWindup -= dt;
        if (this._bWindup <= 0 && world) {
          world.hazards.push(new Bandage(this, this._bAng, P));
        }
      } else {
        this._bCd = (this._bCd ?? Math.random() * P.cooldown) - dt;
        if (world && this._bCd <= 0 && d < P.range && d > 120) {
          this._bCd = P.cooldown;
          this._bWindup = P.windup;
          // Lane locked at windup (sidestep it!) — aimed from the shot's
          // launch point a shoulder up, so it flies the telegraph exactly.
          this._bAng = Math.atan2(player.y - (this.y - this.radius), dx);
        } else {
          this.x += (dx / d) * speed * dt;
          this.y += (dy / d) * speed * dt;
        }
      }
      // Left alone too long, the wraps reknit: back to full.
      if (world && this.hp < this.maxHp &&
          world.time - (this._lastHit ?? 0) > this.def.healDelay) {
        this.hp = this.maxHp;
        world.floaters.push(new FloatingText(
          this.x, this.y - this.radius * 2, 'REWOUND', { color: '#cfc3a0', size: 14 }
        ));
      }
    } else {
      // 'chase': move straight at the player.
      this.x += (dx / d) * speed * dt;
      this.y += (dy / d) * speed * dt;
    }

    if (this.def.structure) this.flip = false; // buildings don't turn
    else if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  // Character art (iterated visually against rendered previews).
  // Each type: cel-shaded gradient body, colored rim line, glowing eyes.
  // The main silhouette Path2D is kept so the on-hit flash can refill
  // the exact same shape in white.
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000 + this._phase;
    let body;
    switch (this.type) {
      case 'brute':   body = this._renderBrute(ctx, s, t); break;
      case 'swarm':   body = this._renderSwarm(ctx, s, t); break;
      case 'wyvern':  body = this._renderWyvern(ctx, s, t); break;
      case 'spitter': body = this._renderSpitter(ctx, s, t); break;
      case 'scarab':  body = this._renderScarab(ctx, s, t); break;
      case 'mummy':   body = this._renderMummy(ctx, s, t, camera); break;
      case 'shooter': body = this._renderShooter(ctx, s, t); break;
      case 'tower':   body = this._renderTower(ctx, s, t); break;
      case 'obelisk': body = this._renderObelisk(ctx, s, t); break;
      default:        body = this._renderShade(ctx, s, t); break;
    }
    // Elite: golden glow outline traced around the body silhouette.
    if (this.elite && body) {
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.75 + Math.sin(t * 5) * 0.2;
      ctx.stroke(body);
      ctx.restore();
    }
    if (this._hitFlash > 0 && body) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / ENEMY_FLASH) * 0.7;
      ctx.fillStyle = '#fff';
      ctx.fill(body);
      ctx.restore();
    }
  }

  // Spitter: squat venom toad-imp — breathing round body, back spines,
  // glowing eyes, and a mouth that gapes open just before it spits.
  _renderSpitter(ctx, s, t) {
    const r = this.radius;
    const squash = 1 + Math.sin(t * 3.2) * 0.06; // idle breathing
    const w = r * 1.5, h = r * 1.25 * squash;
    const cy = s.y - h * 0.8;
    const dir = this.flip ? -1 : 1;

    this._shadow(ctx, s, r * 0.95);

    // Back spines poke over the silhouette (drawn first, behind the body).
    ctx.fillStyle = '#33551a';
    for (const [ox, sh] of [[-0.45, 0.9], [-0.1, 1.15], [0.25, 0.9]]) {
      const bx = s.x - dir * w * ox;
      ctx.beginPath();
      ctx.moveTo(bx - 4, cy - h * 0.55);
      ctx.lineTo(bx, cy - h * 0.55 - r * sh * 0.55);
      ctx.lineTo(bx + 4, cy - h * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    const p = new Path2D();
    p.ellipse(s.x, cy, w, h, 0, 0, Math.PI * 2);
    ctx.fillStyle = this._vgrad(ctx, s.x, cy - h, cy + h, '#a8d84a', '#4a7a1e');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(200, 255, 120, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke(p);

    // Mouth: a dark slit facing the player that gapes as the spit charges.
    const gape = this._spitCd !== undefined
      ? Math.max(0, (0.45 - Math.max(0, this._spitCd)) / 0.45) : 0;
    ctx.fillStyle = '#1d2b10';
    ctx.beginPath();
    ctx.ellipse(s.x + dir * w * 0.4, cy + h * 0.15,
                w * 0.28, h * (0.08 + gape * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();

    // Venom-lit eyes
    this._glowDot(ctx, s.x + dir * w * 0.18, cy - h * 0.38, 2.2, '#ffec6e');
    this._glowDot(ctx, s.x + dir * w * 0.52, cy - h * 0.30, 2.2, '#ffec6e');

    return p;
  }

  _shadow(ctx, s, w, alpha = 0.35) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, w, w * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _vgrad(ctx, x, y0, y1, c0, c1) {
    const g = ctx.createLinearGradient(x, y0, x, y1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  }

  _glowDot(ctx, x, y, r, color, blur = 8) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Shade: gothic wraith — curled drooping hood with a wisp-light at the
  // tip, flowing skirt dissolving into ragged streamers, slanted eyes.
  _renderShade(ctx, s, t) {
    const r = this.radius;
    const hover = Math.sin(t * 2.6) * 3;
    const h = r * 3.0, w = r * 2.2;
    const bot = s.y - 6 - hover, top = bot - h;
    const drift = Math.sin(t * 1.3) * r * 0.1;

    this._shadow(ctx, s, r * 0.7, 0.2);

    const p = new Path2D();
    const tipx = s.x + drift - r * 0.55, tipy = top - r * 0.30;
    p.moveTo(tipx, tipy);
    p.quadraticCurveTo(s.x + drift + r * 0.75, top - r * 0.15,
                       s.x + w * 0.26, top + h * 0.28);
    p.quadraticCurveTo(s.x + w * 0.60, top + h * 0.72, s.x + w * 0.44, bot - r * 0.15);
    // Ragged hem: streamers of uneven length, right to left.
    const frays = [
      [ 0.30, 0.55, 0.15], [ 0.10, 0.05, 0.42],
      [-0.10, 0.65, 0.20], [-0.30, 0.15, 0.48],
    ];
    let px = 0.44;
    for (const [fx, drop, rise] of frays) {
      const wob = Math.sin(t * 3.5 + fx * 9) * 1.8;
      p.quadraticCurveTo(s.x + w * (px + fx) / 2, bot - r * rise,
                         s.x + w * fx, bot + r * drop + wob);
      px = fx;
    }
    p.quadraticCurveTo(s.x - w * 0.40, bot - r * 0.3, s.x - w * 0.44, bot - r * 0.35);
    p.quadraticCurveTo(s.x - w * 0.58, top + h * 0.70, s.x - w * 0.24, top + h * 0.30);
    p.quadraticCurveTo(s.x + drift - r * 0.9, top + r * 0.35, tipx, tipy);
    p.closePath();

    ctx.fillStyle = this._vgrad(ctx, s.x, top, bot, '#3b2f5e', '#171126');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(140, 124, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke(p);

    // Wisp-light at the hood tip
    this._glowDot(ctx, tipx, tipy + 1, 1.6, '#8c7cff', 6);

    // Face void
    ctx.fillStyle = '#0a0714';
    ctx.beginPath();
    ctx.ellipse(s.x + drift * 0.5 + r * 0.06, top + h * 0.30,
                w * 0.22, h * 0.15, drift * 0.02, 0, Math.PI * 2);
    ctx.fill();

    // Slanted glowing eyes (rotated slivers)
    ctx.save();
    ctx.fillStyle = '#b7a8ff';
    ctx.shadowColor = '#b7a8ff';
    ctx.shadowBlur = 8;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + drift * 0.5 + d * r * 0.28 + r * 0.06, top + h * 0.29,
                  2.6, 1.1, d * -0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return p;
  }

  // Brute: horned crimson bruiser — gorilla stance with ground fists,
  // bone horns, under-bite fangs and a molten crack down the chest.
  // Knuckle-walks: fists step alternately while the body lumbers.
  _renderBrute(ctx, s, t) {
    const r = this.radius;
    const w = r * 2.5, h = r * 2.4;
    const dir = this.flip ? -1 : 1;

    // Gait clock: opposite-phase fist steps + a heavy body bounce.
    const gait = t * 5;
    const stepL = Math.sin(gait);
    const stepR = -stepL;
    const liftL = Math.max(0, stepL) * r * 0.20;   // fist lifts off ground
    const liftR = Math.max(0, stepR) * r * 0.20;
    const leadL = dir * stepL * r * 0.16;          // and swings forward
    const leadR = dir * stepR * r * 0.16;
    const bounce = Math.abs(Math.sin(gait)) * r * 0.06;
    const breathe = Math.sin(t * 1.8) * r * 0.04;
    const top = s.y - h - breathe - bounce;

    this._shadow(ctx, s, r * (1.3 - bounce * 0.01));

    const p = new Path2D();
    p.moveTo(s.x - w * 0.46 + leadL, s.y - liftL);
    p.quadraticCurveTo(s.x - w * 0.56, s.y - h * 0.45, s.x - w * 0.42, top + h * 0.22);
    p.quadraticCurveTo(s.x - w * 0.30, top - r * 0.10, s.x, top + r * 0.06);
    p.quadraticCurveTo(s.x + w * 0.30, top - r * 0.10, s.x + w * 0.42, top + h * 0.22);
    p.quadraticCurveTo(s.x + w * 0.56, s.y - h * 0.45, s.x + w * 0.46 + leadR, s.y - liftR);
    p.lineTo(s.x + w * 0.24 + leadR, s.y - liftR);
    p.quadraticCurveTo(s.x + w * 0.30, s.y - h * 0.34, s.x + w * 0.16, s.y - h * 0.30);
    p.quadraticCurveTo(s.x, s.y - h * 0.20, s.x - w * 0.16, s.y - h * 0.30);
    p.quadraticCurveTo(s.x - w * 0.30, s.y - h * 0.34, s.x - w * 0.24 + leadL, s.y - liftL);
    p.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#4a1c20', '#200d12');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(220, 80, 60, 0.65)';
    ctx.lineWidth = 2;
    ctx.stroke(p);

    // Knuckle pads ride their stepping fists
    for (const [dx, lead, lift] of [[-w * 0.35, leadL, liftL], [w * 0.35, leadR, liftR]]) {
      ctx.fillStyle = '#57262b';
      ctx.beginPath();
      ctx.ellipse(s.x + dx + lead, s.y - r * 0.18 - lift, r * 0.30, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220, 80, 60, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Head sunk in the shoulder dip
    const hy = top + r * 0.34;
    ctx.fillStyle = '#2a1015';
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.52, hy - r * 0.30);
    ctx.quadraticCurveTo(s.x, hy - r * 0.62, s.x + r * 0.52, hy - r * 0.30);
    ctx.lineTo(s.x + r * 0.58, hy + r * 0.34);
    ctx.quadraticCurveTo(s.x, hy + r * 0.62, s.x - r * 0.58, hy + r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 80, 60, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bone horns curving from the temples
    for (const d of [-1, 1]) {
      const bx = s.x + d * r * 0.62, by = hy - r * 0.22;
      const horn = new Path2D();
      horn.moveTo(bx, by + r * 0.12);
      horn.quadraticCurveTo(bx + d * r * 0.62, by - r * 0.28, bx + d * r * 0.40, by - r * 0.95);
      horn.quadraticCurveTo(bx + d * r * 0.28, by - r * 0.52, bx - d * r * 0.05, by - r * 0.14);
      horn.closePath();
      ctx.fillStyle = '#d9c9b6';
      ctx.fill(horn);
      ctx.strokeStyle = '#3a241c';
      ctx.lineWidth = 1.5;
      ctx.stroke(horn);
    }

    // Eyes + under-bite fangs
    this._glowDot(ctx, s.x - r * 0.24, hy - r * 0.02, 2.6, '#ff7a5c', 9);
    this._glowDot(ctx, s.x + r * 0.24, hy - r * 0.02, 2.6, '#ff7a5c', 9);
    ctx.fillStyle = '#e8ddd0';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 0.30, hy + r * 0.44);
      ctx.lineTo(s.x + d * r * 0.20, hy + r * 0.16);
      ctx.lineTo(s.x + d * r * 0.10, hy + r * 0.44);
      ctx.closePath();
      ctx.fill();
    }

    // Molten crack down the chest (pulsing)
    ctx.save();
    ctx.strokeStyle = '#ff5a3c';
    ctx.shadowColor = '#ff5a3c';
    ctx.shadowBlur = 7;
    ctx.globalAlpha = 0.7 + Math.sin(t * 5) * 0.2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.06, hy + r * 0.7);
    ctx.lineTo(s.x + r * 0.12, s.y - h * 0.52);
    ctx.lineTo(s.x - r * 0.10, s.y - h * 0.40);
    ctx.lineTo(s.x + r * 0.06, s.y - h * 0.27);
    ctx.stroke();
    ctx.restore();
    return p;
  }

  // Swarm: teal bat imp — round body, scalloped membrane wings beating
  // fast, one big glossy cyclops eye and a fanged grin.
  _renderSwarm(ctx, s, t) {
    const r = this.radius;
    const bob = Math.sin(t * 10) * 2.5;
    const cy = s.y - r * 2.1 + bob;
    const flap = (Math.sin(t * 16) + 1) / 2;

    this._shadow(ctx, s, r * 0.65, 0.2);

    for (const d of [-1, 1]) {
      const shx = s.x + d * r * 0.55, shy = cy - r * 0.15;
      const tipx = shx + d * r * (1.6 + flap * 0.5);
      const tipy = shy - r * (1.3 * flap + 0.15);
      const wing = new Path2D();
      wing.moveTo(shx, shy);
      wing.quadraticCurveTo(shx + d * r * 0.9, shy - r * (1.2 * flap + 0.3), tipx, tipy);
      wing.quadraticCurveTo(tipx - d * r * 0.25, tipy + r * 0.75, shx + d * r * 1.05, shy + r * 0.28);
      wing.quadraticCurveTo(shx + d * r * 0.8,  shy + r * 0.05,  shx + d * r * 0.55, shy + r * 0.42);
      wing.quadraticCurveTo(shx + d * r * 0.25, shy + r * 0.2,   shx, shy + r * 0.3);
      wing.closePath();
      ctx.fillStyle = this._vgrad(ctx, shx, tipy, shy + r * 0.4, '#14494b', '#0a2426');
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(0, 206, 201, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke(wing);
    }

    // Body
    const body = new Path2D();
    body.arc(s.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = this._vgrad(ctx, s.x, cy - r, cy + r, '#17595c', '#0b2a2c');
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(0, 206, 201, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke(body);

    // Tiny horns
    ctx.fillStyle = '#0b2a2c';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 0.45, cy - r * 0.8);
      ctx.lineTo(s.x + d * r * 0.62, cy - r * 1.3);
      ctx.lineTo(s.x + d * r * 0.18, cy - r * 0.94);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 206, 201, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Big glossy cyclops eye
    ctx.fillStyle = '#04100f';
    ctx.beginPath(); ctx.arc(s.x, cy - r * 0.05, r * 0.52, 0, Math.PI * 2); ctx.fill();
    this._glowDot(ctx, s.x, cy - r * 0.05, r * 0.34, '#5ff7ef', 7);
    ctx.fillStyle = '#031312';
    ctx.beginPath(); ctx.arc(s.x + r * 0.08, cy - r * 0.02, r * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath(); ctx.arc(s.x - r * 0.10, cy - r * 0.18, r * 0.08, 0, Math.PI * 2); ctx.fill();

    // Grin fangs
    ctx.fillStyle = '#dff7f5';
    for (const d of [-0.28, 0.12]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 2 - r * 0.09, cy + r * 0.45);
      ctx.lineTo(s.x + d * r * 2,            cy + r * 0.72);
      ctx.lineTo(s.x + d * r * 2 + r * 0.09, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    return body;
  }

  // Wyvern: the dragon's brood — a lesser dragon in the boss's ember
  // palette. Horned head, bat wings, whip tail; flies with a fast bob.
  _renderWyvern(ctx, s, t) {
    const r = this.radius;
    const dir = this.flip ? -1 : 1;
    const bob = Math.sin(t * 7) * 3;
    const cy = s.y - r * 2.0 + bob;
    const flap = (Math.sin(t * 12) + 1) / 2;

    this._shadow(ctx, s, r * 0.7, 0.2);

    // Whip tail streaming behind (drawn first, behind everything)
    ctx.save();
    ctx.strokeStyle = '#241019';
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - dir * r * 0.4, cy + r * 0.3);
    ctx.quadraticCurveTo(
      s.x - dir * r * 1.2, cy + r * 0.5 + Math.sin(t * 5) * 3,
      s.x - dir * r * 1.8, cy + r * 0.15 + Math.sin(t * 4) * 4
    );
    ctx.stroke();
    ctx.restore();

    // Bat wings (scalloped membranes, pivot at the shoulders)
    for (const d of [-1, 1]) {
      const shx = s.x + d * r * 0.5, shy = cy - r * 0.2;
      const tipx = shx + d * r * (1.5 + flap * 0.45);
      const tipy = shy - r * (1.2 * flap + 0.15);
      const wing = new Path2D();
      wing.moveTo(shx, shy);
      wing.quadraticCurveTo(shx + d * r * 0.85, shy - r * (1.1 * flap + 0.3), tipx, tipy);
      wing.quadraticCurveTo(tipx - d * r * 0.2, tipy + r * 0.7, shx + d * r * 1.0, shy + r * 0.25);
      wing.quadraticCurveTo(shx + d * r * 0.75, shy + r * 0.02, shx + d * r * 0.5, shy + r * 0.4);
      wing.quadraticCurveTo(shx + d * r * 0.22, shy + r * 0.18, shx, shy + r * 0.28);
      wing.closePath();
      ctx.fillStyle = this._vgrad(ctx, shx, tipy, shy + r * 0.4, '#4a2418', '#221009');
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(255, 140, 66, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke(wing);
    }

    // Body (upright teardrop)
    const body = new Path2D();
    body.moveTo(s.x, cy - r * 0.95);
    body.quadraticCurveTo(s.x + r * 0.85, cy - r * 0.3, s.x + r * 0.6, cy + r * 0.55);
    body.quadraticCurveTo(s.x, cy + r * 1.0, s.x - r * 0.6, cy + r * 0.55);
    body.quadraticCurveTo(s.x - r * 0.85, cy - r * 0.3, s.x, cy - r * 0.95);
    body.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, cy - r, cy + r, '#5a2a1c', '#2a120c');
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(255, 140, 66, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke(body);

    // Belly plates
    ctx.strokeStyle = 'rgba(210, 160, 130, 0.35)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const py = cy + r * (0.15 + i * 0.3);
      ctx.beginPath();
      ctx.moveTo(s.x - r * (0.4 - i * 0.12), py);
      ctx.quadraticCurveTo(s.x, py + r * 0.14, s.x + r * (0.4 - i * 0.12), py);
      ctx.stroke();
    }

    // Tiny bone horns swept back
    ctx.fillStyle = '#cbb9a4';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * r * 0.35, cy - r * 0.75);
      ctx.lineTo(s.x + d * r * 0.7 - dir * r * 0.15, cy - r * 1.25);
      ctx.lineTo(s.x + d * r * 0.12, cy - r * 0.9);
      ctx.closePath();
      ctx.fill();
    }

    // Glowing ember eyes + snout glow
    ctx.save();
    ctx.fillStyle = '#ffb347';
    ctx.shadowColor = '#ff8c42';
    ctx.shadowBlur = 6;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + d * r * 0.26 + dir * r * 0.08, cy - r * 0.45,
                  1.9, 1.1, d * -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return body;
  }

  // Scarab: demonic dung beetle — split chitin shell, horn, skittering
  // legs, ember eyes. Shivers in place while it winds up a charge.
  _renderScarab(ctx, s, t) {
    const r = this.radius;
    const dir = this.flip ? -1 : 1;
    // Windup shiver: rooted rage before the lunge.
    const jit = this._windupT > 0 ? Math.sin(t * 60) * 2 : 0;
    const cx = s.x + jit, cy = s.y - r * 0.9;

    this._shadow(ctx, s, r * 1.05);

    // Legs: three per side, scuttling.
    ctx.strokeStyle = '#3a1c0c';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const step = Math.sin(t * 14 + i * 2.1 + side) * r * 0.14;
        const lx = cx + side * r * 0.85, ly = cy + r * (0.1 + i * 0.28);
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.4, ly - r * 0.1);
        ctx.lineTo(lx + step * side, ly + r * 0.34);
        ctx.stroke();
      }
    }

    // Shell: squat oval, split down the middle.
    const p = new Path2D();
    p.ellipse(cx, cy, r * 1.15, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = this._vgrad(ctx, cx, cy - r, cy + r, '#8a3c14', '#3d1a08');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(255, 120, 50, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke(p);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'; // elytra seam
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.lineTo(cx, cy + r * 0.9);
    ctx.stroke();

    // Head plate + horn out the front.
    const hx = cx + dir * r * 1.0;
    ctx.fillStyle = '#4d2009';
    ctx.beginPath();
    ctx.ellipse(hx, cy + r * 0.1, r * 0.42, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9c9b6';
    ctx.beginPath();
    ctx.moveTo(hx + dir * r * 0.15, cy);
    ctx.quadraticCurveTo(hx + dir * r * 0.85, cy - r * 0.45, hx + dir * r * 1.0, cy - r * 0.85);
    ctx.quadraticCurveTo(hx + dir * r * 0.45, cy - r * 0.3, hx - dir * r * 0.05, cy + r * 0.2);
    ctx.closePath();
    ctx.fill();

    // Ember eyes — flare white-hot during the windup.
    const glow = this._windupT > 0 ? '#ffe9c9' : '#ff7a3c';
    this._glowDot(ctx, hx + dir * r * 0.12, cy - r * 0.02, 2.2, glow, this._windupT > 0 ? 12 : 7);
    this._glowDot(ctx, hx + dir * r * 0.3, cy + r * 0.12, 2.2, glow, this._windupT > 0 ? 12 : 7);

    // Mid-charge: dust kicked up behind.
    if (this._chargeT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#c8b088';
      for (let i = 1; i <= 3; i++) {
        const bx = cx - Math.cos(this._chargeAng) * r * i * 0.9;
        const by = cy - Math.sin(this._chargeAng) * r * i * 0.9;
        ctx.beginPath();
        ctx.arc(bx, by + r * 0.6, r * 0.28 * i * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    return p;
  }

  // Mummy: a bandaged colossus — wrapped bulk, sagging strips, sunken
  // gold eyes. While winding the bandage shot, a thin telegraph line
  // marks the lane it will fire down.
  _renderMummy(ctx, s, t, camera) {
    const r = this.radius;
    const dir = this.flip ? -1 : 1;
    const sway = Math.sin(t * 1.6) * r * 0.05;
    const h = r * 2.6, w = r * 1.2;
    const top = s.y - h;

    // Telegraph: the bandage lane, drawn under the body.
    if (this._bWindup > 0) {
      const P = this.def.pull;
      const urgency = 1 - this._bWindup / P.windup; // brightens as it nears
      ctx.save();
      ctx.strokeStyle = `rgba(240, 230, 200, ${0.25 + urgency * 0.45})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -t * 60;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + Math.cos(this._bAng) * P.range,
                 s.y - r + Math.sin(this._bAng) * P.range);
      ctx.stroke();
      ctx.restore();
    }

    this._shadow(ctx, s, r * 1.2);

    // Body: a lumbering wrapped slab, arms fused into the silhouette.
    const p = new Path2D();
    p.moveTo(s.x - w * 0.72 + sway, s.y);
    p.quadraticCurveTo(s.x - w * 0.95 + sway, top + h * 0.45, s.x - w * 0.5 + sway, top + h * 0.18);
    p.quadraticCurveTo(s.x + sway * 2, top - r * 0.25, s.x + w * 0.5 + sway, top + h * 0.18);
    p.quadraticCurveTo(s.x + w * 0.95 + sway, top + h * 0.45, s.x + w * 0.72 + sway, s.y);
    p.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#d8cba6', '#7a6f52');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(60, 50, 30, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke(p);

    // Wrap lines: uneven horizontal bandage passes.
    ctx.strokeStyle = 'rgba(90, 78, 52, 0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const wy = top + h * (0.16 + i * 0.14);
      const ww = w * (0.55 + Math.sin(i * 2.7) * 0.18);
      ctx.beginPath();
      ctx.moveTo(s.x - ww + sway, wy);
      ctx.quadraticCurveTo(s.x + sway, wy + 4, s.x + ww + sway, wy - 2);
      ctx.stroke();
    }

    // Loose strips trailing off one shoulder and the hip.
    ctx.strokeStyle = '#c9bd97';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [ax, ay, len, ph] of [[-0.6, 0.25, 0.5, 0], [0.55, 0.6, 0.4, 2.2]]) {
      const bx = s.x + w * ax + sway, by = top + h * ay;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx - dir * r * 0.4, by + r * len * 1.4 + Math.sin(t * 2.4 + ph) * 3,
                           bx - dir * r * 0.2 + Math.sin(t * 1.8 + ph) * 4, by + r * len * 2.4);
      ctx.stroke();
    }

    // Head band gap: dark slit with sunken gold eyes.
    ctx.fillStyle = '#2b2416';
    ctx.fillRect(s.x - w * 0.4 + sway, top + h * 0.14, w * 0.8, r * 0.42);
    this._glowDot(ctx, s.x - r * 0.28 + sway + dir * r * 0.08, top + h * 0.14 + r * 0.2, 2.6, '#ffd166', 9);
    this._glowDot(ctx, s.x + r * 0.28 + sway + dir * r * 0.08, top + h * 0.14 + r * 0.2, 2.6, '#ffd166', 9);

    // HP bar: a big pool the player must burst down before it rewinds.
    if (this.hp < this.maxHp) {
      const bw = r * 2.2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(s.x - bw / 2, top - 14, bw, 5);
      ctx.fillStyle = '#cfc3a0';
      ctx.fillRect(s.x - bw / 2, top - 14, bw * (this.hp / this.maxHp), 5);
    }
    return p;
  }

  // Shooter: the dropped tower archer — robed desert bandit with a
  // shortbow, turban and ember eyes.
  _renderShooter(ctx, s, t) {
    const r = this.radius;
    const dir = this.flip ? -1 : 1;
    const bob = Math.sin(t * 6) * 1.5;
    const h = r * 2.5, w = r * 1.35;
    const top = s.y - h + bob;

    this._shadow(ctx, s, r * 0.9);

    // Robe: teardrop that flares to the hem.
    const p = new Path2D();
    p.moveTo(s.x, top);
    p.quadraticCurveTo(s.x + w * 0.85, top + h * 0.55, s.x + w * 0.6, s.y);
    p.lineTo(s.x - w * 0.6, s.y);
    p.quadraticCurveTo(s.x - w * 0.85, top + h * 0.55, s.x, top);
    p.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#c99b4a', '#6e4d1e');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(255, 210, 130, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke(p);

    // Sash + turban knot.
    ctx.strokeStyle = '#8a2f2f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x - w * 0.5, top + h * 0.52);
    ctx.quadraticCurveTo(s.x, top + h * 0.62, s.x + w * 0.5, top + h * 0.48);
    ctx.stroke();
    ctx.fillStyle = '#e8dcc0';
    ctx.beginPath();
    ctx.ellipse(s.x, top + r * 0.28, r * 0.55, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shortbow held out front; string tautens as the shot readies.
    const drawFrac = this._spitCd !== undefined
      ? Math.max(0, (0.5 - Math.max(0, this._spitCd)) / 0.5) : 0;
    const bx = s.x + dir * w * 0.85, by = top + h * 0.45;
    ctx.strokeStyle = '#5d3b21';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.75, -Math.PI / 2 + dir * 0.2, Math.PI / 2 - dir * 0.2, dir < 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240, 230, 200, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by - r * 0.72);
    ctx.lineTo(bx - dir * drawFrac * r * 0.5, by);
    ctx.lineTo(bx, by + r * 0.72);
    ctx.stroke();

    // Shadowed face, ember eyes.
    ctx.fillStyle = '#241605';
    ctx.beginPath();
    ctx.ellipse(s.x + dir * r * 0.06, top + r * 0.62, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    this._glowDot(ctx, s.x + dir * r * 0.2, top + r * 0.6, 1.8, '#ffb347', 6);
    this._glowDot(ctx, s.x - dir * r * 0.06, top + r * 0.62, 1.8, '#ffb347', 6);
    return p;
  }

  // Tower: breakable sandstone watchtower. Cracks spread as hp drops;
  // an armed tower shows its archer pacing the parapet.
  _renderTower(ctx, s, t) {
    const r = this.radius;
    const W = r * 2.1, H = 84; // parapet height matches the shot origin
    const top = s.y - H;

    this._shadow(ctx, s, r * 1.25);

    // Shaft with a slight taper.
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#d6b678', '#8a6f42');
    ctx.beginPath();
    ctx.moveTo(s.x - W * 0.5, s.y);
    ctx.lineTo(s.x - W * 0.42, top);
    ctx.lineTo(s.x + W * 0.42, top);
    ctx.lineTo(s.x + W * 0.5, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 40, 15, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Brick courses + arrow slit.
    ctx.strokeStyle = 'rgba(70, 50, 20, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const yy = top + (H * i) / 5;
      ctx.beginPath();
      ctx.moveTo(s.x - W * 0.46, yy);
      ctx.lineTo(s.x + W * 0.46, yy);
      ctx.stroke();
    }
    ctx.fillStyle = '#241605';
    ctx.fillRect(s.x - 2.5, top + H * 0.35, 5, 16);

    // Crenellated parapet.
    ctx.fillStyle = '#c2a25e';
    ctx.fillRect(s.x - W * 0.55, top - 10, W * 1.1, 12);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(s.x - W * 0.55 + i * W * 0.32, top - 18, W * 0.18, 9);
    }

    // Damage: cracks spread once it's been chewed below 60%.
    const frac = this.hp / this.maxHp;
    if (frac < 0.6) {
      ctx.save();
      ctx.strokeStyle = `rgba(30, 18, 5, ${0.9 - frac})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x - W * 0.2, s.y - 4);
      ctx.lineTo(s.x - W * 0.05, s.y - H * 0.4);
      ctx.lineTo(s.x - W * 0.25, s.y - H * 0.6);
      if (frac < 0.3) {
        ctx.moveTo(s.x + W * 0.3, s.y - 8);
        ctx.lineTo(s.x + W * 0.12, s.y - H * 0.5);
        ctx.lineTo(s.x + W * 0.3, s.y - H * 0.75);
      }
      ctx.stroke();
      ctx.restore();
    }

    // The archer on top — out of melee reach until the tower falls.
    if (this.hasShooter) {
      const ax = s.x + Math.sin(t * 1.2) * W * 0.12, ay = top - 18;
      ctx.fillStyle = '#6e4d1e';
      ctx.beginPath();
      ctx.ellipse(ax, ay - 6, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8dcc0'; // turban
      ctx.beginPath();
      ctx.ellipse(ax, ay - 15, 4.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d3b21'; // bow silhouette
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax + 8, ay - 8, 6, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      this._glowDot(ctx, ax + 2, ay - 8, 1.4, '#ffb347', 5);
    }

    // Silhouette path for elite/hit-flash overlays.
    const p = new Path2D();
    p.rect(s.x - W * 0.55, top - 18, W * 1.1, H + 18);
    return p;
  }

  // Obelisk: a glyph-carved sandstone needle.
  _renderObelisk(ctx, s, t) {
    const r = this.radius;
    const W = r * 1.7, H = 64;
    const top = s.y - H;

    this._shadow(ctx, s, r * 1.05);

    const p = new Path2D();
    p.moveTo(s.x - W * 0.42, s.y);
    p.lineTo(s.x - W * 0.2, top + 8);
    p.lineTo(s.x, top - 6); // pyramidion tip
    p.lineTo(s.x + W * 0.2, top + 8);
    p.lineTo(s.x + W * 0.42, s.y);
    p.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#cbb078', '#7d6238');
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(60, 40, 15, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke(p);

    // Glyph column: faint carved marks with a slow demonic pulse.
    ctx.save();
    ctx.fillStyle = `rgba(200, 90, 40, ${0.4 + Math.sin(t * 2) * 0.15})`;
    for (let i = 0; i < 4; i++) {
      const gy = top + 14 + i * 12;
      ctx.fillRect(s.x - 3, gy, 6, 3);
      if (i % 2) ctx.fillRect(s.x - 5, gy + 5, 4, 2);
      else ctx.fillRect(s.x + 1, gy + 5, 4, 2);
    }
    ctx.restore();
    return p;
  }
}

// Projectile ---------------------------------------------------------
export class Projectile extends Entity {
  constructor(x, y, vx, vy, damage, pierce = 0) {
    super(x, y, 5);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;
    this.life = 2; // seconds before despawn
    this._hit = new Set(); // enemies already struck (for piercing shots)
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
  // Void bolt from the crescent wand: an elongated diamond aligned to its
  // velocity with a fading trail — reads as directed intent, not a dot.
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const ang = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(ang);
    // Trail
    ctx.strokeStyle = 'rgba(80, 170, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-6, 0);
    ctx.stroke();
    // Shard body
    ctx.fillStyle = '#eaf7ff';
    ctx.shadowColor = '#3fc8ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-7, 0);
    ctx.lineTo(0, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// Crimson Boomerang (altar relic) -------------------------------------
// Shared painter: the projectile and the relic-on-the-altar draw the
// same spinning crimson disc, so the pickup telegraphs the weapon.
export function drawBoomerang(ctx, x, y, scale, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.shadowColor = '#ff2f4e';
  ctx.shadowBlur = 14 * scale;
  // Ring body
  ctx.strokeStyle = '#c11733';
  ctx.lineWidth = 5 * scale;
  ctx.beginPath();
  ctx.arc(0, 0, 10 * scale, 0, Math.PI * 2);
  ctx.stroke();
  // Three swept blades around the ring
  ctx.fillStyle = '#ff3b5c';
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(9 * scale, -2 * scale);
    ctx.quadraticCurveTo(17 * scale, -7 * scale, 20 * scale, 1 * scale);
    ctx.quadraticCurveTo(14 * scale, 1.5 * scale, 9 * scale, 3.5 * scale);
    ctx.closePath();
    ctx.fill();
  }
  // Hot core
  ctx.fillStyle = '#ffd9de';
  ctx.beginPath();
  ctx.arc(0, 0, 3.2 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Flies out `range`, then homes back to the player; pierces everything.
// Extends Projectile so Combat's existing hit/pierce loop handles damage
// (pierce = Infinity never exhausts; _hit dedupes per pass).
export class Boomerang extends Projectile {
  constructor(player, angle) {
    const cfg = CONFIG.weapons.boomerang;
    super(player.x, player.y,
          Math.cos(angle) * cfg.speed, Math.sin(angle) * cfg.speed,
          player.stats.damage * cfg.damageMul, Infinity);
    this.radius = cfg.radius;
    this.player = player;
    this.life = 99;                      // despawns on catch, not by timer
    this._outT = cfg.range / cfg.speed;  // seconds of outbound flight
    this.spin = 0;
  }

  update(dt) {
    if (this._outT > 0) {
      this._outT -= dt;
      if (this._outT <= 0) this._hit.clear(); // return pass hits again
    } else {
      const dx = this.player.x - this.x;
      const dy = this.player.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < this.player.radius + 8) { this.alive = false; return; } // caught
      const sp = CONFIG.weapons.boomerang.speed;
      this.vx = (dx / d) * sp;
      this.vy = (dy / d) * sp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += dt * 14;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    drawBoomerang(ctx, s.x, s.y, 1, this.spin);
  }
}

// Pickup (XP gems, drops) -------------------------------------------
export class Pickup extends Entity {
  constructor(x, y, kind, value) {
    super(x, y, 6);
    this.kind = kind;   // 'xp' | 'health' | ...
    this.value = value;
  }
  update(dt, player) {
    // Magnet: drift toward the player once inside their pickup radius.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < player.stats.pickupRadius) {
      const pull = 320;
      this.x += (dx / d) * pull * dt;
      this.y += (dy / d) * pull * dt;
    }
  }
  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const r = this.radius;
    // Cheap per-pickup phase from world position (no stored state needed).
    const t = performance.now() / 1000 + (this.x * 0.13 + this.y * 0.07);

    if (this.kind === 'xp') {
      // Soul flame: a pale-cyan teardrop that flickers and breathes.
      const fl = 1 + Math.sin(t * 9) * 0.18;
      ctx.save();
      ctx.fillStyle = '#7de8ff';
      ctx.shadowColor = '#00c8ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r * 1.7 * fl);                 // flame tip
      ctx.quadraticCurveTo(s.x + r, s.y - r * 0.4, s.x, s.y + r * 0.6);
      ctx.quadraticCurveTo(s.x - r, s.y - r * 0.4, s.x, s.y - r * 1.7 * fl);
      ctx.fill();
      // Hot core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y - r * 0.15, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (this.kind === 'gold') {
      // Gold coin: warm disc that squashes on one axis to fake a spin.
      const spin = 0.35 + Math.abs(Math.sin(t * 3)) * 0.65;
      ctx.save();
      ctx.fillStyle = '#ffd166';
      ctx.shadowColor = '#ffb020';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * spin, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      // Health: glowing crimson cross (gothic reliquary vibes).
      const a = r * 0.75, b = r * 1.9;
      ctx.save();
      ctx.fillStyle = '#ff5d6c';
      ctx.shadowColor = '#ff2440';
      ctx.shadowBlur = 7 + Math.sin(t * 5) * 2;
      ctx.beginPath();
      ctx.roundRect(s.x - a / 2, s.y - b / 2, a, b, 2);
      ctx.roundRect(s.x - b / 2, s.y - a / 2, b, a, 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// Spit: the spitter's venom glob — a hostile projectile riding the same
// world.hazards list (and Combat rules) as the dragon's fireballs.
export class Spit extends Entity {
  constructor(x, y, vx, vy, damage, color) {
    super(x, y, 7);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.life = 3;
    this.color = color; // optional override (tower arrows are sand-gold)
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const wob = Math.sin(performance.now() / 60 + this.x) * 0.15;
    ctx.save();
    ctx.fillStyle = this.color || '#b7f34d';
    ctx.shadowColor = this.color || '#8fd63a';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, this.radius * (0.85 + wob), this.radius * (0.85 - wob), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9ffb0';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(s.x - 1.5, s.y - 1.5, this.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Bandage shot: the mummy's pull attack. A wrapped fist flies down the
// telegraphed lane trailing a taut bandage back to the mummy; Combat
// reads `pull` on hit and reels the player in (systems.js).
export class Bandage extends Entity {
  constructor(mummy, ang, cfg) {
    super(mummy.x, mummy.y - mummy.radius, 11);
    this.mummy = mummy;
    this.vx = Math.cos(ang) * cfg.speed;
    this.vy = Math.sin(ang) * cfg.speed;
    this.damage = cfg.damage;
    this.pull = cfg.pullSpeed; // Combat: reel speed toward the mummy
    this.life = cfg.range / cfg.speed;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || !this.mummy.alive) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const m = camera.toScreen(this.mummy.x, this.mummy.y - this.mummy.radius);
    ctx.save();
    // The taut bandage back to the mummy — thin, slightly slack.
    ctx.strokeStyle = 'rgba(232, 222, 190, 0.9)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.quadraticCurveTo((m.x + s.x) / 2, (m.y + s.y) / 2 + 8, s.x, s.y);
    ctx.stroke();
    // Wrapped fist at the head.
    ctx.fillStyle = '#e8dcc0';
    ctx.shadowColor = '#cfc3a0';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 78, 52, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - 5, s.y - 2);
    ctx.lineTo(s.x + 5, s.y + 3);
    ctx.moveTo(s.x - 5, s.y + 3);
    ctx.lineTo(s.x + 5, s.y - 1);
    ctx.stroke();
    ctx.restore();
  }
}

// Blood puddle: scarab guts left on the floor. Rides the hazards list,
// but Combat reads `puddle`: it survives contact (no burst) and its bite
// is gated by the player's i-frames. game.js draws it on the floor plane.
export class BloodPuddle extends Entity {
  constructor(x, y, cfg) {
    super(x, y, cfg.radius);
    this.puddle = true;
    this.damage = cfg.damage;
    this.life = cfg.life;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.life) * 0.8; // fade out the last second
    ctx.fillStyle = '#6e0f14';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, this.radius * 1.25, this.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9c1a1a';
    ctx.beginPath();
    ctx.ellipse(s.x - 2, s.y - 2, this.radius * 0.75, this.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Death burst: a handful of pixel shards in the enemy's color that scatter,
// arc under gravity, and fade. Rides the floaters list (update/render API).
export class Burst {
  constructor(x, y, color) {
    this.color = color;
    this.maxLife = 0.45;
    this.life = this.maxLife;
    this.alive = true;
    this.parts = Array.from({ length: 7 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 140 * (0.4 + Math.random() * 0.6);
      return {
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40, // slight upward pop
        s: 2 + Math.random() * 3,
      };
    });
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt; // gravity
    }
  }

  render(ctx, camera) {
    ctx.save();
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    for (const p of this.parts) {
      const s = camera.toScreen(p.x, p.y);
      ctx.fillRect(s.x, s.y, p.s, p.s);
    }
    ctx.restore();
  }
}

// FloatingText (damage numbers, etc.) --------------------------------
// Pure VFX: a short-lived label that drifts up from a world point and
// fades out. No collision, no gameplay effect — game.js ticks it and
// culls it like any other entity, and renders it above everyone.
export class FloatingText {
  constructor(x, y, text, opts = {}) {
    this.x = x;
    this.y = y;
    this.text = String(text);
    this.color = opts.color ?? '#ffe66d';
    this.size = opts.size ?? 16;
    this.maxLife = opts.life ?? 0.7;
    this.life = this.maxLife;
    // Pop upward then ease off; small sideways scatter so stacked hits
    // on one enemy don't perfectly overlap.
    this.vy = opts.vy ?? -70;
    this.vx = opts.vx ?? (Math.random() * 28 - 14);
    this.alive = true;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 90 * dt; // gravity: rise decelerates, giving a little arc
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = this.life / this.maxLife;          // 1 -> 0 over lifetime
    const scale = 1 + (1 - t) * 0.15;            // slight grow as it fades
    ctx.save();
    ctx.globalAlpha = Math.max(0, t);
    ctx.font = `bold ${this.size * scale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Outline for legibility against any background.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(this.text, s.x, s.y);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, s.x, s.y);
    ctx.restore();
  }
}
