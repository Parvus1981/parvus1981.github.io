/* Категории */
const CATS = [
  { id: 'food',      name: '🍎 Еда',       color: '#10b981', kw: ['молок','хлеб','булк','сыр','масл','яйц','курин','мясо','фарш','рис','макаро','овощ','фрукт','яблок','банан','картош','помид','огурц','колбас','йогурт','кефир','творог','сок','водa','воду','круп','сахар','соль','мука','пельмен','суп','макар','сыр','шоколад','кофе','чай','печенье','масло','рыб','морожен','крупа','лактоз','milch','brot','butter','käse','eier','hähnchen','fleisch','hack','reis','nudel','gemüse','obst','apfel','banane','kartoffel','tomate','gurke','wurst','joghurt','quark','saft','wasser','zucker','salz','mehl','suppe','schokolade','kaffee','tee','keks','öl','lebensmittel','milk','bread','cheese','eggs','chicken','meat','rice','pasta','vegetable','fruit','apple','banana','potato','tomato','cucumber','juice','sugar','salt','flour','coffee','tea'] },
  { id: 'kids',      name: '🧒 Дети',      color: '#8b5cf6', kw: ['подгузник','памперс','детск','игрушк','коляск','школ','садик','windel','spielzeug','kinder','schule','diaper','toy','памперс','детское питание','раскраск','пенал'] },
  { id: 'leisure',   name: '🏖 Отдых',     color: '#0ea5e9', kw: ['кино','театр','ресторан','кафе','отпуск','путешеств','бассейн','аквапарк','зоопарк','концерт','hotel','urlaub','kino','restaurant','café','schwimmbad','cinema','travel','пицц','суши'] },
  { id: 'utilities', name: '🏠 Коммуналка', color: '#f59e0b', kw: ['квартплат','коммунал','электро','газ','вода отоп','интернет','телефон','tv','мобил','abfall','strom','gas','miete','rent','internet','handy','utilities','ванка','отоплен'] },
  { id: 'transport', name: '🚌 Транспорт', color: '#6366f1', kw: ['бензин','автобус','метро','трамва','такси','проезд','билет','парков','авто','хоподопуст','benzin','ticket','bushn','bahn','taxi','park','fuel','транспорт','жетон'] },
  { id: 'health',    name: '💊 Здоровье',  color: '#ef4444', kw: ['аптек','таблетк','лекарств','врач','стоматолог','анализ','витамин','повязк','apotheke','arzt','zahn','medikament','vitamin','pharm','medic'] },
  { id: 'clothes',   name: '👕 Одежда',    color: '#ec4899', kw: ['одежд','футболк','джинс','куртк','обувь','кроссовк','ботинк','носк','белье','шарф','kleid','hose','schuh','jacke','socke','clothes','shoes','shirt'] },
  { id: 'home',      name: '🧴 Дом/Прочее', color: '#6b7280', kw: ['мыло','шампун','порошк','чист','туалет бум','моющ','губк','мусор мешк','лампочк','батарейк','цветы','посуда','seife','shampoo','waschmittel','reinig','toilettenpapier','putz','kerze','blumen','soap','shampoo','cleaning'] }
];

function guessCat(name) {
  const n = (name || '').toLowerCase();
  let best = null, bestLen = 0;
  for (const c of CATS) {
    for (const kw of c.kw) {
      if (n.includes(kw) && kw.length > bestLen) { best = c.id; bestLen = kw.length; }
    }
  }
  return best || 'food';
}
function catById(id) { return CATS.find(c => c.id === id) || CATS[CATS.length - 1]; }

/* Разбор текста на строки чека — работает без интернета */
function parseItemsText(text) {
  const items = [];
  for (const chunk of splitChunks(text)) {
    const parsed = parseChunk(chunk);
    if (parsed) items.push(parsed);
  }
  return items;
}

function splitChunks(text) {
  const DEC = '\u0001';
  return text
    .replace(/(\d),(\d)/g, `$1${DEC}$2`)
    .split(/[;\n]|,(?=\s)|(?<=\d[.,\u0001]\d{1,2})\s+(?![\s]*(?:шт|pcs?|кг|г|л|литр|litre?s?|ml|g)\p{L}*(?=[\s.,]|$))(?=[\p{L}])/u)
    .map(s => s.replace(new RegExp(DEC, 'g'), ',').replace(/\s*\((?:было|statt|rgw|uvp)[^)]*\)?\s*/gi, ' ').trim())
    .filter(Boolean);
}

function parseNum(raw) {
  return parseFloat(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
}

const NUM_RE = /\d+(?:[.,]\d{1,2})?/g;
const UNIT_WORDS = 'литр\w*|штук\w*|шт|пачк\w*|пакет\w*|pcs?|кг|г|л|ml|g|ст\.?';

function parseChunk(chunk) {
  const t = chunk.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const nums = [...t.matchAll(NUM_RE)];
  if (!nums.length && t.length < 2) return null;
  let qty = 1;
  let qtyText = '';
  const qtyPats = [
    /(?:^|\s)(?:x|х)\s*(\d{1,3})(?=[\p{L}]*[\s.,]|$)/u,
    /(\d{1,3})\s*(?:штук\w*|шт|пачк\w*|пакет\w*|pcs?)(?=[\p{L}]*[\s.,]|$)/u,
    /(?:^|\s)(\d{1,3})\s*(?:кг|литр|ml|л|шт)(?=[\p{L}]*[\s.,]|$)/u,
    /^\s*(\d{1,3})(?=\s+\S)/
  ];
  for (const re of qtyPats) {
    const m = t.match(re);
    const v = m ? parseNum(m[1]) : 0;
    if (m && v > 0 && v < 100 && Number.isInteger(v) && !/[.,]/.test(m[1])) {
      qty = v;
      qtyText = m[0];
      break;
    }
  }
  if (!qtyText) {
    const mass = t.match(new RegExp(`\\d[.,]?\\d*\\s*(?:${UNIT_WORDS})(?=[\\p{L}]*[\\s.,]|$)`, 'iu'));
    if (mass && parseNum(mass[0]) < 3000) qtyText = mass[0];
  }
  const price = nums.length ? parseNum(nums[nums.length - 1][0]) : 0;
  const name = ((qtyText ? t.replace(new RegExp(qtyText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{L}*', 'u'), ' ') : t)
    .replace(new RegExp(NUM_RE.source, 'g'), ' ')
    .replace(/(?:€|eur|грн|₴|₽|chf|руб|лт)/gi, ' ')
    .replace(new RegExp(`(^|\\s)(?:${UNIT_WORDS})(?=[\\p{L}]*[\\s.,]|$)`, 'giu'), '$1')
    .replace(/\s+/g, ' ').trim()) || 'Без названия';
  return { name, qty, price, cat: guessCat(name) };
}
