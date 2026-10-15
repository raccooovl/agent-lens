// Agent Lens on Twitch: puts the agent each VALORANT streamer is playing on their stream card and
// sidebar entry, and adds an agent and role filter to the VALORANT directory.
(() => {
  'use strict';
  if (window.__agentLens) return;
  window.__agentLens = true;
  const { t, tp } = globalThis.AgentLensI18n;
  const SETTINGS_KEY = 'agentLensSettings', FILTER_KEY = 'agentLensFilter';
  const DEFAULTS = { badges: true, scores: true, sidebar: true, quality: 'high', favorites: [], minViewers: 0 };
  const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
  const ROLE_TEXT = { Duelist: 'roleDuelist', Initiator: 'roleInitiator', Controller: 'roleController', Sentinel: 'roleSentinel' };
  const LOGIN = /^[a-z0-9_]{1,25}$/;
  const ASK_AGAIN_MS = 30 * 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let settings = { ...DEFAULTS };
  let filter = { roles: [], agents: [], mine: false };
  let assets = null, agentById = new Map();
  const anchorStatic = new Map();
  const results = new Map();       // login -> result from the service worker
  const pending = new Set();       // logins being read right now
  const askedAt = new Map();       // login -> last time this tab asked
  const items = new Map();         // element -> { kind, login, mount }
  const visible = new Set();       // elements on screen
  let bar = null, scanTimer = null, stopped = false;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(globalThis.AgentLensCSS);

  // ---------- helpers ----------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
    return node;
  }
  const SCREEN_TEXT = { select: 'screenSelect', menu: 'screenMenu', dead: 'screenDead', roundEnd: 'screenRoundEnd', buy: 'screenBuy', broadcast: 'screenBroadcast', deathmatch: 'screenDeathmatch' };
  const MODE_TEXT = { competitive: 'modeCompetitive', unrated: 'modeUnrated', swiftplay: 'modeSwiftplay', deathmatch: 'modeDeathmatch' };
  const mapName = id => id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
  const matchInfo = result => { const m = result && result.match; if (!m) return ''; return [m.map ? mapName(m.map) : '', m.mode && MODE_TEXT[m.mode] ? t(MODE_TEXT[m.mode]) : ''].filter(Boolean).join(' · '); };
  // Streams in the same match (from their team comps and scores), worked out on every scan.
  let groups = [], groupOf = new Map();
  let groupsDirty = true, groupsAt = 0;
  function linkGroups() {
    // Only when results changed (or once a minute, as links expire), not on every pass over the page.
    if (!groupsDirty && Date.now() - groupsAt < 60000) return;
    groupsDirty = false; groupsAt = Date.now();
    groups = globalThis.AgentLensMatch ? AgentLensMatch.groups(results) : [];
    groupOf = new Map(); for (const g of groups) for (const m of g) groupOf.set(m.login, g);
  }
  function displayName(login) {
    for (const [element, item] of items) if (item.login === login && item.kind === 'card') {
      const n = element.querySelector('a[data-a-target="preview-card-channel-link"] p[title]')?.getAttribute('title'); if (n) return n;
    }
    return login;
  }
  // Extra tooltip lines: both teams' agents, and who else is in this match.
  function matchLines(login, result) {
    const lines = [], names = ids => ids.map(id => (agentById.get(id) || {}).name).filter(Boolean).join(', ');
    if (matchInfo(result)) lines.push(matchInfo(result));
    if (result && result.comp) {
      if (result.comp.left.length) lines.push(t('compTeam', { agents: names(result.comp.left) }));
      if (result.comp.right.length) lines.push(t('compOpponents', { agents: names(result.comp.right) }));
    }
    const g = groupOf.get(login);
    if (g) {
      const me = g.find(m => m.login === login);
      lines.push(t('sameMatchWith', { names: g.filter(m => m.login !== login).map(m => `${displayName(m.login)} (${t(m.side === me.side ? 'relTeam' : 'relOpponents')})`).join(', ') }));
    }
    return lines;
  }
  function linkIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'link');
    svg.innerHTML = '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
    return svg;
  }
  function lensMark() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle cx="12" cy="12" r="9.5" fill="none" stroke="#ff4655" stroke-width="2.4"/><path d="M12 6.8 17.2 12 12 17.2 6.8 12Z" fill="#ff4655"/>';
    return svg;
  }
  function theme() {
    const root = document.documentElement;
    if (root.classList.contains('tw-root--theme-light')) return 'light';
    if (root.classList.contains('tw-root--theme-dark')) return 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function mount(kind) {
    const host = document.createElement('agent-lens');
    host.dataset.alKind = kind;
    host.dataset.theme = theme();
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet];
    return { host, root };
  }
  const loginFrom = href => {
    const match = /^\/([A-Za-z0-9_]{1,25})\/?$/.exec(href || '');
    const login = match && match[1].toLowerCase();
    return login && LOGIN.test(login) ? login : null;
  };
  const isValorantDirectory = () => /^\/directory\/(?:category|game)\/valorant\/?$/i.test(location.pathname);
  const agentOf = result => result && result.agent ? agentById.get(result.agent) : null;
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);

  // ---------- finding VALORANT streams on the page ----------
  // Viewer counts as Twitch writes them: "38 viewers", "1.3K viewers", "1,3 K kijkers", "1.300 Zuschauer".
  function parseViewers(text) {
    const m = /(\d[\d.,\s\u00a0\u202f]*)\s*(K|M|k|m|mil|mln|Mio|tys|тыс|млн)?/.exec(text || '');
    if (!m) return null;
    const digits = m[1].replace(/[\s\u00a0\u202f]/g, '');
    if (m[2]) { const v = parseFloat(digits.replace(',', '.')); return Math.round(v * (/^(M|m$|mln|Mio|млн)/.test(m[2]) ? 1e6 : 1e3)); }
    const n = parseInt(digits.replace(/[.,]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  // Below the minimum viewers chosen in the popup: not read at all.
  const tooSmall = item => settings.minViewers > 0 && item.viewers !== null && item.viewers !== undefined && item.viewers < settings.minViewers;
  function liveCards() {
    const out = [];
    for (const card of document.querySelectorAll('article')) {
      if (card.closest('agent-lens')) continue;
      const channel = card.querySelector('a[data-a-target="preview-card-channel-link"][href]');
      const image = card.querySelector('a[data-a-target="preview-card-image-link"]');
      const login = loginFrom(channel && channel.getAttribute('href'));
      if (!login || !image) continue;
      const preview = image.querySelector('img');
      if (preview && preview.getAttribute('src') && !/previews-ttv/.test(preview.getAttribute('src'))) continue; // videos and clips
      const game = card.querySelector('a[data-a-target="preview-card-game-link"][href]');
      const valorant = game ? /\/directory\/(?:category|game)\/valorant\/?$/i.test(game.getAttribute('href'))
        : isValorantDirectory() || /\bplaying VALORANT$/i.test((preview && preview.getAttribute('alt')) || '');
      if (valorant) out.push({ element: card, login, anchor: image, viewers: parseViewers(card.querySelector('.tw-media-card-stat')?.textContent) });
    }
    return out;
  }
  function sidebarRows() {
    const out = [];
    if (!settings.sidebar) return out;
    for (const row of document.querySelectorAll('.side-nav-card')) {
      if (row.parentElement && row.parentElement.closest('.side-nav-card')) continue;
      const link = row.querySelector('a[href]');
      const login = loginFrom(link && link.getAttribute('href'));
      const game = row.querySelector('[data-a-target="side-nav-game-title"], .side-nav-card__metadata p');
      const avatar = row.querySelector('.side-nav-card__avatar, [class*="avatar"]');
      if (login && avatar && game && /^valorant$/i.test(game.textContent.trim())) out.push({ element: row, login, anchor: avatar, viewers: parseViewers(row.querySelector('[data-a-target="side-nav-live-status"]')?.textContent) });
    }
    return out;
  }
  // The grid cell holding a card, so hidden cards leave no gap.
  function gridItem(card) {
    const tower = card.closest('.tw-tower');
    if (!tower) return card;
    let item = card;
    while (item.parentElement && item.parentElement !== tower) item = item.parentElement;
    return item.querySelectorAll('article').length <= 1 ? item : card;
  }

  // ---------- drawing ----------
  function scorePart(result) {
    if (!settings.scores || !result || !result.score || result.status === 'offline' || result.status === 'error') return null;
    const { left, right } = result.score, round = left + right + 1;
    const hot = Math.max(left, right) >= 12;
    return { hot, text: `${left}–${right}`, title: t('badgeScore', { round, left, right }) + (left >= 12 && right >= 12 ? ' · ' + t('overtime') : hot ? ' · ' + t('matchPoint') : '') };
  }
  function eyeIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'eye');
    svg.innerHTML = '<path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" fill="currentColor"/>';
    return svg;
  }
  function badgeFor(login, result, title) {
    const agent = agentOf(result);
    const watching = result && result.status === 'spectating' ? agentById.get(result.watching) : null;
    if (!agent) {
      if (watching) {
        // Dead and watching a teammate before their own agent was seen: say so rather than guess.
        const score = scorePart(result);
        const label = t('badgeSpectatingUnknown', { name: title, agent: watching.name });
        return el('div', { class: 'badge earlier', title: [label, score && score.title].filter(Boolean).join('\n'), role: 'img', 'aria-label': label },
          el('span', { class: 'face eyeface' }, eyeIcon()), el('span', { text: t('spectating') }), score ? el('span', { class: 'score', text: score.text }) : null);
      }
      const maybe = result && result.status === 'maybe' ? agentById.get(result.maybe) : null;
      if (maybe) {
        // Seen only on a death or round-end screen: likely, not certain.
        const score = scorePart(result), label = t('badgeMaybe', { name: title, agent: maybe.name });
        return el('div', { class: 'badge earlier maybe', title: [label, score && score.title, ...matchLines(login, result)].filter(Boolean).join('\n'), role: 'img', 'aria-label': label },
          el('span', { class: 'face', style: `background-image:url("${assets.faces[maybe.id]}");background-color:${maybe.color}` }),
          el('span', { text: maybe.name + '?' }), score ? el('span', { class: 'score', text: score.text }) : null);
      }
      if (result && result.status === 'none' && SCREEN_TEXT[result.screen]) {
        // No agent in sight, but we know why: agent select, menus, dead, round over, buy phase.
        const screen = t(SCREEN_TEXT[result.screen]), score = scorePart(result);
        const label = t('badgeScreen', { name: title, screen });
        return el('div', { class: 'badge screen', title: [label, score && score.title, ...matchLines(login, result)].filter(Boolean).join('\n'), role: 'img', 'aria-label': label },
          el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: screen }), groupOf.has(login) ? linkIcon() : null, score ? el('span', { class: 'score', text: score.text }) : null);
      }
      if (pending.has(login) && !results.has(login)) {
        const box = el('div', { class: 'reading', title: t('reading'), role: 'img', 'aria-label': t('reading') });
        box.append(lensMark());
        return box;
      }
      return null;
    }
    const earlier = result.status === 'earlier' || result.status === 'error';
    const fav = settings.favorites.includes(agent.id);
    const minutes = Math.max(1, Math.round((Date.now() - (result.seenAt || Date.now())) / 60000));
    const label = earlier ? tp('badgeEarlier', minutes, { name: title, agent: agent.name })
      : watching ? t('badgeSpectating', { name: title, agent: agent.name, watching: watching.name })
      : t('badgePlaying', { name: title, agent: agent.name });
    const parts = [el('span', { class: 'face', style: `background-image:url("${assets.faces[agent.id]}");background-color:${agent.color}` })];
    if (fav) parts.push(el('span', { class: 'star', 'aria-hidden': 'true', text: '★' }));
    parts.push(el('span', { text: agent.name }));
    if (watching) parts.push(eyeIcon());
    let hot = false, scoreTitle = '';
    const score = scorePart(result);
    if (score) { hot = score.hot; scoreTitle = score.title; parts.push(el('span', { class: 'score', text: score.text })); }
    const now = earlier && SCREEN_TEXT[result.screen] ? t('badgeScreenNow', { screen: t(SCREEN_TEXT[result.screen]) }) : '';
    if (groupOf.has(login)) parts.push(linkIcon());
    const titleText = [label, now, scoreTitle, ...matchLines(login, result), fav ? t('badgeFavorite') : ''].filter(Boolean).join('\n');
    return el('div', { class: `badge${earlier ? ' earlier' : ''}${fav ? ' fav' : ''}${hot ? ' hot' : ''}`, title: titleText, role: 'img', 'aria-label': titleText.replace(/\n/g, '. ') }, parts);
  }
  function renderItem(element, item) {
    const result = tooSmall(item) ? undefined : results.get(item.login);
    const name = item.kind === 'card'
      ? (element.querySelector('a[data-a-target="preview-card-channel-link"] p[title]')?.getAttribute('title') || item.login)
      : (element.querySelector('[data-a-target="side-nav-title"]')?.textContent.trim() || item.login);
    const key = JSON.stringify([tooSmall(item), result && result.status, result && result.agent, result && result.watching, result && result.maybe, result && result.score, result && result.screen,
      result && result.comp && result.comp.at, result && result.match && (result.match.map + result.match.mode), (groupOf.get(item.login) || []).map(m => m.login + m.side).join(), pending.has(item.login), settings.badges, settings.scores, settings.favorites.join(','), result && result.status === 'earlier' && Math.round((Date.now() - result.seenAt) / 60000)]);
    if (item.mount.key === key) return;
    item.mount.key = key;
    if (item.kind === 'card') {
      const badge = settings.badges ? badgeFor(item.login, result, name) : null;
      item.mount.root.replaceChildren(...(badge ? [badge] : []));
    } else {
      const agent = agentOf(result);
      item.mount.root.replaceChildren(...(agent ? [el('span', {
        class: `side${result.status !== 'agent' ? ' earlier' : ''}`, role: 'img', 'aria-label': t('sidebarPlaying', { agent: agent.name }),
        title: t('sidebarPlaying', { agent: agent.name }), style: `background-image:url("${assets.faces[agent.id]}");background-color:${agent.color}`
      })] : []));
    }
  }

  // ---------- the filter bar ----------
  function filterActive() { return filter.roles.length > 0 || filter.agents.length > 0 || filter.mine || (filter.group || []).length > 0 || (filter.maps || []).length > 0 || (filter.modes || []).length > 0; }
  function passes(result, login) {
    if (!filterActive()) return true;
    if ((filter.group || []).length) return filter.group.includes(login);
    const m = (result && result.match) || {};
    if ((filter.maps || []).length && !filter.maps.includes(m.map)) return false;
    if ((filter.modes || []).length && !filter.modes.includes(m.mode)) return false;
    if (!filter.roles.length && !filter.agents.length && !filter.mine) return true;
    const agent = agentOf(result);
    if (!agent) return false;
    const picked = new Set([...filter.agents, ...(filter.mine ? settings.favorites : [])]);
    if (picked.size && !picked.has(agent.id)) return false;
    if (filter.roles.length && !filter.roles.includes(agent.role)) return false;
    return true;
  }
  // The same-match pick is for this page only: that match will be over by the next visit.
  // Minimum viewers, also in the popup: streams below it aren't read at all.
  const MIN_STEPS = [0, 10, 25, 50, 100, 250];
  function minViewersPicker() {
    const select = el('select', { class: 'minv', title: t('settingMinViewersHint'), 'aria-label': t('minViewersShort') },
      MIN_STEPS.map(n => el('option', { value: String(n), text: n ? `${n}+` : t('minViewersAny') })));
    select.value = String(MIN_STEPS.includes(Number(settings.minViewers)) ? Number(settings.minViewers) : 0);
    select.addEventListener('blur', () => scheduleScan());
    select.addEventListener('change', () => {
      const minViewers = Number(select.value);
      chrome.storage.local.get(SETTINGS_KEY).then(r => chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULTS, ...(r[SETTINGS_KEY] || {}), minViewers } })).catch(() => {});
    });
    return el('label', { class: 'minvbox' }, el('span', { text: t('minViewersShort') }), select);
  }
  function saveFilter() { const { group, ...kept } = filter; chrome.storage.local.set({ [FILTER_KEY]: kept }).catch(() => {}); }
  function toggle(list, value) { return list.includes(value) ? list.filter(v => v !== value) : [...list, value]; }
  function ensureBar(cards) {
    if (!isValorantDirectory() || !cards.length) { if (bar) { bar.host.remove(); bar = null; } return null; }
    const first = cards[0].element, tower = first.closest('.tw-tower');
    const anchor = tower || gridItem(first).parentElement;
    if (!anchor || !anchor.parentElement) return null;
    if (!bar || !bar.host.isConnected || bar.host.nextElementSibling !== anchor) {
      bar?.host.remove();
      bar = mount('bar');
      anchor.parentElement.insertBefore(bar.host, anchor);
      bar.key = null;
    }
    return bar;
  }
  function renderBar(cards, pause = null) {
    if (!bar) return;
    const counts = new Map();
    let found = 0, reading = 0, shown = 0, skipped = 0;
    for (const card of cards) {
      if (tooSmall(card)) { skipped++; continue; }
      const { login } = card;
      const agent = agentOf(results.get(login));
      if (agent) { found++; counts.set(agent.id, (counts.get(agent.id) || 0) + 1); }
      else if (pending.has(login)) reading++;
      if (passes(results.get(login), login)) shown++;
    }
    const mapCounts = new Map(), modeCounts = new Map();
    for (const { login } of cards) {
      const m = (results.get(login) || {}).match; if (!m) continue;
      if (m.map) mapCounts.set(m.map, (mapCounts.get(m.map) || 0) + 1);
      if (m.mode) modeCounts.set(m.mode, (modeCounts.get(m.mode) || 0) + 1);
    }
    for (const id of filter.maps || []) if (!mapCounts.has(id)) mapCounts.set(id, 0);
    for (const id of filter.modes || []) if (!modeCounts.has(id)) modeCounts.set(id, 0);
    const onPage = new Set(cards.map(c => c.login));
    const pageGroups = groups.map(g => g.filter(m => onPage.has(m.login))).filter(g => g.length > 1);
    const key = JSON.stringify([[...counts], found, reading, shown, skipped, settings.minViewers, cards.length, filter, settings.favorites, bar.host.dataset.theme, pageGroups, [...mapCounts], [...modeCounts], pause]);
    if (bar.key === key) return;
    // Don't redraw under an open dropdown; catch up when it's closed.
    if (bar.root.activeElement && bar.root.activeElement.classList.contains('minv')) return;
    bar.key = key;
    const roleChip = role => {
      const on = filter.roles.includes(role);
      return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: () => { filter.roles = toggle(filter.roles, role); saveFilter(); refreshAll(); } },
        el('span', { class: 'role', style: `--icon:url("${assets.roles[role.toLowerCase()]}")`, 'aria-hidden': 'true' }), t(ROLE_TEXT[role]));
    };
    const agentsHere = [...counts.entries()].sort((a, b) => b[1] - a[1] || agentById.get(a[0]).name.localeCompare(agentById.get(b[0]).name));
    for (const id of filter.agents) if (!counts.has(id) && agentById.has(id)) agentsHere.push([id, 0]);
    const agentChip = ([id, count]) => {
      const agent = agentById.get(id), on = filter.agents.includes(id);
      const dim = filter.roles.length && !filter.roles.includes(agent.role);
      return el('button', { class: `chip${dim ? ' dim' : ''}`, type: 'button', 'aria-pressed': String(on), title: agent.name,
        onclick: () => { filter.agents = toggle(filter.agents, id); saveFilter(); refreshAll(); } },
      el('span', { class: 'face', style: `background-image:url("${assets.faces[id]}");background-color:${agent.color}`, 'aria-hidden': 'true' }),
      settings.favorites.includes(id) ? el('span', { class: 'star', 'aria-hidden': 'true', text: '★' }) : null,
      agent.name, el('span', { class: 'count', text: String(count) }));
    };
    const mine = settings.favorites.length
      ? el('button', { class: 'chip star', type: 'button', 'aria-pressed': String(filter.mine), onclick: () => { filter.mine = !filter.mine; saveFilter(); refreshAll(); } },
        el('span', { class: 'star', 'aria-hidden': 'true', text: '★' }), t('myAgents'))
      : null;
    const status = [t('statusFound', { found, total: cards.length - skipped }), reading ? tp('statusReading', reading) : '', skipped ? tp('statusSkipped', skipped, { min: settings.minViewers }) : '', filterActive() ? tp('statusShowing', shown) : '',
      pause === 'min' ? t('loadPausedMin', { min: settings.minViewers }) : pause === 'cap' ? t('loadPausedCap', { count: cards.length }) : ''].filter(Boolean).join(' · ');
    const box = el('section', { class: 'bar', 'aria-label': 'Agent Lens' },
      el('div', { class: 'head' },
        el('span', { class: 'mark' }, lensMark()), el('span', { class: 'title', text: 'Agent Lens' }),
        el('span', { class: 'status', text: status, role: 'status' }),
        pause === 'cap' ? el('button', { class: 'clear more', type: 'button', title: t('loadMoreHint', { count: LOAD_STEP }), onclick: loadMore }, t('loadMore')) : null,
        minViewersPicker(),
        filterActive() ? el('button', { class: 'clear', type: 'button', onclick: () => { filter = { roles: [], agents: [], mine: false, group: [], maps: [], modes: [] }; saveFilter(); refreshAll(); } }, t('clearFilter')) : null),
      el('div', { class: 'row', role: 'group', 'aria-label': t('rolesLabel') }, ROLES.map(roleChip), mine ? [el('span', { class: 'sep' }), mine] : null),
      agentsHere.length ? el('div', { class: 'row', role: 'group', 'aria-label': t('agentsLabel') }, agentsHere.map(agentChip)) : null,
      mapCounts.size || modeCounts.size ? el('div', { class: 'row', role: 'group', 'aria-label': t('mapModeLabel') },
        el('span', { class: 'label', text: t('mapModeLabel') }),
        [...modeCounts].map(([id, n]) => { const on = (filter.modes || []).includes(id); return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: () => { filter.modes = toggle(filter.modes || [], id); saveFilter(); refreshAll(); } }, t(MODE_TEXT[id] || id), el('span', { class: 'count', text: String(n) })); }),
        modeCounts.size && mapCounts.size ? el('span', { class: 'sep' }) : null,
        [...mapCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, n]) => { const on = (filter.maps || []).includes(id); return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: () => { filter.maps = toggle(filter.maps || [], id); saveFilter(); refreshAll(); } }, mapName(id), el('span', { class: 'count', text: String(n) })); })) : null,
      pageGroups.length ? el('div', { class: 'row', role: 'group', 'aria-label': t('sameMatchLabel') },
        el('span', { class: 'label', text: t('sameMatchLabel') }),
        pageGroups.map(g => {
          const logins = g.map(m => m.login), on = JSON.stringify([...(filter.group || [])].sort()) === JSON.stringify([...logins].sort());
          const text = g.filter(m => m.side === g[0].side).map(m => displayName(m.login)).join(' & ')
            + (g.some(m => m.side !== g[0].side) ? ' vs ' + g.filter(m => m.side !== g[0].side).map(m => displayName(m.login)).join(' & ') : '');
          return el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), title: t('sameMatchChip'),
            onclick: () => { filter.group = on ? [] : logins; saveFilter(); refreshAll(); } }, linkIcon(), text);
        })) : null,
      filterActive() && shown === 0 && !reading ? el('p', { class: 'empty', text: pause === 'min' ? t('emptyFilterMin', { min: settings.minViewers }) : pause === 'cap' ? t('emptyFilterCap') : t('emptyFilter') }) : null,
      !filterActive() && !agentsHere.length ? el('p', { class: 'hint', text: t('filterHint') }) : null);
    bar.root.replaceChildren(box);
  }
  // While a filter is on, every card is hidden until it's known to match (content.css): cards Twitch adds as
  // the list grows never flash up before they're checked.
  // While a filter hides most cards the list stays short, so Twitch's "load more" area at its end stays in view
  // and Twitch keeps loading streams (up to five pages per scroll) only for them to be hidden: one evening of
  // filtering left 1,400 cards on the page, and Twitch then rebuilds all of them on Back (seconds of frozen
  // page). So while filtering, loading pauses (content.css moves that area out of view) when nothing further
  // can show, as when sorted by viewers and the last card is already under the minimum, or after LOAD_CAP
  // cards; "Load more" in the bar allows LOAD_STEP more.
  const LOAD_CAP = 300, LOAD_STEP = 150;
  let loadCap = LOAD_CAP, loadPage = '';
  function loadPause(cards) {
    const page = location.pathname + location.search;
    if (page !== loadPage) { loadPage = page; loadCap = LOAD_CAP; }
    if (!isValorantDirectory() || !filterActive() || !cards.length) return null;
    const last = cards[cards.length - 1];
    if (settings.minViewers > 0 && new URLSearchParams(location.search).get('sort') === 'VIEWER_COUNT' && tooSmall(last)) return 'min';
    return cards.length >= loadCap ? 'cap' : null;
  }
  function loadMore() {
    loadCap = liveCards().length + LOAD_STEP;
    document.documentElement.removeAttribute('data-al-noload');
    if (bar) bar.key = null;
    scan();
    // Twitch looks at its "load more" area when the page scrolls.
    requestAnimationFrame(() => { const area = document.querySelector('.tw-tower ~ .scrollable-trigger__wrapper'); const scroller = area && area.closest('.scrollable-area'); (scroller || document).dispatchEvent(new Event('scroll')); });
  }
  function applyFilter(cards, pause) {
    const onDirectory = isValorantDirectory(), filtering = onDirectory && filterActive(), root = document.documentElement;
    if (filtering) { if (!root.hasAttribute('data-al-filtering')) root.setAttribute('data-al-filtering', ''); }
    else if (root.hasAttribute('data-al-filtering')) root.removeAttribute('data-al-filtering');
    if (pause) { if (!root.hasAttribute('data-al-noload')) root.setAttribute('data-al-noload', ''); }
    else if (root.hasAttribute('data-al-noload')) root.removeAttribute('data-al-noload');
    for (const card of cards) {
      const { element, login } = card;
      const cell = gridItem(element);
      const hide = onDirectory && (filterActive() && tooSmall(card) || !passes(tooSmall(card) ? undefined : results.get(login), login));
      if (hide) {
        if (cell.getAttribute('data-al-hidden') !== 'true') cell.setAttribute('data-al-hidden', 'true');
        if (cell.hasAttribute('data-al-pass')) cell.removeAttribute('data-al-pass');
      } else {
        if (cell.hasAttribute('data-al-hidden')) cell.removeAttribute('data-al-hidden');
        if (!cell.hasAttribute('data-al-pass')) cell.setAttribute('data-al-pass', '');
      }
    }
  }

  // ---------- scanning ----------
  const placeOf = new WeakMap();   // where each card was when it came into view, for reading order
  const observer = new IntersectionObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      if (entry.isIntersecting) { placeOf.set(entry.target, entry.boundingClientRect.top + scrollY); if (!visible.has(entry.target)) { visible.add(entry.target); changed = true; } }
      else visible.delete(entry.target);
    }
    if (changed) askForVisible();
  }, { rootMargin: '200px 0px' });

  // Timing log for development: set agentLensDebug = true in chrome.storage.local.
  let debug = false;
  chrome.storage.local.get('agentLensDebug').then(v => { debug = Boolean(v.agentLensDebug); }).catch(() => {});
  function scan() {
    if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
    const t0 = performance.now();
    try { scanOnce(); } finally {
      lastScanMs = performance.now() - t0;
      if (debug) console.debug(`[AL] scan ${lastScanMs.toFixed(1)} ms, ${items.size} items`);
    }
  }
  function scanOnce() {
    scanTimer = null;
    if (stopped || !assets) return;
    const cards = liveCards(), rows = sidebarRows();
    linkGroups();
    const seen = new Set(), all = [...cards.map(c => ({ ...c, kind: 'card' })), ...rows.map(r => ({ ...r, kind: 'row' }))];
    // New cards: read every anchor's position style first, then write. Interleaving the two would make the
    // browser recalculate the page's styles once per card. The answer is the same for every card of one kind.
    const fresh = [];
    for (const found of all) {
      seen.add(found.element);
      let item = items.get(found.element);
      if (item && (item.login !== found.login || !item.mount.host.isConnected || item.mount.host.parentElement !== found.anchor)) {
        item.mount.host.remove(); items.delete(found.element); item = null;
      }
      if (!item) {
        const key = found.kind + '|' + found.anchor.localName + '|' + found.anchor.className;
        if (!anchorStatic.has(key)) anchorStatic.set(key, getComputedStyle(found.anchor).position === 'static');
        fresh.push({ found, isStatic: anchorStatic.get(key) });
      }
    }
    for (const { found, isStatic } of fresh) {
      const m = mount(found.kind);
      if (isStatic) found.anchor.setAttribute('data-al-anchor', '');
      found.anchor.append(m.host);
      const item = { kind: found.kind, login: found.login, mount: m, viewers: found.viewers };
      items.set(found.element, item);
      observer.observe(found.element);
    }
    for (const found of all) { const item = items.get(found.element); item.viewers = found.viewers; renderItem(found.element, item); }
    for (const [element, item] of items) if (!seen.has(element)) { item.mount.host.remove(); items.delete(element); observer.unobserve(element); visible.delete(element); }
    const pause = loadPause(cards);
    ensureBar(cards);
    renderBar(cards, pause);
    applyFilter(cards, pause);
    askForVisible();
  }
  // Passes are spaced out by how long the last one took, so a big page is never kept busy.
  let lastScanMs = 0;
  function scheduleScan(delay = 150) {
    if (stopped || scanTimer !== null) return;
    scanTimer = setTimeout(scan, Math.min(1500, Math.max(delay, lastScanMs * 5)));
  }
  function refreshAll() { for (const item of items.values()) item.mount.key = null; if (bar) bar.key = null; scan(); }

  async function askForVisible(force = false) {
    if (stopped || document.visibilityState !== 'visible') return;
    const now = Date.now(), logins = new Set(), onScreen = [];
    // On-screen cards in reading order (top to bottom, left to right), so the nearest are read first.
    // (Positions noted by the visibility observer: reading layout here would stall the page.)
    const shown = [...visible].map(element => ({ element, item: items.get(element), top: placeOf.get(element) || 0 }))
      .filter(x => x.item).sort((a, b) => Math.round(a.top / 40) - Math.round(b.top / 40));
    for (const { item } of shown) {
      if (tooSmall(item)) continue;
      onScreen.push(item.login);
      if (force || now - (askedAt.get(item.login) || 0) > ASK_AGAIN_MS) logins.add(item.login);
    }
    // On the VALORANT directory, read every loaded card (after the visible ones) so the filter knows
    // about streams further down; later refreshes cover the whole page only while a filter is on.
    if (isValorantDirectory()) {
      for (const [, item] of items) {
        if (item.kind !== 'card' || tooSmall(item)) continue;
        const last = askedAt.get(item.login);
        if (last === undefined || (filterActive() && now - last > ASK_AGAIN_MS)) logins.add(item.login);
      }
    }
    if (!logins.size) return;
    for (const login of logins) askedAt.set(login, now);
    const reply = await send({ type: 'AL_WANT', logins: [...logins], visible: onScreen });
    if (!reply || !reply.ok) return;
    for (const [login, result] of Object.entries(reply.results || {})) results.set(login, result);
    groupsDirty = true;
    for (const login of reply.queued || []) pending.add(login);
    refreshAll();
  }

  // ---------- current channel, for the toolbar popup ----------
  function currentChannel() {
    const login = loginFrom('/' + (location.pathname.split('/')[1] || ''));
    if (!login || /^(directory|search|settings|videos|following|downloads|subscriptions|inventory|wallet|drops|turbo|jobs|p|u)$/.test(login)) return null;
    const game = document.querySelector('a[data-a-target="stream-game-link"]');
    const sideRow = [...document.querySelectorAll('.side-nav-card')].find(row => loginFrom(row.querySelector('a[href]')?.getAttribute('href')) === login);
    const category = game?.textContent.trim() || sideRow?.querySelector('[data-a-target="side-nav-game-title"], .side-nav-card__metadata p')?.textContent.trim() || '';
    const name = document.querySelector('.channel-info-content h1')?.textContent.trim() || sideRow?.querySelector('[data-a-target="side-nav-title"]')?.textContent.trim() || login;
    return { login, name, category };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || sender.id !== chrome.runtime.id) return false;
    if (message.type === 'AL_RESULT' && LOGIN.test(message.login)) {
      results.set(message.login, message.result);
      pending.delete(message.login);
      groupsDirty = true;
      scheduleScan(300);   // results come in bursts: one pass for several
      return false;
    }
    if (message.type === 'AL_PAGE') {
      const cards = liveCards();
      const found = cards.filter(c => agentOf(results.get(c.login))).length;
      const channel = currentChannel();
      if (channel && (message.read || /valorant/i.test(channel.category))) {
        askedAt.delete(channel.login);
        send({ type: 'AL_WANT', logins: [channel.login] }).then(reply => {
          if (reply && reply.ok) { Object.entries(reply.results || {}).forEach(([l, r]) => results.set(l, r)); (reply.queued || []).forEach(l => pending.add(l)); }
        });
      }
      sendResponse({
        ok: true, directory: isValorantDirectory(), total: cards.length, found,
        channel: channel ? { ...channel, result: results.get(channel.login) || null, pending: pending.has(channel.login) } : null
      });
      return false;
    }
    return false;
  });

  // ---------- start ----------
  async function start() {
    const [stored, data] = await Promise.all([chrome.storage.local.get([SETTINGS_KEY, FILTER_KEY]), send({ type: 'AL_ASSETS' })]);
    settings = { ...DEFAULTS, ...(stored[SETTINGS_KEY] || {}) };
    if (stored[FILTER_KEY]) filter = { roles: [], agents: [], mine: false, ...stored[FILTER_KEY], group: [] };
    if (!data || !data.ok) return;
    assets = data;
    agentById = new Map(data.agents.map(a => [a.id, a]));
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target && target.closest && target.closest('agent-lens, .chat-shell, .chat-room, [data-a-target="chat-scroller"], .video-chat, .stream-chat')) continue;
        if ([...record.addedNodes].every(node => node.nodeType === 1 && node.localName === 'agent-lens')) { if (record.addedNodes.length) continue; }
        scheduleScan(); return;
      }
    });
    // Elements and links coming and going; not text (viewer counts, chat), which changes all the time. A slow
    // pass every few seconds picks up the rare text-only change (a sidebar channel switching game).
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src'] });
    setInterval(() => { if (document.visibilityState === 'visible') scheduleScan(); }, 5000);
    new MutationObserver(() => { const value = theme(); for (const host of document.querySelectorAll('agent-lens')) host.dataset.theme = value; })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[SETTINGS_KEY]) { settings = { ...DEFAULTS, ...(changes[SETTINGS_KEY].newValue || {}) }; refreshAll(); }
      if (changes[FILTER_KEY]) { filter = { roles: [], agents: [], mine: false, ...(changes[FILTER_KEY].newValue || {}), group: filter.group || [] }; refreshAll(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') askForVisible(); });
    // Twitch refreshes preview pictures about every five minutes; ask again now and then while the tab is open.
    setInterval(() => { askForVisible(); scheduleScan(); }, 60 * 1000);
    scan();
  }
  start().catch(() => {});
})();
