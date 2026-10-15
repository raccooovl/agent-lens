// Agent Lens toolbar popup: what the current tab shows, your agents, and display settings.
(async () => {
  'use strict';
  const { t, tp } = globalThis.AgentLensI18n;
  const SETTINGS_KEY = 'agentLensSettings';
  const DEFAULTS = { badges: true, scores: true, sidebar: true, quality: 'high', favorites: [], minViewers: 0 };
  const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
  const SCREEN_TEXT = { select: 'screenSelect', menu: 'screenMenu', dead: 'screenDead', roundEnd: 'screenRoundEnd', buy: 'screenBuy', broadcast: 'screenBroadcast', deathmatch: 'screenDeathmatch' };
  const MODE_TEXT = { competitive: 'modeCompetitive', unrated: 'modeUnrated', swiftplay: 'modeSwiftplay', deathmatch: 'modeDeathmatch' };
  const ROLE_TEXT = { Duelist: 'roleDuelist', Initiator: 'roleInitiator', Controller: 'roleController', Sentinel: 'roleSentinel' };
  const el = (tag, attrs = {}, ...children) => {
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
  };
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  document.documentElement.lang = t('localeCode');
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  const meta = await fetch('data/agents.json').then(r => r.json());
  const agents = new Map(meta.agents.map(a => [a.id, a]));
  const face = id => `background-image:url("img/agents/${id}.webp");background-color:${agents.get(id).color}`;
  let settings = { ...DEFAULTS, ...((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {}) };
  const save = () => chrome.storage.local.set({ [SETTINGS_KEY]: settings });

  // ---- My agents ----
  const agentsBox = document.getElementById('agents');
  function renderAgents() {
    agentsBox.replaceChildren(...ROLES.map(role => el('div', { class: 'role', role: 'group', 'aria-label': t(ROLE_TEXT[role]) },
      el('span', { class: 'role-icon', title: t(ROLE_TEXT[role]), style: `--icon:url("img/roles/${role.toLowerCase()}.png")` }),
      el('div', { class: 'faces' }, meta.agents.filter(a => a.role === role).sort((a, b) => a.name.localeCompare(b.name)).map(agent =>
        el('button', { class: 'pick', type: 'button', title: agent.name, 'aria-label': agent.name, 'aria-pressed': String(settings.favorites.includes(agent.id)), style: face(agent.id),
          onclick: () => {
            settings.favorites = settings.favorites.includes(agent.id) ? settings.favorites.filter(id => id !== agent.id) : [...settings.favorites, agent.id];
            save(); renderAgents();
          } }))))));
  }
  renderAgents();

  // ---- Settings ----
  const toggles = [
    ['badges', 'settingBadges'], ['scores', 'settingScores'], ['sidebar', 'settingSidebar'], ['quality', 'settingQuality', 'settingQualityHint']
  ];
  // Minimum viewers: streams below it aren't downloaded at all.
  const minSelect = el('select', { class: 'select', 'aria-label': t('settingMinViewers') },
    [0, 10, 25, 50, 100, 250].map(n => el('option', { value: String(n), text: n ? t('minViewersCount', { count: n }) : t('minViewersAll') })));
  minSelect.value = String([0, 10, 25, 50, 100, 250].includes(Number(settings.minViewers)) ? Number(settings.minViewers) : 0);
  minSelect.addEventListener('change', () => { settings.minViewers = Number(minSelect.value); save(); });
  document.getElementById('settings').replaceChildren(...toggles.map(([key, label, hint]) => {
    const input = el('input', { type: 'checkbox', role: 'switch' });
    input.checked = key === 'quality' ? settings.quality !== 'standard' : settings[key] !== false;
    input.addEventListener('change', () => { settings[key] = key === 'quality' ? (input.checked ? 'high' : 'standard') : input.checked; save(); });
    return el('label', { class: 'switch' }, el('span', {}, t(label), hint ? el('small', { text: t(hint) }) : null), input);
  }), el('label', { class: 'option' }, el('span', {}, t('settingMinViewers'), el('small', { text: t('settingMinViewersHint') })), minSelect));

  // ---- This tab ----
  const tabBox = document.getElementById('tab');
  const lens = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<circle cx="12" cy="12" r="9.5" fill="none" stroke="#ff4655" stroke-width="2.4"/><path d="M12 6.8 17.2 12 12 17.2 6.8 12Z" fill="#ff4655"/>'; return s; };
  function openDirectory() { chrome.tabs.create({ url: 'https://www.twitch.tv/directory/category/valorant' }); window.close(); }
  function renderTab(page) {
    if (!page) {
      tabBox.replaceChildren(el('span', { class: 'face empty' }, lens()),
        el('div', { class: 'text' }, el('span', { class: 'line', text: t('popupNotTwitch') }), el('button', { class: 'cta', type: 'button', onclick: openDirectory }, t('popupOpenDirectory'))));
      return;
    }
    const ch = page.channel;
    if (ch && (ch.result || ch.pending || /valorant/i.test(ch.category))) {
      const r = ch.result, agent = r && r.agent ? agents.get(r.agent) : null;
      let line;
      const live = r && (r.status === 'agent' || r.status === 'spectating');
      const scoreText = () => {
        const hot = Math.max(r.score.left, r.score.right) >= 12;
        return el('span', { class: 'score' + (hot ? ' hot' : ''), text: t('badgeScore', { round: r.score.left + r.score.right + 1, left: r.score.left, right: r.score.right }) });
      };
      if (agent) {
        const parts = [t('sidebarPlaying', { agent: agent.name })];
        if (r.status === 'spectating') parts.push(' · ', t('popupSpectating'));
        if (live && r.score) parts.push(' · ', scoreText());
        if (!live) parts.push(' · ', tp('popupSeenAgo', Math.max(1, Math.round((Date.now() - r.seenAt) / 60000))));
        if (!live && SCREEN_TEXT[r.screen]) parts.push(' · ', t(SCREEN_TEXT[r.screen]));
        line = el('span', { class: 'line' }, ...parts);
      } else if (r && r.status === 'spectating') {
        line = el('span', { class: 'line' }, t('badgeSpectatingUnknown', { name: ch.name, agent: (agents.get(r.watching) || {}).name || '?' }), r.score ? [' · ', scoreText()] : null);
      } else if (r && r.status === 'offline') line = el('span', { class: 'line', text: t('popupChannelOffline', { name: ch.name }) });
      else if (r && r.status === 'maybe' && agents.get(r.maybe)) line = el('span', { class: 'line' }, t('popupMaybe', { agent: agents.get(r.maybe).name }), r.score ? [' · ', scoreText()] : null);
      else if (r && r.status === 'none' && SCREEN_TEXT[r.screen]) line = el('span', { class: 'line' }, t(SCREEN_TEXT[r.screen]), r.score ? [' · ', scoreText()] : null);
      else if (r && r.status !== 'error' && !ch.pending) line = el('span', { class: 'line', text: t('popupChannelNone', { name: ch.name }) });
      else line = el('span', { class: 'line', text: t('popupChannelReading', { name: ch.name }) });
      const shownFace = agent || (r && r.status === 'maybe' ? agents.get(r.maybe) : null);
      const m = r && r.match, info = m ? [m.map ? m.map.charAt(0).toUpperCase() + m.map.slice(1) : '', m.mode && MODE_TEXT[m.mode] ? t(MODE_TEXT[m.mode]) : ''].filter(Boolean).join(' · ') : '';
      if (info) line = el('span', { class: 'line' }, line, el('span', { class: 'sub', text: info }));
      tabBox.replaceChildren(shownFace ? el('span', { class: 'face' + (agent ? '' : ' maybe'), style: face(shownFace.id) }) : el('span', { class: 'face empty' }, lens()),
        el('div', { class: 'text' }, el('span', { class: 'name', text: ch.name }), line));
      return;
    }
    if (page.total) {
      tabBox.replaceChildren(el('span', { class: 'face empty' }, lens()), el('div', { class: 'text' },
        el('span', { class: 'name', text: 'VALORANT' }), el('span', { class: 'line', text: t('popupPageCount', { found: page.found, total: page.total }) })));
      return;
    }
    renderTab(null);
  }
  let tab = null;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (_) { /* no tab access */ }
  async function ask(read) {
    if (!tab || !Number.isInteger(tab.id)) return null;
    try { return await Promise.race([chrome.tabs.sendMessage(tab.id, { type: 'AL_PAGE', read }), new Promise(r => setTimeout(() => r(null), 1200))]); }
    catch (_) { return null; }
  }
  let page = await ask(true);
  renderTab(page);
  // Keep the card current while a stream is being read.
  const timer = setInterval(async () => {
    page = await ask(false);
    renderTab(page);
    if (!page || !page.channel || (page.channel.result && !page.channel.pending)) clearInterval(timer);
  }, 1000);
})();
