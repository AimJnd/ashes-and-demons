/*
  icons.js
  Inline SVG icon per upgrade id (keyed to UPGRADES in config.js).
  - Commons: single-color glyphs drawn in currentColor, so CSS tier
    colors (accent / gold / violet) tint them wherever they appear.
  - Rares/Epics (weapons & spells): self-colored mini-artwork with
    gradients and a soft glow disc so they read as special.
  Consumed by ui.js: level-up cards, pause chips, compendium cards,
  and the in-game ability sidebar.
*/

const S = (body) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const ICONS = {
  // Commons — plain glyphs in currentColor -----------------------------
  // Sharper Rites: upright sword
  dmg_up: S(`<g fill="currentColor">
    <path d="M12 1 L14.2 5.2 L14.2 14 H9.8 L9.8 5.2 Z"/>
    <path d="M7 14 H17 V16 H7 Z"/>
    <rect x="11" y="16" width="2" height="4.2"/>
    <circle cx="12" cy="21.4" r="1.4"/></g>`),

  // Quick Hands: lightning bolt
  rate_up: S(`<path fill="currentColor" d="M13.5 2 L5 13.2 H10.8 L9.2 22 L19 9.6 H12.6 Z"/>`),

  // Fleet Footed: double speed chevrons
  speed_up: S(`<g fill="currentColor">
    <path d="M4 5 L12.5 12 L4 19 V14.3 L7.6 12 L4 9.7 Z"/>
    <path d="M12 5 L20.5 12 L12 19 V14.3 L15.6 12 L12 9.7 Z"/></g>`),

  // Iron Will: heart with a cutout cross
  hp_up: S(`<path fill="currentColor" d="M12 21 C4.2 15.2 3 9 6.6 6.4 C9.1 4.6 11.3 6 12 8.1 C12.7 6 14.9 4.6 17.4 6.4 C21 9 19.8 15.2 12 21 Z"/>
    <path fill="#16161f" d="M10.9 8.9 h2.2 v2.2 h2.2 v2.2 h-2.2 v2.2 h-2.2 v-2.2 H8.7 v-2.2 h2.2 Z"/>`),

  // Soul Magnet: horseshoe magnet
  magnet: S(`<path fill="currentColor" d="M5 3 H10 V11 a2 2 0 0 0 4 0 V3 H19 V11 a7 7 0 0 1 -14 0 Z"/>
    <path fill="#e8e8ef" opacity=".85" d="M5 3 h5 v3 H5 Z M14 3 h5 v3 h-5 Z"/>`),

  // Lucky Charm: four-leaf clover
  lucky: S(`<g fill="currentColor">
    <circle cx="12" cy="7.2" r="3.4"/><circle cx="7.2" cy="12" r="3.4"/>
    <circle cx="16.8" cy="12" r="3.4"/><circle cx="12" cy="16.8" r="3.4"/></g>
    <circle cx="12" cy="12" r="1.6" fill="#16161f"/>`),

  // Piercing Shot: arrow punched through a ring
  pierce: S(`<circle cx="13" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path fill="currentColor" d="M2 10.8 H16.5 V7.6 L22 12 L16.5 16.4 V13.2 H2 Z"/>`),

  // Honed Edge: diagonal blade with a sharpening spark
  melee_edge: S(`<g fill="currentColor">
    <path d="M3 21 L16.5 7.5 L21 3 L18.8 9.2 L5.5 22.4 Z"/>
    <path d="M17.5 13.5 l.9 2.1 2.1.9 -2.1.9 -.9 2.1 -.9-2.1 -2.1-.9 2.1-.9 Z"/></g>`),

  // Rares — special artwork ---------------------------------------------
  // Spirit Blade: icy spectral sword with a glow
  melee_unlock: S(`<defs><linearGradient id="gi-blade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2feff"/><stop offset="1" stop-color="#59c8e8"/>
    </linearGradient></defs>
    <circle cx="12" cy="11" r="9.5" fill="#9ff5ff" opacity=".16"/>
    <path d="M12 .8 L14.4 5.4 L14.4 14 H9.6 L9.6 5.4 Z" fill="url(#gi-blade)" stroke="#bff3ff" stroke-width=".6"/>
    <path d="M6.5 14 H17.5 V16.2 H6.5 Z" fill="#2b7d97"/>
    <rect x="10.9" y="16.2" width="2.2" height="3.8" fill="#1d5a70"/>
    <circle cx="12" cy="21.2" r="1.5" fill="#9ff5ff"/>`),

  // Twin Shot: two golden bolts fanning upward
  twin_shot: S(`<defs><linearGradient id="gi-twin" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#b0721a"/><stop offset="1" stop-color="#ffd166"/>
    </linearGradient></defs>
    <circle cx="12" cy="12" r="9.5" fill="#ffd166" opacity=".14"/>
    <g transform="rotate(-16 12 12)">
      <rect x="11.2" y="6.5" width="1.6" height="13" rx=".8" fill="url(#gi-twin)"/>
      <path d="M12 2.2 L14.7 7.6 H9.3 Z" fill="#ffe9a8"/></g>
    <g transform="rotate(16 12 12)">
      <rect x="11.2" y="6.5" width="1.6" height="13" rx=".8" fill="url(#gi-twin)"/>
      <path d="M12 2.2 L14.7 7.6 H9.3 Z" fill="#ffe9a8"/></g>`),

  // Echo Slash: bright crescent + fading echo behind it
  echo_slash: S(`<circle cx="12" cy="12" r="9.5" fill="#9ff5ff" opacity=".13"/>
    <path d="M3 10.5 A 9.5 9.5 0 0 1 21 10.5 A 12.5 12.5 0 0 0 3 10.5 Z" fill="#c9f9ff"/>
    <path d="M21 14.5 A 9.5 9.5 0 0 1 3 14.5 A 12.5 12.5 0 0 0 21 14.5 Z" fill="#59c8e8" opacity=".55"/>`),

  // Vampiric Rites: gleaming blood drop
  lifesteal: S(`<defs><linearGradient id="gi-blood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff8d99"/><stop offset="1" stop-color="#8f0f22"/>
    </linearGradient></defs>
    <circle cx="12" cy="13" r="9.5" fill="#ff4d5e" opacity=".14"/>
    <path d="M12 2.5 C12 2.5 5.5 11 5.5 15.3 A6.5 6.5 0 0 0 18.5 15.3 C18.5 11 12 2.5 12 2.5 Z" fill="url(#gi-blood)"/>
    <ellipse cx="9.6" cy="14.6" rx="1.5" ry="2.4" fill="#ffd9dd" opacity=".7" transform="rotate(-18 9.6 14.6)"/>`),

  // Epics — special artwork ----------------------------------------------
  // Chrono Field: violet clock inside a dashed time-ring
  chrono: S(`<circle cx="12" cy="12" r="10.5" fill="#d16bff" opacity=".15"/>
    <circle cx="12" cy="12" r="9.6" fill="none" stroke="#d16bff" stroke-width=".9" stroke-dasharray="2.2 3" opacity=".8"/>
    <circle cx="12" cy="12" r="6.8" fill="#241033" stroke="#d16bff" stroke-width="1.6"/>
    <g stroke="#f0d9ff" stroke-width="1.6" stroke-linecap="round">
      <path d="M12 12 L12 7.6"/><path d="M12 12 L15.2 13.6"/></g>
    <circle cx="12" cy="12" r="1" fill="#f0d9ff"/>`),

  // Holy Nova: radiant golden burst
  nova: S(`<defs><radialGradient id="gi-nova">
      <stop offset="0" stop-color="#fff7dd"/><stop offset="1" stop-color="#ffd166"/>
    </radialGradient></defs>
    <circle cx="12" cy="12" r="10.5" fill="#ffd166" opacity=".18"/>
    <g stroke="#ffd166" stroke-width="1.7" stroke-linecap="round">
      <path d="M12 1.5 V5.2 M12 18.8 V22.5 M1.5 12 H5.2 M18.8 12 H22.5"/>
      <path d="M4.8 4.8 L7.3 7.3 M16.7 16.7 L19.2 19.2 M19.2 4.8 L16.7 7.3 M7.3 16.7 L4.8 19.2" stroke-width="1.3" opacity=".8"/></g>
    <circle cx="12" cy="12" r="4.6" fill="url(#gi-nova)"/>
    <circle cx="12" cy="12" r="6.4" fill="none" stroke="#ffe9a8" stroke-width=".9" opacity=".8"/>`),
};

// Fallback so an upgrade added without art never breaks the UI.
const FALLBACK = S(`<path fill="currentColor" d="M12 2 l2.6 6.6 L21.5 9.2 l-5 4.6 L18 21 L12 17.2 L6 21 l1.5-7.2 -5-4.6 6.9-.6 Z"/>`);

export function icon(id) {
  return ICONS[id] || FALLBACK;
}
