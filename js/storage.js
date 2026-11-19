/* Хранилище данных в localStorage — всё остаётся на устройстве пользователя */
const Storage = (() => {
  const KEY = 'family-budget-v2';
  const DEFAULT_STORES = [
    { name: 'K+K Klaas & Kock', url: 'https://www.klaas-und-kock.de/angebote/unsere-angebote/', color: '#c8102e', dist: 1.0, key: 'klaas-kock' },
    { name: 'Lidl', url: 'https://www.lidl.de/filialen', color: '#0050aa', dist: 1.0, key: 'lidl' },
    { name: 'Netto Marken-Discount', url: 'https://www.netto-online.de/angebote', color: '#ffcc00', dist: 1.5, key: 'netto-marken-discount' },
    { name: 'REWE', url: 'https://www.rewe.de/angebote/', color: '#cc071e', dist: 1.2, key: 'rewe' },
    { name: 'Combi', url: 'https://www.combi.de/angebote', color: '#e30613', dist: 1.6, key: 'combi' },
    { name: 'Kaufland', url: 'https://www.kaufland.de/aktuelles/angebote.html', color: '#e10914', dist: 3.0, key: 'kaufland' },
    { name: 'PENNY', url: 'https://www.penny.de/angebote', color: '#d81e05', dist: 2.0, key: 'penny' },
    { name: 'Getränke Hoffmann', url: 'https://www.gh-offers.de/', color: '#0e2c66', dist: 2.2, key: 'getraenke-hoffmann' },
    { name: 'EDEKA', url: 'https://www.edeka.de/angebote.jsp', color: '#001e50', dist: 2.5, key: 'edeka' },
    { name: 'ALDI', url: 'https://www.aldi-nord.de/unsere-angebote.html', color: '#0a2896', dist: 2.4, key: 'aldi' },
    { name: 'dm', url: 'https://www.dm.de/angebote', color: '#002878', dist: 1.8, key: 'dm' },
    { name: 'Rossmann', url: 'https://www.rossmann.de/de/aktuelle-prospekte', color: '#c3002d', dist: 1.8, key: 'rossmann' }
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
        zip: '48431'
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
