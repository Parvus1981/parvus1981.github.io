/* Акции: загрузка data/deals.json (обновляется GitHub Actions ежедневно) + умный матчинг корзины */
const Deals = (() => {
  let cache = null;

  async function load(force) {
    if (cache && !force) return cache;
    try {
      const res = await fetch('data/deals.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('файл акций не найден');
      const j = await res.json();
      cache = j;
      try { localStorage.setItem('fb-deals-cache', JSON.stringify(j)); } catch (e) { /* переполнение */ }
      return j;
    } catch (e) {
      try {
        const raw = localStorage.getItem('fb-deals-cache');
        if (raw) { cache = JSON.parse(raw); return cache; }
      } catch (e2) { /* пусто */ }
      throw e;
    }
  }


  /* рус→нем словарь базовых продуктов */
  const RU_DE = {
    'молоко': 'milch', 'масло сливочное': 'butter', 'масло': 'butter', 'сливки': 'sahne',
    'йогурт': 'joghurt', 'творог': 'quark', 'сметана': 'sahne schmand', 'сыр': 'käse frischkäse', 'яйца': 'eier', 'яйцо': 'eier', 'яиц': 'eier',
    'хлеб': 'brot', 'булочки': 'brötchen', 'булочка': 'brötchen', 'тост': 'toastbrot',
    'макароны': 'nudeln spaghetti', 'спагетти': 'spaghetti', 'рис': 'reis', 'мука': 'mehl',
    'сахар': 'zucker', 'соль': 'salz', 'перец': 'pfeffer', 'масло растительное': 'öl',
    'уксус': 'essig', 'кечуп': 'ketchup', 'майонез': 'mayonnaise', 'горчица': 'senf',
    'помидоры': 'tomaten', 'огурцы': 'gurken', 'перец болгарский': 'paprika', 'лук': 'zwiebeln',
    'морковь': 'karotten', 'картошка': 'kartoffeln', 'яблоки': 'apfel', 'бананы': 'banane',
    'апельсины': 'orange', 'мандарины': 'mandarine', 'лимон': 'zitrone', 'виноград': 'weintrauben',
    'салат': 'salat', 'брокколи': 'brokkoli', 'шпинат': 'spinat', 'грибы': 'champignons',
    'авокадо': 'avocado', 'чеснок': 'knoblauch',
    'фарш': 'hackfleisch', 'курица': 'hähnchen', 'индейка': 'putenbrust', 'свинина': 'schweinefilet',
    'говядина': 'rindergulasch', 'колбаски': 'bratwurst würstchen', 'сардельки': 'würstchen',
    'ветчина': 'schinken', 'салями': 'salami', 'рыба': 'fisch', 'лосось': 'lachs',
    'тунец': 'thunfisch', 'креветки': 'garnelen shrimps',
    'пицца': 'pizza', 'картофель фри': 'pommes', 'мороженое': 'eis',
    'горох': 'erbsen', 'кукуруза': 'mais', 'фасоль': 'bohnen',
    'кофе': 'kaffee espresso', 'чай': 'tee', 'какао': 'kakao',
    'сок': 'saft', 'яблочный сок': 'apfelsaft', 'апельсиновый сок': 'orangensaft',
    'вода': 'mineralwasser', 'кола': 'cola', 'лимонад': 'limonade',
    'пиво': 'bier', 'радлер': 'radler', 'вино': 'wein', 'шампанское': 'sekt prosecco',
    'чипсы': 'chips', 'орехи': 'nüsse', 'шоколад': 'schokolade', 'батончик': 'riegel',
    'печенье': 'kekse', 'торт': 'kuchen', 'выпечка': 'gebäck',
    'джем': 'marmelade', 'мёд': 'honig', 'нутелла': 'nussnougatcreme',
    'мюсли': 'müsli', 'хлопья': 'cornflakes haferflocken', 'овсянка': 'haferflocken',
    'подгузники': 'windeln', 'памперсы': 'windeln', 'влажные салфетки': 'feuchttücher',
    'туалетная бумага': 'toilettenpapier', 'бумажные полотенца': 'küchenrolle',
    'мусорные мешки': 'müllbeutel', 'губки': 'schwämme', 'средство для посуды': 'spülmittel',
    'таблетки для посудомойки': 'geschirrspültabs', 'порошок': 'waschmittel',
    'кондиционер': 'weichspüler', 'чистящее': 'putzmittel', 'мыло': 'seife',
    'гель для душа': 'duschgel', 'шампунь': 'shampoo', 'зубная паста': 'zahnpasta',
    'зубная щётка': 'zahnbürste', 'дезодорант': 'deo', 'лосьон': 'bodylotion',
    'батарейки': 'batterien', 'фольга': 'alufolie', 'пергамент': 'backpapier',
    'пакеты для заморозки': 'gefrierbeutel', 'кошачий корм': 'katzenfutter', 'собачий корм': 'hundefutter'
  };

  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-zа-яё0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  const STOP = new Set(['und', 'mit', 'je', 'die', 'der', 'das', 'fur', 'vom', 'im', 'in', 'aus', 'zu', 'app', 'pro']);
  function stem(t) {
    const s = t.replace(/(?:en|es|er|n|e)$/g, '');
    return s.length > 2 ? s : t;
  }
  function tokens(s) {
    return norm(s).split(' ').filter(t => t.length > 2 && !STOP.has(t))
      .map(stem).filter(t => t.length > 2);
  }

  function expandQuery(name) {
    const n = norm(name);
    let q = [];
    for (const [ru, de] of Object.entries(RU_DE)) {
      if (n.includes(norm(ru))) q.push(de);
    }
    if (!q.length) q.push(n);
    return q.join(' ');
  }

  function hit(hay, t) {
    return hay.split(' ').some(w => w === t || w.startsWith(t) || (t.length >= 5 && w.includes(t)));
  }

  function score(offer, itemToks, qWords) {
    const n = norm(offer.n || '');
    const b = norm(offer.b || '');
    const d = norm(offer.d || '');
    let score = 0;
    for (const w of qWords) {
      for (const t of tokens(w)) {
        if (n && hit(n, t)) score += 4;
        else if (b && hit(b, t)) score += 2;
        else if (d && hit(d, t)) score += 0.5;
      }
    }
    for (const t of itemToks) {
      if (n && hit(n, t)) score += 2;
      else if (b && hit(b, t)) score += 1;
    }
    return score;
  }

  /* Поиск лучших предложений для позиции корзины */
  function findFor(itemName, offers, max = 6) {
    const qWords = expandQuery(itemName).split(' ').filter(Boolean);
    const itemToks = tokens(itemName);
    if (!qWords.length && !itemToks.length) return [];
    const scored = [];
    for (const o of offers) {
      const s = score(o, itemToks, qWords);
      if (s >= 2) scored.push({ o, s });
    }
    scored.sort((a, b) => b.s - a.s || (a.o.p / Math.max(1, a.o.q || 1)) - (b.o.p / Math.max(1, b.o.q || 1)));
    // Оставляем по лучшему предложению от каждого магазина
    const seen = new Set();
    const out = [];
    for (const { o } of scored) {
      const k = o.s[0]?.u || 'x';
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(o);
      if (out.length >= max) break;
    }
    return out;
  }

  function bestByStore(basket, offers) {
    const totals = new Map();
    for (const item of basket) {
      if (item.done) continue;
      const offs = findFor(item.name, offers, 20);
      const perStore = new Map();
      for (const o of offs) {
        const key = o.s[0]?.u || '?';
        const cur = perStore.get(key);
        if (!cur || o.p < cur.p) perStore.set(key, o);
      }
      for (const [key, o] of perStore) {
        const rec = totals.get(key) || { store: o.s[0]?.n || '?', key, sum: 0, covers: 0, items: [] };
        rec.sum += o.p * (item.qty || 1);
        rec.covers++;
        rec.items.push(item.name);
        totals.set(key, rec);
      }
    }
    return totals;
  }

  function discountPct(o) {
    if (!o.op || o.op <= o.p) return 0;
    return Math.round((1 - o.p / o.op) * 100);
  }

  function topDeals(offers, n = 24) {
    return offers
      .map(o => ({ o, d: discountPct(o) }))
      .sort((a, b) => b.d - a.d)
      .slice(0, n)
      .map(x => x.o);
  }

  return { load, findFor, bestByStore, discountPct, topDeals, expandQuery, _cache: () => cache };
})();
