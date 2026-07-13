/*
  ui.js  (merged: hud + levelup + screens + leaderboard)
  Everything that reads game state and writes to the DOM. No gameplay
  logic — it reflects state and reports user choices back via callbacks.
*/

import { UPGRADES, Settings, CHARACTERS, CHAR_LEGS, SHOP, Bank, shopCost, Progress, wipeProgress } from './config.js';
import { icon } from './icons.js';

const LEADERBOARD_KEY = 'exorcist_survival_scores';

// HUD ----------------------------------------------------------------
export const Hud = {
  el: {}, // cached DOM refs
  init() {
    this.el = {
      health: document.getElementById('hud-health'),
      xp: document.getElementById('hud-xp'),
      level: document.getElementById('hud-level'),
      wave: document.getElementById('hud-wave'),
      timer: document.getElementById('hud-timer'),
      kills: document.getElementById('hud-kills'),
      gold: document.getElementById('hud-gold'),
      abilities: document.getElementById('hud-abilities'),
    };
    if (this.el.abilities) this.el.abilities.innerHTML = ''; // fresh run
    document.getElementById('hud').classList.remove('hidden');
  },

  // Rebuild the unlocked-abilities sidebar. Called on every upgrade pick
  // (not per frame — the build only changes when the player levels).
  syncAbilities(player) {
    const box = this.el.abilities;
    if (!box) return;
    box.innerHTML = '';
    for (const [id, count] of Object.entries(player.acquired || {})) {
      const up = UPGRADES.find((u) => u.id === id);
      if (!up) continue;
      const tile = document.createElement('div');
      tile.className = up.tier ? `hud-ability ${up.tier}` : 'hud-ability';
      tile.title = `${up.name} — ${up.desc}`;
      tile.innerHTML = icon(id) +
        (count > 1 ? `<span class="stack">×${count}</span>` : '');
      box.appendChild(tile);
    }
  },
  hide() {
    const el = document.getElementById('hud');
    if (el) el.classList.add('hidden');
  },
  render(world) {
    if (!this.el.health) return;
    const p = world.player;
    this.el.health.textContent = `HP ${Math.ceil(p.health)}/${p.stats.maxHealth}`;
    this.el.xp.textContent = `XP ${p.xp} / ${p.xpToNext}`;
    this.el.level.textContent = `Lv ${p.level}`;
    this.el.wave.textContent = world.spawner.bossSpawned
      ? 'FINAL WAVE'
      : `Wave ${world.spawner.wave}`;
    this.el.timer.textContent = `${Math.floor(world.time)}s`;
    this.el.kills.textContent = `Kills ${world.kills}`;
    this.el.gold.textContent = `Gold ${Bank.gold}`; // banked total, live
  },
};

// Screens: start / pause / game over ---------------------------------
export const Screens = {
  _ids: ['start', 'stage', 'levelup', 'gameover', 'pause', 'abilities', 'menu-leaderboard', 'settings', 'shop'],
  show(id) {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.remove('hidden');
  },
  hide(id) {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('hidden');
  },
  hideAll() { this._ids.forEach((id) => this.hide(id)); },
  // End screen doubles as defeat AND victory — swap title/tone and show.
  showEnd(victory) {
    const screen = document.getElementById('screen-gameover');
    const title = document.getElementById('end-title');
    const sub = document.getElementById('end-subtitle');
    if (screen) screen.classList.toggle('victory', victory);
    if (title) title.textContent = victory ? 'VICTORY' : 'You Died';
    if (sub) {
      sub.textContent = victory
        ? 'Ashmaw has fallen. The stair descends — Stage 2 unlocked. GGs.'
        : '';
    }
    this.show('gameover');
  },
  // Wire stage-select/restart/exit buttons; call provided handlers.
  // onStart(stage) receives the chosen stage number. (btn-start itself
  // only opens the stage submenu — wired in Menu.init.)
  bind({ onStart, onRestart, onExit }) {
    if (onStart) {
      // New Game is a full reset: wipe gold / shop / unlocks, then start
      // Stage 1 fresh. Native confirm guards against a misclick.
      document.getElementById('btn-new-game')?.addEventListener('click', () => {
        if (!confirm('Start a New Game? All gold, shop upgrades and stage unlocks will be wiped.')) return;
        wipeProgress();
        onStart(1);
      });
      document.getElementById('btn-stage-1')?.addEventListener('click', () => onStart(1));
      // Locked state is a disabled attribute (Menu.renderStages), so a
      // click here always means the stage is available.
      document.getElementById('btn-stage-2')?.addEventListener('click', () => onStart(2));
    }
    const restart = document.getElementById('btn-restart');
    const exit = document.getElementById('btn-exit');
    const pauseQuit = document.getElementById('btn-pause-quit');
    if (restart && onRestart) restart.addEventListener('click', onRestart);
    if (exit && onExit) exit.addEventListener('click', onExit);
    if (pauseQuit && onExit) pauseQuit.addEventListener('click', onExit);
  },
};

