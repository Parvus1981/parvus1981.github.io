/* Хранилище данных в localStorage — всё остаётся на устройстве пользователя */
const Storage = (() => {
  const KEY = 'family-budget-v2';
  // Только магазины, реально существующие в Райне-Мезуме (48432):
  // K+K (Mesum-Rheiner Str. 46), Netto (Dille 38), Lidl (Dechant-Römer-Str. 19),
  // ALDI Nord (Dille 57), EDEKA Borgmann (Alte Bahnhofstr. 30-32)
  const DEFAULT_STORES = [
    { name: 'K+K Klaas & Kock', url: 'https://www.klaas-und-kock.de/', color: '#c8102e', dist: null, key: 'klaas-kock', addr: 'Mesum-Rheiner Str. 46' },
    { name: 'Netto Marken-Discount', url: 'https://www.marktguru.de/r/netto-marken-discount', color: '#ffcc00', dist: null, key: 'netto-marken-discount', addr: 'Dille 38' },
    { name: 'Lidl', url: 'https://www.lidl.de/l/aktuelle-prospekte', color: '#0050aa', dist: null, key: 'lidl', addr: 'Dechant-Römer-Str. 19' },
    { name: 'ALDI Nord', url: 'https://www.aldi-nord.de/angebote.html', color: '#0a2896', dist: null, key: 'aldi-nord', addr: 'Dille 57' },
    { name: 'EDEKA Borgmann', url: 'https://www.edeka.de/', color: '#001e50', dist: null, key: 'edeka', addr: 'Alte Bahnhofstr. 30-32' }
  ];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function blank() {
    return {
      settings: {
        currency: '€',
        voiceLang: 'ru-RU',
        ocrLang: 'deu+rus+eng',
        aiKey: '',
        stores: DEFAULT_STORES,
        zip: '48432',
        city: 'Mesum'
      },
      txs: [],
      budgets: {},
      defaults: {},
      goals: [],
      basket: []
    };
  }

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const base = blank();
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      const merged = { ...base, ...parsed };
      merged.settings = { ...base.settings, ...parsed.settings };
      if (!Array.isArray(merged.settings.stores) || !merged.settings.stores.length) {
        merged.settings.stores = base.settings.stores;
      }
      const aliases = { aldi: 'aldi-nord', dm: 'dm-drogerie-markt' };
      merged.settings.stores = merged.settings.stores.map(s => {
        if (s.key && aliases[s.key]) s = { ...s, key: aliases[s.key], name: aliases[s.key] === 'aldi-nord' ? 'ALDI Nord' : 'dm' };
        const def = s.key && base.settings.stores.find(d => d.key === s.key);
        return def ? { ...def, addr: def.addr, dist: s.dist != null ? s.dist : null } : s;
      });
      // если список магазинов — нетронутый старый набор по умолчанию (12 сетей) —
      // заменяем на реальный набор Мезума, выдуманные магазины мешают
      const OLD_DEFAULT_KEYS = ['klaas-kock','lidl','netto-marken-discount','rewe','combi','kaufland','penny','getraenke-hoffmann','edeka','aldi-nord','dm-drogerie-markt','rossmann'].sort().join(',');
      const curKeys = merged.settings.stores.map(s => s.key || '').sort().join(',');
      if (curKeys === OLD_DEFAULT_KEYS) merged.settings.stores = base.settings.stores.map(s => ({ ...s }));
      return merged;
    } catch (e) {
      console.error('load error', e);
      return blank();
    }
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(data)); }

  return {
    get data() { return data; },
    settings: () => data.settings,
    save,

    addTx(tx) { data.txs.push(tx); save(); },
    delTx(id) { data.txs = data.txs.filter(t => t.id !== id); save(); },

    monthKey(date) { return (date || '').slice(0, 7) || new Date().toISOString().slice(0, 7); },
    txsForMonth(mkey) {
      return data.txs.filter(t => Storage.monthKey(t.date) === mkey)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    spentByCat(mkey) {
      const sum = {};
      for (const t of Storage.txsForMonth(mkey)) sum[t.cat] = (sum[t.cat] || 0) + t.total;
      return sum;
    },

    budgetFor(mkey) {
      return { ...data.defaults, ...(data.budgets[mkey] || {}) };
    },
    setBudget(mkey, catId, limit) {
      data.budgets[mkey] = data.budgets[mkey] || {};
      if (limit === '' || limit == null) delete data.budgets[mkey][catId];
      else data.budgets[mkey][catId] = Number(limit);
      save();
    },
    setDefault(catId, limit) {
      if (limit === '' || limit == null) delete data.defaults[catId];
      else data.defaults[catId] = Number(limit);
      save();
    },

    goals: () => data.goals,
    addGoal(g) { data.goals.push(g); save(); },
    delGoal(id) { data.goals = data.goals.filter(g => g.id !== id); save(); },
    addGoalAmount(id, amt) {
      const g = data.goals.find(x => x.id === id);
      if (g) { g.saved = Math.min(g.target, (g.saved || 0) + amt); save(); }
    },

    basket: () => data.basket,
    addToBasket(item) {
      const norm = item.name.trim().toLowerCase();
      const same = data.basket.find(b => b.name.trim().toLowerCase() === norm);
      if (same) same.qty += item.qty || 1;
      else data.basket.push({ id: uid(), name: item.name, qty: item.qty || 1, done: false });
      save();
    },
    updateBasket(id, patch) {
      const b = data.basket.find(x => x.id === id);
      if (b) { Object.assign(b, patch); save(); }
    },
    delFromBasket(id) { data.basket = data.basket.filter(b => b.id !== id); save(); },
    clearCheckedBasket() { data.basket = data.basket.filter(b => !b.done); save(); },

    updateSettings(patch) { data.settings = { ...data.settings, ...patch }; save(); },
    stores: () => data.settings.stores,
    setStores(list) { data.settings.stores = list; save(); },
    storeByKey(u) {
      return data.settings.stores.find(s => s.key === u || s.name.toLowerCase() === (u || '').toLowerCase()) || null;
    },

    export() {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `family-budget-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.txs)) throw new Error('Неверный формат файла');
      data = { ...blank(), ...parsed };
      data.settings = { ...blank().settings, ...parsed.settings };
      save();
    },
    wipe() {
      localStorage.removeItem(KEY);
      data = blank();
    }
  };
})();
