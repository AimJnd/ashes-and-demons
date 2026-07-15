/*
  boss.js — the wave-25 finale.
  - Dragon: the main boss. Flies in from off-screen, then loops a combat
    brain: chase -> firebreath (ranged, sweeping volley of fireballs) or
    claw swipe (melee, telegraphed). Enrages below 30% hp.
  - Fireball: hostile projectile (world.hazards). Combat resolves it
    against the player.
  - SwipeTelegraph / SwipeVFX: the warning arc before the claw lands and
    the slash streak when it does. Both live in world.floaters.

  The dragon deliberately quacks like an Enemy (hp/maxHp/radius/alive/
  damage/xp/flash/update/render) so Combat, weapons and the render loop
  treat it like any other enemy — no special cases in the hot paths.
*/

import { CONFIG } from './config.js';
import { Entity, FloatingText, Spit, Enemy, Bandage } from './entities.js';

const TAU = Math.PI * 2;

// Fireball (hostile projectile) ----------------------------------------
export class Fireball extends Entity {
  constructor(x, y, vx, vy, damage) {
    super(x, y, 9);
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.life = 3.5;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000 + (this.x * 0.11 + this.y * 0.07);
    const ang = Math.atan2(this.vy, this.vx);
    const r = this.radius;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(ang);
    const flick = 1 + Math.sin(t * 22) * 0.12;
    // Flame trail
    ctx.fillStyle = 'rgba(255, 110, 40, 0.35)';
    ctx.beginPath();
    ctx.moveTo(-r * 3.2 * flick, 0);
    ctx.quadraticCurveTo(-r * 1.4, r * 0.9, 0, r * 0.75);
    ctx.lineTo(0, -r * 0.75);
    ctx.quadraticCurveTo(-r * 1.4, -r * 0.9, -r * 3.2 * flick, 0);
    ctx.closePath();
    ctx.fill();
    // Core
    ctx.fillStyle = '#ff8c2e';
    ctx.shadowColor = '#ff6a1f';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, r * flick, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe8a8';
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.45, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// Claw swipe warning arc — tracks the dragon so the telegraph moves with
// it. Fades in over the windup, then the swipe itself replaces it.
export class SwipeTelegraph {
  constructor(dragon, angle, range, arc, windup) {
    this.dragon = dragon;
    this.angle = angle;
    this.range = range;
    this.arc = arc;
    this.maxLife = windup;
    this.life = windup;
    this.alive = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0 || !this.dragon.alive) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.dragon.x, this.dragon.y);
    const grow = 1 - this.life / this.maxLife; // 0 -> 1 over the windup
    ctx.save();
    ctx.globalAlpha = 0.10 + grow * 0.16;
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, this.range, this.angle - this.arc / 2, this.angle + this.arc / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5 + grow * 0.4;
    ctx.strokeStyle = '#ff5a3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.range, this.angle - this.arc / 2, this.angle + this.arc / 2);
    ctx.stroke();
    ctx.restore();
  }
}

// The claw slash streak when the swipe lands (same language as the
// player's SlashVFX, but heavier and ember-orange).
const SWIPE_LIFE = 0.25;