// Level-up modal -----------------------------------------------------
export const LevelUp = {
  // Render the choice cards; call onPick(id) once the player picks one.
  open(choices, onPick) {
    const container = document.getElementById('levelup-cards');
    const screen = document.getElementById('screen-levelup');
    container.innerHTML = '';

    for (const up of choices) {
      const card = document.createElement('div');
      // Tiered card designs: 'rare' (gold) and 'epic' (violet) upgrades
      // get their own look + a tier tag; commons stay plain.
      card.className = up.tier ? `card ${up.tier}` : 'card';
      const tag = up.tier ? `<span class="tier-tag">${up.tier.toUpperCase()}</span>` : '';
      card.innerHTML = `${tag}<div class="card-icon">${icon(up.id)}</div><h3>${up.name}</h3><p>${up.desc}</p>`;
      card.addEventListener('click', () => {
        screen.classList.add('hidden');
        onPick(up.id);
      }, { once: true });
      container.appendChild(card);
    }

    screen.classList.remove('hidden');
  },
};

// Leaderboard (localStorage; swap this object for a backend later) ----
const MAX_SCORES = 10;

export const Leaderboard = {
  el: {},          // cached DOM refs
  _stats: null,    // stats for the run currently on the game-over screen
  _saved: false,   // guard so a run can only be saved once

  // Cache DOM and wire the save button. Call once at boot.
  init() {
    this.el = {
      stats: document.getElementById('gameover-stats'),
      name: document.getElementById('leaderboard-name'),
      saveBtn: document.getElementById('btn-save-score'),
      list: document.getElementById('leaderboard-list'),
    };
    if (this.el.saveBtn) {
      this.el.saveBtn.addEventListener('click', () => this._handleSave());
    }
    if (this.el.name) {
      // Enter in the name field saves too.
      this.el.name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._handleSave();
      });
    }
  },

  load() {
    try { return JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || []; }
    catch { return []; }
  },

  // Persist an entry and return the saved + sorted top list.
  save(entry) {
    // entry: { name, score, wave, time, kills, date }
    const scores = this.load();
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, MAX_SCORES);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(top));
    return top;
  },

  // Called by the game-over flow. Shows this run's stats + existing board.
  // stats: { score, wave, time, kills }
  show(stats) {
    this._stats = stats;
    this._saved = false;

    if (this.el.stats) {
      this.el.stats.innerHTML =
        `Score <strong>${stats.score.toLocaleString()}</strong>` +
        ` · Wave ${stats.wave} · ${Math.floor(stats.time)}s · ${stats.kills} kills`;
    }
    if (this.el.name) {
      this.el.name.value = '';
      this.el.name.disabled = false;
    }
    if (this.el.saveBtn) {
      this.el.saveBtn.disabled = false;
      this.el.saveBtn.textContent = 'Save Score';
    }
    this.render(); // show previous highscores before saving
    if (this.el.name) this.el.name.focus();
  },

  // Build the new entry, persist it, and re-render with it highlighted.
  _handleSave() {
    if (this._saved || !this._stats) return;
    const name = (this.el.name?.value || '').trim().slice(0, 12) || 'Anon';
    const entry = { name, ...this._stats, date: Date.now() };
    this.save(entry);
    this._saved = true;

    if (this.el.saveBtn) {
      this.el.saveBtn.disabled = true;
      this.el.saveBtn.textContent = 'Saved ✓';
    }
    if (this.el.name) this.el.name.disabled = true;
    this.render(entry);
  },

  // Paint the top scores into the <ol>. Pass an entry to highlight it.
  render(highlight) {
    this.renderInto(this.el.list, highlight);
  },

  // Same painter, but into any list element — the start-menu leaderboard
  // panel reuses it so the two boards can never drift apart.
  renderInto(listEl, highlight) {
    if (!listEl) return;
    const scores = this.load();
    listEl.innerHTML = '';

    if (!scores.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No scores yet — be the first.';
      listEl.appendChild(li);
      return;
    }

    scores.forEach((s, i) => {
      const li = document.createElement('li');
      const isYou = highlight &&
        s.name === highlight.name &&
        s.score === highlight.score &&
        s.date === highlight.date;
      if (isYou) li.className = 'you';

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${i + 1}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'name';
      // Crown for runs that actually slew the dragon. textContent — no HTML injection.
      nameEl.textContent = (s.win ? '👑 ' : '') + s.name;

      const scoreEl = document.createElement('span');
      scoreEl.className = 'score';
      scoreEl.textContent = (s.score ?? 0).toLocaleString();

      li.append(rank, nameEl, scoreEl);
      listEl.appendChild(li);
    });
  },
};

