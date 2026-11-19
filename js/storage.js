/* Хранилище данных в localStorage — всё остаётся на устройстве пользователя */
const Storage = (() => {
  const KEY = 'family-budget-v1';
  const DEFAULT_MARKETS = [
    { name: 'Lidl', url: 'https://www.lidl.de/c/aktuelle-angebote', color: '#0050aa' },
    { name: 'Lidl AT', url: 'https://www.lidl.at/c/aktuelle-wochenangebote', color: '#0050aa' },
    { name: 'Hofer/Aldi', url: 'https://www.hofer.at/de/angebote.html', color: '#0a2896' },
    { name: 'Billa', url: 'https://www.billa.at/angebote', color: '#e30613' },
    { name: 'Spar', url: 'https://www.interspar.at/shop/lebensmittel/aktuelle-angebote/', color: '#007833' },
    { name: 'Penny', url: 'https://www.penny.at/angebote', color: '#d81e05' },
    { name: 'Kaufland', url: 'https://www.kaufland.de/aktuelles/angebote.html', color: '#e10914' },
    { name: 'Lidl UA', url: 'https://www.lidl-ukraine.ua/aktsii/', color: '#0050aa' }
  ];

  function blank() {
    return {
      settings: {
        currency: '€',
        voiceLang: 'de-DE',
        ocrLang: 'deu+rus+eng',
        aiKey: '',
        markets: DEFAULT_MARKETS
      },
      txs: [],
      budgets: {},          // { 'YYYY-MM': { catId: limit } }
      defaults: {},         // { catId: limit }
      goals: []             // { id, name, target, saved }
    };
  }

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const parsed = JSON.parse(raw);
      const base = blank();
      const merged = { ...base, ...parsed };
      merged.settings = { ...base.settings, ...parsed.settings };
      if (!Array.isArray(merged.settings.markets) || !merged.settings.markets.length) {
        merged.settings.markets = base.settings.markets;
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

    updateSettings(patch) { data.settings = { ...data.settings, ...patch }; save(); },
    setMarkets(list) { data.settings.markets = list; save(); },

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
