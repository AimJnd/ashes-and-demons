/*
  ui.js  (merged: hud + levelup + screens + leaderboard)
  Everything that reads game state and writes to the DOM. No gameplay
  logic — it reflects state and reports user choices back via callbacks.
*/

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
    };
    document.getElementById('hud').classList.remove('hidden');
  },
  render(world) {
    if (!this.el.health) return;
    const p = world.player;
    this.el.health.textContent = `HP ${Math.ceil(p.health)}/${p.stats.maxHealth}`;
    this.el.xp.textContent = `XP ${p.xp} / ${p.xpToNext}`;
    this.el.level.textContent = `Lv ${p.level}`;
    this.el.wave.textContent = `Wave ${world.spawner.wave}`;
    this.el.timer.textContent = `${Math.floor(world.time)}s`;
    this.el.kills.textContent = `Kills ${world.kills}`;
  },
};

// Screens: start / pause / game over ---------------------------------
export const Screens = {
  _ids: ['start', 'levelup', 'gameover', 'pause'],
  show(id) {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.remove('hidden');
  },
  hide(id) {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('hidden');
  },
  hideAll() { this._ids.forEach((id) => this.hide(id)); },
  // Wire start/restart buttons; call provided handlers.
  bind({ onStart, onRestart }) {
    const start = document.getElementById('btn-start');
    const restart = document.getElementById('btn-restart');
    if (start && onStart) start.addEventListener('click', onStart);
    if (restart && onRestart) restart.addEventListener('click', onRestart);
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
      card.className = 'card';
      card.innerHTML = `<h3>${up.name}</h3><p>${up.desc}</p>`;
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
    const listEl = this.el.list;
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
      nameEl.textContent = s.name;        // textContent — no HTML injection

      const scoreEl = document.createElement('span');
      scoreEl.className = 'score';
      scoreEl.textContent = (s.score ?? 0).toLocaleString();

      li.append(rank, nameEl, scoreEl);
      listEl.appendChild(li);
    });
  },
};