// Pause menu (Esc): run snapshot + acquired abilities ------------------
export const PauseMenu = {
  open(world) {
    const p = world.player;

    const stats = document.getElementById('pause-stats');
    if (stats) {
      const wave = world.spawner.bossSpawned ? 'FINAL' : world.spawner.wave;
      const weapon = p.hasWeapon('melee') ? 'Spirit Blade' : 'Talisman Shots';
      stats.innerHTML =
        `Wave <strong>${wave}</strong> · Lv <strong>${p.level}</strong>` +
        ` · <strong>${world.kills}</strong> kills · ${Math.floor(world.time)}s<br>` +
        `HP ${Math.ceil(p.health)}/${p.stats.maxHealth} · Weapon: <strong>${weapon}</strong>`;
    }

    // Acquired abilities as tier-colored chips; hover shows the full desc.
    const list = document.getElementById('pause-abilities');
    if (list) {
      list.innerHTML = '';
      const entries = Object.entries(p.acquired || {});
      if (!entries.length) {
        const empty = document.createElement('span');
        empty.className = 'pause-empty';
        empty.textContent = 'No abilities yet — level up to choose one.';
        list.appendChild(empty);
      }
      for (const [id, count] of entries) {
        const up = UPGRADES.find((u) => u.id === id);
        if (!up) continue;
        const chip = document.createElement('span');
        chip.className = up.tier ? `ability-chip ${up.tier}` : 'ability-chip';
        chip.title = up.desc + (up.note ? ` (${up.note})` : '');
        const label = count > 1 ? `${up.name} ×${count}` : up.name;
        chip.innerHTML = `<span class="chip-icon">${icon(id)}</span>${label}`;
        list.appendChild(chip);
      }
    }

    Screens.show('pause');
  },
};