export class SwipeVFX {
  constructor(x, y, angle, range, arc) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.range = range;
    this.arc = arc;
    this.life = SWIPE_LIFE;
    this.alive = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = 1 - this.life / SWIPE_LIFE;
    const from = this.angle - this.arc / 2;
    const lead = from + this.arc * Math.min(1, t * 1.75);
    const fade = 1 - t;
    const R = this.range * 0.85;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [w, back, a, col] of [
      [16, 0.36, 0.14, '#ff5a3c'],
      [9,  0.22, 0.32, '#ff8c42'],
      [4,  0.11, 0.72, '#ffd8a8'],
    ]) {
      ctx.globalAlpha = a * fade;
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, Math.max(from, lead - this.arc * back), lead);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Dash telegraph: the strike lane painted from the serpent to its marked
// target while it coils. Sharpens over the windup, like SwipeTelegraph.
export class DashTelegraph {
  constructor(serpent, tx, ty, width, windup) {
    this.serpent = serpent;
    this.tx = tx;
    this.ty = ty;
    this.width = width;
    this.maxLife = windup;
    this.life = windup;
    this.alive = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0 || !this.serpent.alive) this.alive = false;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.serpent.x, this.serpent.y);
    const e = camera.toScreen(this.tx, this.ty);
    const grow = 1 - this.life / this.maxLife;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.10 + grow * 0.18;
    ctx.strokeStyle = '#8fd63a';
    ctx.lineWidth = this.width;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
    ctx.globalAlpha = 0.45 + grow * 0.45;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
    // Target ring where the head will land
    ctx.beginPath();
    ctx.arc(e.x, e.y, 26 + grow * 8, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// The Serpent (Stage 2 boss) ------------------------------------------------
// A giant venom snake. Slithers after the player, spits glob fans at
// range, and lunges: a telegraphed dash straight to the marked spot,
// then an instant snap back to where it coiled. Quacks like an Enemy
// (same duck-type contract as the Dragon above).
export class Serpent extends Entity {
  constructor(x, y) {
    const cfg = CONFIG.boss2;
    super(x, y, cfg.radius);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.contactDamage;
    this.xp = cfg.xp;
    this.isBoss = true;
    this.flip = false;
    this.state = 'arrive';   // arrive -> combat
    this._hitFlash = 0;
    this._venomCd = 0;
    this._dashCd = 0;
    this._windup = 0;        // > 0 while coiling for the lunge
    this._dash = null;       // { t, dur, x0, y0, tx, ty, hit } mid-lunge
    this._trail = [];        // recent head positions; the body follows them
    this._spitFlash = 0;     // maw glow right after spitting
  }

  flash() { this._hitFlash = 0.08; }

  _remember() {
    const last = this._trail[0];
    if (!last || (last[0] - this.x) ** 2 + (last[1] - this.y) ** 2 > 36) {
      this._trail.unshift([this.x, this.y]);
      if (this._trail.length > 40) this._trail.pop();
    }
  }

  update(dt, player, world) {
    if (this._hitFlash > 0) this._hitFlash -= dt;
    if (this._spitFlash > 0) this._spitFlash -= dt;
    const cfg = CONFIG.boss2;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;

    // Slither in, then engage.
    if (this.state === 'arrive') {
      this.x += (dx / d) * cfg.arriveSpeed * dt;
      this.y += (dy / d) * cfg.arriveSpeed * dt;
      this._remember();
      if (d < 420) {
        this.state = 'combat';
        this._venomCd = 1.2;
        this._dashCd = 2.5;
      }
      return;
    }

    this._venomCd -= dt;
    this._dashCd -= dt;

    // Mid-lunge: fly down the lane, bite once if the player is caught,
    // then snap back to the coil position the moment the head lands.
    if (this._dash) {
      const D = this._dash;
      D.t += dt;
      const f = Math.min(1, D.t / D.dur);
      this.x = D.x0 + (D.tx - D.x0) * f;
      this.y = D.y0 + (D.ty - D.y0) * f;
      const hd = Math.hypot(player.x - this.x, player.y - this.y);
      if (!D.hit && hd < this.radius + player.radius + 6) {
        D.hit = true;
        if (player.takeDamage(cfg.dash.damage)) {
          player._hurtCd = 0.6;
          world.floaters.push(new FloatingText(
            player.x, player.y - player.radius * 1.6,
            Math.round(cfg.dash.damage), { color: '#ff5555', size: 20 }
          ));
        }
      }
      if (f >= 1) {
        // The snap back — the whole point of the move: strike and recoil.
        this.x = D.x0;
        this.y = D.y0;
        this._trail.length = 0; // body reforms at the coil, not mid-lane
        this._dash = null;
        this._dashCd = cfg.dash.cooldown;
      }
      return;
    }

    // Coiling: rooted while the telegraph sharpens, then loose the lunge.
    if (this._windup > 0) {
      this._windup -= dt;
      if (this._windup <= 0) {
        this._dash = {
          t: 0,
          dur: Math.hypot(this._dashTx - this.x, this._dashTy - this.y) / cfg.dash.speed,
          x0: this.x, y0: this.y,
          tx: this._dashTx, ty: this._dashTy,
          hit: false,
        };
      }
      return;
    }

    // Pick the next action.
    if (this._dashCd <= 0 && d <= cfg.dash.range && d > 120) {
      // Mark the player's CURRENT spot — dodge by not being there.
      this._dashTx = player.x;
      this._dashTy = player.y;
      this._windup = cfg.dash.windup;
      world.floaters.push(new DashTelegraph(
        this, this._dashTx, this._dashTy, this.radius * 1.6, cfg.dash.windup
      ));
    } else if (this._venomCd <= 0 && d <= cfg.venom.range) {
      const v = cfg.venom;
      const aim = Math.atan2(dy, dx);
      for (let i = 0; i < v.count; i++) {
        const a = aim + v.spread * (i / (v.count - 1) - 0.5);
        world.hazards.push(new Spit(
          this.x + Math.cos(a) * this.radius * 0.9,
          this.y + Math.sin(a) * this.radius * 0.9,
          Math.cos(a) * v.speed, Math.sin(a) * v.speed,
          v.damage
        ));
      }
      this._venomCd = v.cooldown;
      this._spitFlash = 0.35;
    } else {
      // Slither: chase with a sideways sway so the body S-curves.
      const t = performance.now() / 1000;
      const px = -dy / d, py = dx / d; // perpendicular
      const sway = Math.sin(t * 3.2) * 60;
      this.x += ((dx / d) * cfg.speed + px * sway) * dt;
      this.y += ((dy / d) * cfg.speed + py * sway) * dt;
    }
    this.x = Math.max(40, Math.min(CONFIG.worldWidth - 40, this.x));
    this.y = Math.max(40, Math.min(CONFIG.worldHeight - 40, this.y));
    this._remember();
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000;
    const r = this.radius;
    const coiling = this._windup > 0;
    const spitting = this._spitFlash > 0;

    // Ground shadow under the head
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + r * 0.35, r * 1.4, r * 0.5, 0, 0, TAU); ctx.fill();

    // Body: tapered segments strung along the recorded trail.
    const segs = 14;
    for (let i = segs - 1; i >= 0; i--) {
      const p = this._trail[Math.min(this._trail.length - 1, i * 2 + 2)];
      if (!p) continue;
      const b = camera.toScreen(p[0], p[1]);
      const br = r * (0.85 - (i / segs) * 0.55);
      ctx.fillStyle = i % 2 ? '#1d3a22' : '#26492c';
      ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(143, 214, 58, 0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Pale belly stripe reads as scales
      ctx.fillStyle = 'rgba(200, 220, 150, 0.12)';
      ctx.beginPath(); ctx.arc(b.x, b.y + br * 0.3, br * 0.55, 0, TAU); ctx.fill();
    }

    // Head: broad viper wedge, reared up slightly while coiling.
    const hr = r * (coiling ? 1.12 : 1);
    const head = new Path2D();
    head.moveTo(s.x - hr, s.y);
    head.quadraticCurveTo(s.x - hr * 0.9, s.y - hr * 0.95, s.x, s.y - hr);
    head.quadraticCurveTo(s.x + hr * 0.9, s.y - hr * 0.95, s.x + hr, s.y);
    head.quadraticCurveTo(s.x + hr * 0.75, s.y + hr * 0.9, s.x, s.y + hr * 1.05);
    head.quadraticCurveTo(s.x - hr * 0.75, s.y + hr * 0.9, s.x - hr, s.y);
    head.closePath();
    const g = ctx.createLinearGradient(s.x, s.y - hr, s.x, s.y + hr);
    g.addColorStop(0, '#2e5a36');
    g.addColorStop(1, '#152b19');
    ctx.fillStyle = g;
    ctx.fill(head);
    ctx.strokeStyle = 'rgba(143, 214, 58, 0.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke(head);

    // Brow scales
    ctx.strokeStyle = 'rgba(200, 230, 150, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - hr * 0.55, s.y - hr * 0.45);
    ctx.quadraticCurveTo(s.x, s.y - hr * 0.7, s.x + hr * 0.55, s.y - hr * 0.45);
    ctx.stroke();

    // Eyes: venom-yellow slits that flare while coiling.
    ctx.save();
    ctx.fillStyle = coiling ? '#ffe24a' : '#d6e84a';
    ctx.shadowColor = '#c8e83a';
    ctx.shadowBlur = coiling ? 14 : 8;
    for (const dd of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + dd * hr * 0.42, s.y - hr * 0.18, hr * 0.13, hr * 0.22, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#101a0c';
    for (const dd of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + dd * hr * 0.42, s.y - hr * 0.18, hr * 0.04, hr * 0.18, 0, 0, TAU);
      ctx.fill();
    }

    // Maw: glows green while spitting; fangs below.
    ctx.save();
    ctx.fillStyle = spitting ? '#c9f45a' : '#3d6b2c';
    ctx.shadowColor = '#8fd63a';
    ctx.shadowBlur = spitting ? 16 : 5;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + hr * 0.55, hr * 0.4, hr * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#e8ddd0';
    for (const o of [-0.28, 0.28]) {
      ctx.beginPath();
      ctx.moveTo(s.x + hr * o - 3, s.y + hr * 0.5);
      ctx.lineTo(s.x + hr * o, s.y + hr * 0.78);
      ctx.lineTo(s.x + hr * o + 3, s.y + hr * 0.5);
      ctx.closePath(); ctx.fill();
    }

    // Forked tongue flick
    if (Math.sin(t * 2.6) > 0.55 && !coiling) {
      ctx.strokeStyle = '#ff5a6e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + hr * 0.7);
      ctx.lineTo(s.x, s.y + hr * 1.15);
      ctx.moveTo(s.x, s.y + hr * 1.15);
      ctx.lineTo(s.x - 4, s.y + hr * 1.3);
      ctx.moveTo(s.x, s.y + hr * 1.15);
      ctx.lineTo(s.x + 4, s.y + hr * 1.3);
      ctx.stroke();
    }

    // Hit flash over the head mass
    if (this._hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / 0.08) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fill(head);
      ctx.restore();
    }

    // Boss HP bar (same language as the Dragon's)
    const bw = r * 3.4, bh = 7;
    const bx = s.x - bw / 2, by = s.y - r * 2.4;
    const frac = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath(); ctx.roundRect(bx - 1.5, by - 1.5, bw + 3, bh + 3, 4); ctx.fill();
    ctx.fillStyle = '#0e2a12';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill();
    ctx.fillStyle = '#8fd63a';
    ctx.beginPath(); ctx.roundRect(bx, by, bw * frac, bh, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(180, 240, 100, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  }
}

// The Mummy King (Stage 3 boss) --------------------------------------------
// A colossal mummy. Shambles after the player, reels them in with the
// telegraphed bandage shot, and raises scarab broods every few seconds.
// At half hp it goes behind a shield (invincible), whips up a permanent
// sandstorm (game.js halves sight; weapons.js can't aim past it), raises
// a 20-scarab horde — the shield holds until every scarab on the field
// is dead — and from then on also hurls big black orbs.
export class MummyKing extends Entity {
  constructor(x, y) {
    const cfg = CONFIG.boss3;
    super(x, y, cfg.radius);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.contactDamage;
    this.xp = cfg.xp;
    this.isBoss = true;
    this.invulnerable = false; // true while the storm shield holds
    this.state = 'arrive';     // arrive -> combat
    this.flip = false;
    this._hitFlash = 0;
    this._summonCd = 2;        // the first brood arrives shortly after it does
    this._pullCd = 3;
    this._bWindup = 0;         // > 0 while the bandage lane is telegraphed
    this._shotCd = 0;
    this._stormed = false;     // half-hp phase fired (once, permanent storm)
  }

  flash() { this._hitFlash = 0.08; }

  _raiseScarabs(world, n) {
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n + Math.random() * 0.4;
      const e = new Enemy(
        this.x + Math.cos(a) * (this.radius + 60),
        this.y + Math.sin(a) * (this.radius + 60),
        'scarab'
      );
      world.enemies.push(e);
    }
  }

  update(dt, player, world) {
    if (this._hitFlash > 0) this._hitFlash -= dt;
    const cfg = CONFIG.boss3;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;

    if (this.state === 'arrive') {
      this.x += (dx / d) * cfg.arriveSpeed * dt;
      this.y += (dy / d) * cfg.arriveSpeed * dt;
      if (d < 480) this.state = 'combat';
      return;
    }

    // Half hp: shield up, sandstorm rises, the horde crawls out.
    if (!this._stormed && this.hp <= this.maxHp * cfg.shieldAt) {
      this._stormed = true;
      this.invulnerable = true;
      world.sandstorm = true;
      this._raiseScarabs(world, cfg.summon.burst);
      world.flybyRoar = true; // roar + camera rumble (game.js)
      world.floaters.push(new FloatingText(
        this.x, this.y - this.radius * 2.2, 'THE SANDS RISE...',
        { color: '#e0c37a', size: 22, life: 2.5 }
      ));
    }

    // The shield holds until every scarab on the field is dead — and no
    // new broods are raised while it does.
    if (this.invulnerable &&
        !world.enemies.some((e) => e.alive && e.type === 'scarab')) {
      this.invulnerable = false;
      this._summonCd = cfg.summon.interval;
    }

    if (!this.invulnerable) {
      this._summonCd -= dt;
      if (this._summonCd <= 0) {
        this._summonCd = cfg.summon.interval;
        this._raiseScarabs(world, cfg.summon.count);
      }
    }

    // Black orbs, storm phase onward — bigger and meaner than any spit.
    if (this._stormed) {
      this._shotCd -= dt;
      if (this._shotCd <= 0 && d < cfg.shot.range) {
        this._shotCd = cfg.shot.cooldown;
        const oy = this.y - this.radius; // thrown from the wrapped chest
        const ax = dx, ay = player.y - oy;
        const ad = Math.hypot(ax, ay) || 1;
        const s = new Spit(
          this.x, oy,
          (ax / ad) * cfg.shot.speed, (ay / ad) * cfg.shot.speed,
          cfg.shot.damage, '#1a1420'
        );
        s.radius = cfg.shot.radius;
        world.hazards.push(s);
      }
    }

    // Bandage shot: same telegraph contract as the small mummies.
    const P = cfg.pull;
    if (this._bWindup > 0) {
      this._bWindup -= dt; // rooted while the lane sharpens
      if (this._bWindup <= 0) world.hazards.push(new Bandage(this, this._bAng, P));
      return;
    }
    this._pullCd -= dt;
    if (this._pullCd <= 0 && d < P.range && d > 150) {
      this._pullCd = P.cooldown;
      this._bWindup = P.windup;
      this._bAng = Math.atan2(player.y - (this.y - this.radius), dx);
      return;
    }

    // Shamble after the player.
    this.x += (dx / d) * cfg.speed * dt;
    this.y += (dy / d) * cfg.speed * dt;
    this.x = Math.max(60, Math.min(CONFIG.worldWidth - 60, this.x));
    this.y = Math.max(60, Math.min(CONFIG.worldHeight - 60, this.y));
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000;
    const r = this.radius;
    const sway = Math.sin(t * 1.2) * r * 0.04;
    const h = r * 2.6, w = r * 1.5;
    const top = s.y - h;

    // Bandage lane telegraph, under everything.
    if (this._bWindup > 0) {
      const P = CONFIG.boss3.pull;
      const urgency = 1 - this._bWindup / P.windup;
      ctx.save();
      ctx.strokeStyle = `rgba(240, 230, 200, ${0.25 + urgency * 0.45})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 10]);
      ctx.lineDashOffset = -t * 60;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + Math.cos(this._bAng) * P.range,
                 s.y - r + Math.sin(this._bAng) * P.range);
      ctx.stroke();
      ctx.restore();
    }

    // Ground shadow.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 6, r * 1.3, r * 0.45, 0, 0, TAU);
    ctx.fill();

    // Body: the small mummy's slab silhouette, scaled to a colossus.
    const p = new Path2D();
    p.moveTo(s.x - w * 0.72 + sway, s.y);
    p.quadraticCurveTo(s.x - w * 0.95 + sway, top + h * 0.45, s.x - w * 0.5 + sway, top + h * 0.18);
    p.quadraticCurveTo(s.x + sway * 2, top - r * 0.25, s.x + w * 0.5 + sway, top + h * 0.18);
    p.quadraticCurveTo(s.x + w * 0.95 + sway, top + h * 0.45, s.x + w * 0.72 + sway, s.y);
    p.closePath();
    const g = ctx.createLinearGradient(s.x, top, s.x, s.y);
    g.addColorStop(0, '#ddd0aa');
    g.addColorStop(1, '#6e6349');
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(60, 50, 30, 0.7)';
    ctx.lineWidth = 3;
    ctx.stroke(p);

    // Wrap passes.
    ctx.strokeStyle = 'rgba(90, 78, 52, 0.55)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const wy = top + h * (0.12 + i * 0.11);
      const ww = w * (0.6 + Math.sin(i * 2.7) * 0.18);
      ctx.beginPath();
      ctx.moveTo(s.x - ww + sway, wy);
      ctx.quadraticCurveTo(s.x + sway, wy + 6, s.x + ww + sway, wy - 3);
      ctx.stroke();
    }

    // Loose strips whipping in its own storm.
    ctx.strokeStyle = '#c9bd97';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const [ax, ay, len, ph] of [[-0.65, 0.2, 0.6, 0], [0.6, 0.5, 0.5, 2.1], [-0.3, 0.75, 0.4, 4.2]]) {
      const bx = s.x + w * ax + sway, by = top + h * ay;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + Math.sin(t * 2.6 + ph) * r * 0.3, by + r * len,
                           bx + Math.sin(t * 1.9 + ph) * r * 0.5, by + r * len * 1.9);
      ctx.stroke();
    }

    // Pharaoh headdress: gold-and-lapis nemes over the eye slit.
    ctx.fillStyle = '#d9b23c';
    ctx.beginPath();
    ctx.moveTo(s.x - w * 0.55 + sway, top + h * 0.13);
    ctx.lineTo(s.x + sway, top - r * 0.34);
    ctx.lineTo(s.x + w * 0.55 + sway, top + h * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#274a8a';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Eye slit with burning gold eyes.
    ctx.fillStyle = '#241c0e';
    ctx.fillRect(s.x - w * 0.42 + sway, top + h * 0.15, w * 0.84, r * 0.34);
    ctx.save();
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ffb020';
    ctx.shadowBlur = 12;
    for (const dxr of [-0.3, 0.3]) {
      ctx.beginPath();
      ctx.arc(s.x + w * dxr + sway, top + h * 0.15 + r * 0.17, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Storm shield: a humming sand-gold bubble while the horde lives.
    if (this.invulnerable) {
      ctx.save();
      ctx.strokeStyle = `rgba(224, 195, 122, ${0.55 + Math.sin(t * 6) * 0.2})`;
      ctx.fillStyle = 'rgba(224, 195, 122, 0.08)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y - h * 0.5, r * 1.75, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (this._hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / 0.08) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fill(p);
      ctx.restore();
    }

    // Boss HP bar (same language as the Dragon's).
    const bw = r * 3.4, bh = 7;
    const bx = s.x - bw / 2, by = top - 22;
    const frac = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath(); ctx.roundRect(bx - 1.5, by - 1.5, bw + 3, bh + 3, 4); ctx.fill();
    ctx.fillStyle = '#3a2f18';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill();
    ctx.fillStyle = '#e0c37a';
    ctx.beginPath(); ctx.roundRect(bx, by, bw * frac, bh, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 226, 150, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  }
}

// The Dragon --------------------------------------------------------------
export class Dragon extends Entity {
  // Pass flyby: { vx, vy } for the strafing cameo (waves 5, 10, ...): it
  // flies that straight line instead of running the combat brain, spits
  // fire at the player, and can't be hurt (Combat guards on invulnerable).
  constructor(x, y, flyby = null) {
    const cfg = CONFIG.boss;
    super(x, y, cfg.radius);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.contactDamage;
    this.xp = cfg.xp;
    this.isBoss = true;      // Separation: shoves everyone, shoved by no one
    this.flyby = flyby ? { ...flyby, trampled: new Set() } : null;
    this.invulnerable = !!flyby;
    this.state = 'arrive';   // arrive -> combat
    this.flip = false;
    this._hitFlash = 0;
    this._fireCd = 0;
    this._meleeCd = 0;
    this._windup = 0;        // > 0 while telegraphing the claw swipe
    this._swipeAng = 0;
    this._breath = null;     // { t, emit, a0, a1 } while breathing fire
  }

  flash() { this._hitFlash = 0.08; }

  get enraged() { return this.hp <= this.maxHp * CONFIG.boss.enrageAt; }

  update(dt, player, world) {
    if (this._hitFlash > 0) this._hitFlash -= dt;
    const cfg = CONFIG.boss;

    // Fly-by pass: hold the straight line (no clamp — it exits the arena
    // and despawns), lobbing fireballs at the player the whole way.
    // Contact damage and mob trampling are resolved by Combat.
    if (this.flyby) {
      this.x += this.flyby.vx * dt;
      this.y += this.flyby.vy * dt;
      this.flip = this.flyby.vx < 0;
      this._fireCd -= dt;
      if (this._fireCd <= 0) {
        this._fireCd = cfg.flyby.fireInterval;
        const a = Math.atan2(player.y - this.y, player.x - this.x);
        world.hazards.push(new Fireball(
          this.x + Math.cos(a) * this.radius * 0.8,
          this.y - this.radius * 0.6 + Math.sin(a) * this.radius * 0.8,
          Math.cos(a) * cfg.fire.speed, Math.sin(a) * cfg.fire.speed,
          cfg.fire.damage
        ));
      }
      if (this.x < -200 || this.x > CONFIG.worldWidth + 200 ||
          this.y < -200 || this.y > CONFIG.worldHeight + 200) {
        this.alive = false; // gone — no drops, no gate, no kill credit
      }
      return;
    }

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (dx < 0) this.flip = true;
    else if (dx > 0) this.flip = false;

    // Fly-in: beeline for the player, then engage.
    if (this.state === 'arrive') {
      this.x += (dx / d) * cfg.arriveSpeed * dt;
      this.y += (dy / d) * cfg.arriveSpeed * dt;
      if (d < 420) {
        this.state = 'combat';
        this._fireCd = 1.2;   // short grace before the first breath
        this._meleeCd = 1.5;
      }
      return;
    }

    this._fireCd -= dt;
    this._meleeCd -= dt;

    // Firebreath in progress: sweep the volley across the arc while
    // drifting slowly — the player has to move THROUGH the sweep.
    if (this._breath) {
      const b = this._breath;
      const f = cfg.fire;
      b.t += dt;
      b.emit -= dt;
      while (b.emit <= 0) {
        b.emit += f.interval;
        const frac = Math.min(1, b.t / f.duration);
        const a = b.a0 + (b.a1 - b.a0) * frac;
        world.hazards.push(new Fireball(
          this.x + Math.cos(a) * this.radius * 0.8,
          this.y - this.radius * 0.6 + Math.sin(a) * this.radius * 0.8,
          Math.cos(a) * f.speed, Math.sin(a) * f.speed,
          f.damage
        ));
      }
      if (b.t >= f.duration) this._breath = null;
      this.x += (dx / d) * cfg.speed * 0.25 * dt;
      this.y += (dy / d) * cfg.speed * 0.25 * dt;
      this._clamp();
      return;
    }

    // Claw swipe windup: rooted; resolves when the timer runs out.
    if (this._windup > 0) {
      this._windup -= dt;
      if (this._windup <= 0) {
        const m = cfg.melee;
        const ang = Math.atan2(dy, dx);
        let diff = ang - this._swipeAng;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (d <= m.range + player.radius && Math.abs(diff) <= m.arc / 2 &&
            player.takeDamage(m.damage)) {
          player._hurtCd = 0.6;
          world.floaters.push(new FloatingText(
            player.x, player.y - player.radius * 1.6,
            Math.round(m.damage), { color: '#ff5555', size: 20 }
          ));
        }
        world.floaters.push(new SwipeVFX(this.x, this.y, this._swipeAng, m.range, m.arc));
        this._meleeCd = m.cooldown * (this.enraged ? 0.7 : 1);
      }
      return;
    }

    // Pick the next action.
    if (d <= cfg.melee.range * 0.85 && this._meleeCd <= 0) {
      this._windup = cfg.melee.windup;
      this._swipeAng = Math.atan2(dy, dx);
      world.floaters.push(new SwipeTelegraph(
        this, this._swipeAng, cfg.melee.range, cfg.melee.arc, cfg.melee.windup
      ));
    } else if (this._fireCd <= 0 && d <= cfg.fire.range) {
      const aim = Math.atan2(dy, dx);
      const half = cfg.fire.sweep / 2;
      // Alternate sweep direction so it can't be dodged on autopilot.
      const flip = Math.random() < 0.5;
      this._breath = {
        t: 0, emit: 0,
        a0: aim + (flip ? half : -half),
        a1: aim + (flip ? -half : half),
      };
      this._fireCd = cfg.fire.cooldown * (this.enraged ? 0.55 : 1);
    } else {
      // Chase. The dragon is immune to the Chrono Field — it's the boss.
      const sp = cfg.speed * (this.enraged ? 1.35 : 1);
      this.x += (dx / d) * sp * dt;
      this.y += (dy / d) * sp * dt;
    }
    this._clamp();
  }

  _clamp() {
    this.x = Math.max(40, Math.min(CONFIG.worldWidth - 40, this.x));
    this.y = Math.max(40, Math.min(CONFIG.worldHeight - 40, this.y));
  }

  // Render (design iterated against rendered previews) --------------------
  _vgrad(ctx, x, y0, y1, c0, c1) {
    const g = ctx.createLinearGradient(x, y0, x, y1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  }

  render(ctx, camera) {
    const s = camera.toScreen(this.x, this.y);
    const t = performance.now() / 1000;
    const r = this.radius;
    const dir = this.flip ? -1 : 1;
    const breathing = this._breath !== null || this._windup > 0;
    const flap = Math.sin(t * (this.enraged ? 3.2 : 2.2));
    const hover = Math.sin(t * 1.6) * r * 0.06;
    const H = r * 2.9;
    const top = s.y - H + hover;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, r * 1.5, r * 0.5, 0, 0, TAU); ctx.fill();

    // Wings (behind body)
    for (const d of [-1, 1]) {
      const shx = s.x + d * r * 0.5, shy = top + H * 0.34;
      const span = r * (2.4 + flap * 0.25);
      const lift = r * (1.1 + flap * 0.45);
      const tipx = shx + d * span, tipy = shy - lift;
      const wing = new Path2D();
      wing.moveTo(shx, shy);
      wing.quadraticCurveTo(shx + d * span * 0.45, shy - lift * 1.15, tipx, tipy);
      wing.quadraticCurveTo(shx + d * span * 0.86, shy - lift * 0.1, shx + d * span * 0.72, shy + r * 0.55);
      wing.quadraticCurveTo(shx + d * span * 0.55, shy + r * 0.28, shx + d * span * 0.4, shy + r * 0.75);
      wing.quadraticCurveTo(shx + d * span * 0.25, shy + r * 0.45, shx + d * r * 0.25, shy + r * 0.7);
      wing.closePath();
      ctx.fillStyle = this._vgrad(ctx, shx, tipy, shy + r * 0.8, '#33121c', '#150910');
      ctx.fill(wing);
      ctx.strokeStyle = 'rgba(255, 110, 50, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.stroke(wing);
      ctx.strokeStyle = 'rgba(255, 110, 50, 0.28)';
      ctx.lineWidth = 1.5;
      for (const f of [0.72, 0.4]) {
        ctx.beginPath();
        ctx.moveTo(shx + d * r * 0.2, shy + r * 0.1);
        ctx.quadraticCurveTo(shx + d * span * f * 0.7, shy - lift * 0.5 * f,
                             shx + d * span * f, shy + r * (f > 0.5 ? 0.55 : 0.75) - 2);
        ctx.stroke();
      }
    }

    // Tail with spade tip
    const twx = s.x - dir * r * 1.9, twy = s.y - r * 0.25 + Math.sin(t * 1.9) * 4;
    ctx.strokeStyle = '#1c0f16';
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - dir * r * 0.2, s.y - r * 0.6);
    ctx.quadraticCurveTo(s.x - dir * r * 1.2, s.y + r * 0.15, twx, twy);
    ctx.stroke();
    const spade = new Path2D();
    spade.moveTo(twx - dir * r * 0.5, twy);
    spade.lineTo(twx + dir * r * 0.1, twy - r * 0.32);
    spade.lineTo(twx - dir * r * 0.05, twy);
    spade.lineTo(twx + dir * r * 0.1, twy + r * 0.32);
    spade.closePath();
    ctx.fillStyle = '#241019';
    ctx.fill(spade);
    ctx.strokeStyle = 'rgba(255, 110, 50, 0.5)'; ctx.lineWidth = 1.5; ctx.stroke(spade);

    // Legs / talons
    for (const d of [-1, 1]) {
      ctx.fillStyle = '#1a0d14';
      ctx.beginPath();
      ctx.ellipse(s.x + d * r * 0.55, s.y - r * 0.28, r * 0.32, r * 0.42, d * 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 110, 50, 0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#cbb9a4';
      for (const o of [-0.16, 0, 0.16]) {
        ctx.beginPath();
        ctx.moveTo(s.x + d * r * (0.45 + o) - 3, s.y - r * 0.05);
        ctx.lineTo(s.x + d * r * (0.45 + o), s.y + r * 0.12);
        ctx.lineTo(s.x + d * r * (0.45 + o) + 3, s.y - r * 0.05);
        ctx.closePath(); ctx.fill();
      }
    }

    // Body
    const body = new Path2D();
    body.moveTo(s.x - r * 0.72, s.y - r * 0.3);
    body.quadraticCurveTo(s.x - r * 0.95, top + H * 0.42, s.x - r * 0.62, top + H * 0.30);
    body.quadraticCurveTo(s.x - r * 0.35, top + H * 0.18, s.x - r * 0.22, top + H * 0.12);
    body.lineTo(s.x + r * 0.22, top + H * 0.12);
    body.quadraticCurveTo(s.x + r * 0.35, top + H * 0.18, s.x + r * 0.62, top + H * 0.30);
    body.quadraticCurveTo(s.x + r * 0.95, top + H * 0.42, s.x + r * 0.72, s.y - r * 0.3);
    body.quadraticCurveTo(s.x, s.y - r * 0.05, s.x - r * 0.72, s.y - r * 0.3);
    body.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, top, s.y, '#2c1a26', '#120a10');
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(255, 120, 60, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke(body);

    // Chest plates
    ctx.strokeStyle = 'rgba(210, 160, 130, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const py = top + H * (0.42 + i * 0.13);
      const pw = r * (0.5 - i * 0.06);
      ctx.beginPath();
      ctx.moveTo(s.x - pw, py);
      ctx.quadraticCurveTo(s.x, py + r * 0.14, s.x + pw, py);
      ctx.stroke();
    }

    // Molten chest crack — flares while attacking / enraged
    ctx.save();
    ctx.strokeStyle = '#ff7b2e';
    ctx.shadowColor = '#ff7b2e';
    ctx.shadowBlur = breathing || this.enraged ? 14 : 8;
    ctx.globalAlpha = (breathing || this.enraged ? 0.95 : 0.65) + Math.sin(t * 4) * 0.15;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.05, top + H * 0.34);
    ctx.lineTo(s.x + r * 0.12, top + H * 0.48);
    ctx.lineTo(s.x - r * 0.08, top + H * 0.60);
    ctx.lineTo(s.x + r * 0.06, top + H * 0.72);
    ctx.stroke();
    ctx.restore();

    // Head: horns behind skull
    const hy = top + H * 0.02;
    const hw = r * 0.72;
    for (const d of [-1, 1]) {
      const bx = s.x + d * hw * 0.55, by = hy + r * 0.08;
      const horn = new Path2D();
      horn.moveTo(bx, by + r * 0.14);
      horn.quadraticCurveTo(bx + d * r * 0.85, by - r * 0.05, bx + d * r * 0.72, by - r * 0.85);
      horn.quadraticCurveTo(bx + d * r * 0.42, by - r * 0.42, bx - d * r * 0.05, by - r * 0.1);
      horn.closePath();
      ctx.fillStyle = '#cbb9a4';
      ctx.fill(horn);
      ctx.strokeStyle = '#3a241c'; ctx.lineWidth = 2; ctx.stroke(horn);
    }
    const head = new Path2D();
    head.moveTo(s.x - hw * 0.62, hy - r * 0.05);
    head.quadraticCurveTo(s.x, hy - r * 0.5, s.x + hw * 0.62, hy - r * 0.05);
    head.lineTo(s.x + hw * 0.45, hy + r * 0.34);
    head.quadraticCurveTo(s.x + hw * 0.2, hy + r * 0.62, s.x, hy + r * 0.66);
    head.quadraticCurveTo(s.x - hw * 0.2, hy + r * 0.62, s.x - hw * 0.45, hy + r * 0.34);
    head.closePath();
    ctx.fillStyle = this._vgrad(ctx, s.x, hy - r * 0.5, hy + r * 0.66, '#31202c', '#180d14');
    ctx.fill(head);
    ctx.strokeStyle = 'rgba(255, 120, 60, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke(head);

    // Maw glow — blazes during attacks
    ctx.save();
    ctx.fillStyle = breathing ? '#ffd23e' : '#ff5a1f';
    ctx.shadowColor = '#ff6a1f';
    ctx.shadowBlur = breathing ? 16 : 7;
    ctx.globalAlpha = breathing ? 1 : 0.8;
    ctx.beginPath();
    ctx.ellipse(s.x, hy + r * 0.46, hw * 0.28, r * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Fangs
    ctx.fillStyle = '#e8ddd0';
    for (const o of [-0.24, -0.08, 0.08, 0.24]) {
      ctx.beginPath();
      ctx.moveTo(s.x + hw * o - 2.5, hy + r * 0.32);
      ctx.lineTo(s.x + hw * o, hy + r * 0.5);
      ctx.lineTo(s.x + hw * o + 2.5, hy + r * 0.32);
      ctx.closePath(); ctx.fill();
    }

    // Eyes under heavy brow ridges
    ctx.save();
    ctx.fillStyle = '#ffb347';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 10;
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s.x + d * hw * 0.3, hy + r * 0.02, r * 0.11, r * 0.05, d * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#0c0609';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s.x + d * hw * 0.48, hy - r * 0.16);
      ctx.lineTo(s.x + d * hw * 0.14, hy - r * 0.02);
      ctx.stroke();
    }

    // Hit flash over the main masses
    if (this._hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (this._hitFlash / 0.08) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fill(body);
      ctx.fill(head);
      ctx.restore();
    }

    // Boss HP bar above everything (not on fly-bys — you can't hurt those)
    if (this.flyby) return;
    const bw = r * 3.4, bh = 7;
    const bx = s.x - bw / 2, by = top - r * 1.35;
    const frac = Math.max(0, this.hp / this.maxHp);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath(); ctx.roundRect(bx - 1.5, by - 1.5, bw + 3, bh + 3, 4); ctx.fill();
    ctx.fillStyle = '#3a0d0d';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill();
    ctx.fillStyle = this.enraged ? '#ffd23e' : '#ff5a3c';
    ctx.beginPath(); ctx.roundRect(bx, by, bw * frac, bh, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 140, 80, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  }
}
