/* Семейная синхронизация через секретный Gist на GitHub (без серверов).
   Комната = gist "family-sync.json": список покупок + чат + надгробия удалений.
   Токен хранится только в браузере; запросы идут напрямую к api.github.com. */
const Sync = (() => {
  const FILE = 'family-sync.json';
  let timer = null;
  let busy = false;
  let lastPull = null;
  let onChange = null;       // cb(newMsg|null) — вызывается после каждого тика/записи
  let knownMsgIds = new Set();
  let firstPull = true;

  const cfg = () => {
    const s = Storage.settings();
    return { gistId: (s.familyGistId || '').trim(), token: (s.familyToken || '').trim(),
             me: (s.familyName || '').trim() || 'Я' };
  };
  const ready = () => !!(cfg().gistId && cfg().token);

  function headers() {
    return { 'Accept': 'application/vnd.github+json',
             'Authorization': `Bearer ${cfg().token}`,
             'Content-Type': 'application/json' };
  }

  function blankDoc() { return { v: 1, list: [], chat: [], del: [] }; }

  function parseDoc(gist) {
    try {
      const raw = gist.files && gist.files[FILE] && gist.files[FILE].content;
      if (!raw) return blankDoc();
      const d = JSON.parse(raw);
      return {
        v: 1,
        list: Array.isArray(d.list) ? d.list : [],
        chat: Array.isArray(d.chat) ? d.chat : [],
        del: Array.isArray(d.del) ? d.del : []
      };
    } catch (e) { return blankDoc(); }
  }

  async function createRoom() {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ description: 'family-budget sync (не удаляйте)', public: false,
        files: { [FILE]: { content: JSON.stringify(blankDoc()) } } })
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 100)}`);
    return (await res.json()).id;
  }

  async function pull() {
    const res = await fetch(`https://api.github.com/gists/${cfg().gistId}?t=${Date.now()}`, { headers: headers() });
    if (res.status === 401) throw new Error('401: токен GitHub недействителен');
    if (res.status === 404) throw new Error('404: комната не найдена — проверьте ID');
    if (res.status === 403) throw new Error('403: токен без прав на Gists');
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    lastPull = parseDoc(await res.json());
    return lastPull;
  }

  async function writeDoc(next) {
    const res = await fetch(`https://api.github.com/gists/${cfg().gistId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(next) } } })
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    lastPull = next;
  }

  const nowISO = () => new Date().toISOString();

  /* --- локальные изменения → комната --- */
  async function reconcile() {
    if (busy || !ready() || !lastPull) return;
    busy = true;
    try {
      const next = JSON.parse(JSON.stringify(lastPull));
      next.list = next.list || [];
      next.del = next.del || [];
      const delIds = new Set(next.del.map(d => d.id));
      const locIds = new Set(Storage.basket().map(b => b.id));
      let dirty = false;
      const delIds0 = new Set(next.del.map(d => d.id));
      const locIds0 = new Set(Storage.basket().map(b => b.id));
      const pend = Storage.pendingDel ? Storage.pendingDel() : [];
      const newDel = [];
      for (const d of pend) if (!delIds0.has(d.id) && !locIds0.has(d.id)) { next.del.push(d); delIds0.add(d.id); newDel.push(d.id); dirty = true; }
      next.del = next.del.slice(-80);

      for (const b of Storage.basket()) {
        const ex = next.list.find(x => x.id === b.id);
        const at = b.at || nowISO();
        if (ex) {
          if (at > (ex.at || '')) {
            Object.assign(ex, { name: b.name, qty: b.qty || 1, done: !!b.done, at, from: ex.from || cfg().me });
            dirty = true;
          }
        } else if (!delIds.has(b.id)) {
          next.list.push({ id: b.id, name: b.name, qty: b.qty || 1, done: !!b.done, from: cfg().me, at });
          dirty = true;
        }
      }
      const before = next.list.length;
      next.list = next.list.filter(r => locIds.has(r.id) || delIds.has(r.id));
      if (next.list.length !== before) {
        for (const gone of lastPull.list || []) {
          if (!locIds.has(gone.id) && !delIds.has(gone.id)) {
            next.del.push({ id: gone.id, at: nowISO() });
          }
        }
        next.del = next.del.slice(-80);
        dirty = true;
      }
      if (dirty) { next.updatedAt = nowISO(); await writeDoc(next); if (newDel.length && Storage.ackDel) Storage.ackDel(newDel); }
    } finally { busy = false; }
  }

  /* --- комната → локально --- */
  function mergeToLocal(remote) {
    // удаления от семьи: убрать локально то, что удалено в комнате
    for (const d of (remote.del || [])) {
      if (Storage.basket().some(b => b.id === d.id)) Storage.delFromBasket(d.id);
    }
    const basket = Storage.basket();
    const byId = new Map(basket.map(b => [b.id, b]));
    const delIds = new Set((remote.del || []).map(d => d.id));
    Storage.pendingDel().forEach(d => delIds.add(d.id));
    for (const r of (remote.list || [])) {
      if (delIds.has(r.id)) continue;
      const loc = byId.get(r.id);
      if (loc) {
        const rAt = r.at || '';
        if (rAt && rAt > (loc.at || '')) {
          Object.assign(loc, { name: r.name, qty: r.qty || 1, done: !!r.done, at: rAt });
          Storage.save();
        }
      } else {
        Storage.addToBasket({ id: r.id, name: r.name, qty: r.qty || 1, done: !!r.done, at: r.at || nowISO() });
        if (!firstPull && r.from !== cfg().me) {
          toast(`🛒 ${r.from || 'Семья'}: ${r.name}`, 3200);
          if (navigator.vibrate) navigator.vibrate(60);
        }
      }
    }
  }

  async function tick() {
    if (busy || !ready()) return;
    try {
      const remote = await pull();
      mergeToLocal(remote);
      await reconcile();
      const newMsgs = (remote.chat || []).filter(m => !knownMsgIds.has(m.id));
      newMsgs.forEach(m => knownMsgIds.add(m.id));
      firstPull = false;
      Sync.lastSync = new Date();
      Sync.lastError = null;
      if (onChange && newMsgs.length) onChange(newMsgs[newMsgs.length - 1]);
      else if (onChange) onChange(null);
    } catch (e) {
      Sync.lastError = e.message;
      if (onChange) onChange(null);
    }
  }

  async function sendChat(text) {
    const c = cfg();
    const msg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                  text, by: c.me, at: nowISO() };
    knownMsgIds.add(msg.id);
    const doc = lastPull || await pull();
    const next = JSON.parse(JSON.stringify(doc));
    next.chat = [...(next.chat || []), msg].slice(-80);
    next.updatedAt = nowISO();
    await writeDoc(next);
    if (onChange) onChange(null);
    return msg;
  }

  function start() {
    stop();
    if (!ready()) return false;
    tick();
    timer = setInterval(tick, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    return true;
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    ready, cfg, createRoom, start, stop, sendChat, tick,
    lastError: null, lastSync: null,
    setOnChange(cb) { onChange = cb; },
    chat: () => lastPull ? (lastPull.chat || []) : []
  };
})();