// Start-menu panels: Abilities compendium + Leaderboard viewer ---------
export const Menu = {
  // Wire the menu buttons once at boot (called from game.js main()).
  init() {
    const wire = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    // Start Game opens the stage submenu; the stage buttons themselves
    // are bound to the game in Screens.bind.
    wire('btn-start', () => {
      this.renderStages();
      Screens.hide('start'); Screens.show('stage');
    });
    wire('btn-stage-back', () => { Screens.show('start'); Screens.hide('stage'); });
    wire('btn-abilities', () => {
      this.renderAbilities();
      {Screens.hide('start');Screens.show('abilities');};
    });
    wire('btn-leaderboard', () => {
      // Re-render on every open so fresh scores always show.
      Leaderboard.renderInto(document.getElementById('menu-leaderboard-list'));
      {Screens.hide('start');Screens.show('menu-leaderboard');};
    });
    wire('btn-abilities-back',   () => {Screens.show('start') ; Screens.hide('abilities');});
    wire('btn-leaderboard-back', () => {Screens.show('start') ; Screens.hide('menu-leaderboard');});
    wire('btn-shop', () => {
      this.renderShop();
      Screens.hide('start'); Screens.show('shop');
    });
    wire('btn-shop-back', () => { Screens.show('start'); Screens.hide('shop'); });

    // Settings panel: pick control scheme, highlight the active one.
    const markControls = () => {
      document.getElementById('btn-controls-kb')?.classList.toggle('primary', Settings.controls === 'keyboard');
      document.getElementById('btn-controls-mouse')?.classList.toggle('primary', Settings.controls === 'mouse');
    };
    wire('btn-settings', () => {
      markControls();
      Screens.hide('start'); Screens.show('settings');
    });
    wire('btn-controls-kb',    () => { Settings.setControls('keyboard'); markControls(); });
    wire('btn-controls-mouse', () => { Settings.setControls('mouse');    markControls(); });
    wire('btn-settings-back',  () => { Screens.show('start'); Screens.hide('settings'); });

    // Character select: paint each preview from the same sprite data the
    // game renders with, and highlight the chosen one.
    const paintChar = (canvasId, char) => {
      const cv = document.getElementById(canvasId);
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const rows = [...char.torso, ...CHAR_LEGS.stand];
      const cols = rows[0].length;
      const p = Math.floor(Math.min(cv.width / cols, cv.height / rows.length));
      const x0 = Math.floor((cv.width - cols * p) / 2);
      const y0 = Math.floor((cv.height - rows.length * p) / 2);
      for (let ry = 0; ry < rows.length; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          const ch = rows[ry][cx];
          if (ch === '.') continue;
          ctx.fillStyle = char.pal[ch];
          ctx.fillRect(x0 + cx * p, y0 + ry * p, p, p);
        }
      }
    };
    paintChar('char-canvas-hunter', CHARACTERS.hunter);
    paintChar('char-canvas-huntress', CHARACTERS.huntress);
    const markChar = () => {
      document.getElementById('btn-char-hunter')?.classList.toggle('primary', Settings.character === 'hunter');
      const hb = document.getElementById('btn-char-huntress');
      hb?.classList.toggle('primary', Settings.character === 'huntress');
      // Shop unlock: locked until bought (setCharacter refuses it anyway).
      const owned = Bank.levelOf('huntress') > 0;
      hb?.classList.toggle('locked', !owned);
      const desc = hb?.querySelector('.char-desc');
      if (desc) desc.textContent = owned
        ? 'Fast · frail · piercing shots'
        : '🔒 75 gold — unlock in the Shop';
    };
    this._markChar = markChar; // renderShop re-runs it after a purchase
    wire('btn-char-hunter',   () => { Settings.setCharacter('hunter');   markChar(); });
    wire('btn-char-huntress', () => { Settings.setCharacter('huntress'); markChar(); });
    markChar();

    // Pause-menu controls toggle: one button that flips the scheme.
    // markControls keeps the start-menu settings panel in sync with it.
    const pauseControls = document.getElementById('btn-pause-controls');
    const markPauseControls = () => {
      if (pauseControls) {
        pauseControls.textContent =
          `Movement: ${Settings.controls === 'mouse' ? 'Mouse (follow cursor)' : 'Keyboard (WASD / Arrows)'}`;
      }
    };
    wire('btn-pause-controls', () => {
      Settings.setControls(Settings.controls === 'mouse' ? 'keyboard' : 'mouse');
      markPauseControls();
      markControls();
    });
    markPauseControls();
  },

  // Stage submenu: re-check the Stage 2 lock every time it opens, so a
  // fresh victory unlocks it without a reload.
  renderStages() {
    const b = document.getElementById('btn-stage-2');
    if (!b) return;
    b.disabled = !Progress.stage2;
    b.textContent = Progress.stage2 ? 'Stage 2' : '🔒 Stage 2 — slay Ashmaw';
  },

  // Build the shop from the SHOP catalog (config.js): gold balance on top,
  // one row per item with its next-level cost. Re-rendered after every
  // purchase so costs, levels and button states stay honest.
  renderShop() {
    const goldEl = document.getElementById('shop-gold');
    if (goldEl) goldEl.textContent = `Gold: ${Bank.gold}`;
    const box = document.getElementById('shop-items');
    if (!box) return;
    box.innerHTML = '';

    for (const item of SHOP) {
      const owned = Bank.levelOf(item.id);
      const maxed = owned >= item.max;
      const cost = shopCost(item, owned);

      const row = document.createElement('div');
      row.className = 'shop-item';
      const lvl = item.max > 1
        ? `<span class="shop-lvl">Lv ${owned}/${item.max}</span>`
        : (owned ? '<span class="shop-lvl">Owned</span>' : '');
      row.innerHTML = `<div class="shop-info"><h3>${item.name} ${lvl}</h3><p>${item.desc}</p></div>`;

      const btn = document.createElement('button');
      btn.className = 'menu-btn shop-buy';
      btn.textContent = maxed ? (item.max > 1 ? 'Max' : 'Owned') : `${cost} gold`;
      btn.disabled = maxed || Bank.gold < cost;
      btn.addEventListener('click', () => {
        if (Bank.buy(item)) {
          this.renderShop();
          this._markChar?.(); // huntress unlock reflects in Settings
        }
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  },

  // Build the compendium from the live UPGRADES pool, grouped by tier,
  // reusing the level-up card design — it can never go stale when new
  // abilities are added to config.js.
  renderAbilities() {
    const container = document.getElementById('abilities-cards');
    if (!container) return;
    container.innerHTML = '';

    const groups = [
      ['Common', (u) => !u.tier],
      ['Rare',   (u) => u.tier === 'rare'],
      ['Epic',   (u) => u.tier === 'epic'],
    ];
    for (const [label, match] of groups) {
      const ups = UPGRADES.filter(match);
      if (!ups.length) continue;

      const title = document.createElement('h3');
      title.className = 'ability-group-title';
      title.textContent = label;
      container.appendChild(title);

      const row = document.createElement('div');
      row.className = 'ability-group';
      for (const up of ups) {
        const card = document.createElement('div');
        card.className = up.tier ? `card ${up.tier}` : 'card';
        const tag = up.tier ? `<span class="tier-tag">${up.tier.toUpperCase()}</span>` : '';
        const note = up.note ? `<p class="note">${up.note}</p>` : '';
        card.innerHTML = `${tag}<div class="card-icon">${icon(up.id)}</div><h3>${up.name}</h3><p>${up.desc}</p>${note}`;
        row.appendChild(card);
      }
      container.appendChild(row);
    }
  },
};
