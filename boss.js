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
import { Entity, FloatingText } from './entities.js';

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

// The Dragon --------------------------------------------------------------
export class Dragon extends Entity {
  constructor(x, y) {
    const cfg = CONFIG.boss;
    super(x, y, cfg.radius);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.contactDamage;
    this.xp = cfg.xp;
    this.isBoss = true;
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
        if (d <= m.range + player.radius && Math.abs(diff) <= m.arc / 2) {
          player.takeDamage(m.damage);
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

    // Boss HP bar above everything
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
