// Ежедневное обновление акций: marktguru.de → data/deals.json
// Запускается GitHub Actions в 06:30 по Берлину. Словарь товаров: config/terms.txt, zip: config/settings.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const pool = { apiKey: null, clientKey: null };

async function loadKeys() {
  const html = await (await fetch('https://www.marktguru.de/', { headers: { 'User-Agent': UA } })).text();
  const re = /<script\s+type=["']application\/json["']>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.config?.apiKey) {
        pool.apiKey = j.config.apiKey;
        pool.clientKey = j.config.clientKey;
        return;
      }
    } catch { /* следующий блок */ }
  }
  throw new Error('Не удалось извлечь ключи marktguru');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function searchOffers(q, zip, limit = 40) {
  const url = `https://api.marktguru.de/api/v1/offers/search?as=web&q=${encodeURIComponent(q)}&limit=${limit}&offset=0&zipCode=${zip}`;
  let res = await fetch(url, { headers: { 'x-apikey': pool.apiKey, 'x-clientkey': pool.clientKey, 'User-Agent': UA } });
  if (res.status === 403 || res.status === 429) {
    await sleep(3000);
    await loadKeys();
    res = await fetch(url, { headers: { 'x-apikey': pool.apiKey, 'x-clientkey': pool.clientKey, 'User-Agent': UA } });
  }
  if (!res.ok) throw new Error(`marktguru ${res.status}`);
  const j = await res.json();
  return j.results || [];
}

function image(id) {
  return `https://mg2de.b-cdn.net/api/v1/offers/${id}/images/default/0/small.jpg`;
}

function compact(o) {
  const v = o.validityDates?.[0] || {};
  return {
    i: o.id,
    n: o.product?.name || o.brand?.name || 'Товар',
    b: o.brand?.name || null,
    d: o.description || null,
    p: o.price,
    op: o.oldPrice || null,
    u: o.unit?.shortName || null,
    q: o.quantity || 1,
    v: o.volume || null,
    s: (o.advertisers || []).map(a => ({ u: a.uniqueName, n: a.name })),
    e: o.externalUrl || null,
    f: v.from || null,
    t: v.to || null,
    img: image(o.id)
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const validToday = o => (!o.f || o.f.slice(0, 10) <= today()) && (!o.t || o.t.slice(0, 10) >= today());

// Скачивает惧 все части пагинации
async function pullAll(q, zip) {
  const out = [];
  for (let offset = 0; offset < 400; offset += 100) {
    const url = `https://api.marktguru.de/api/v1/offers/search?as=web&q=${encodeURIComponent(q)}&limit=100&offset=${offset}&zipCode=${zip}`;
    const res = await fetch(url, { headers: { 'x-apikey': pool.apiKey, 'x-clientkey': pool.clientKey, 'User-Agent': UA } });
    if (!res.ok) break;
    const j = await res.json();
    const part = j.results || [];
    out.push(...part);
    if (part.length < 100) break;
    await sleep(400);
  }
  return out;
}

async function main() {
  const settings = JSON.parse(readFileSync(join(root, 'config', 'settings.json'), 'utf8'));
  const zip = settings.zip || '48431';
  const terms = readFileSync(join(root, 'config', 'terms.txt'), 'utf8')
    .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

  console.log(`zip=${zip}, terms=${terms.length}`);
  await loadKeys();

  const map = new Map();
  let failed = 0;
  for (const term of terms) {
    try {
      const offers = await pullAll(term, zip);
      for (const o of offers) {
        if (!o.price && o.price !== 0) continue;
        const c = compact(o);
        if (!validToday(c)) continue;
        if (!map.has(c.i)) map.set(c.i, c);
      }
      console.log(`${term}: +${offers.length} (всего ${map.size})`);
    } catch (e) {
      failed++;
      console.error(`${term}: ${e.message}`);
    }
    await sleep(500);
  }

  if (map.size === 0) throw new Error('Ни одного предложения не получено');

  // Сортировка: по магазину, затем цене
  const offers = [...map.values()].sort((a, b) =>
    (a.s[0]?.n || '').localeCompare(b.s[0]?.n || '') || a.p - b.p);

  mkdirSync(join(root, 'data'), { recursive: true });
  const out = { updated: new Date().toISOString(), zip, count: offers.length, failed, offers };
  writeFileSync(join(root, 'data', 'deals.json'), JSON.stringify(out));
  console.log(`OK: ${offers.length} предложений → data/deals.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB), неуспешно: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
