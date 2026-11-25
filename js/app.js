/* Семейный бухгалтер v2: корзина → сравнение акций рядом; учёт; бюджет; цели; AI */
(() => {
  const $ = id => document.getElementById(id);
  const CUR = () => Storage.settings().currency;
  const fmt = n => `${(Number(n) || 0).toFixed(2)}${CUR()}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const state = {
    month: new Date().toISOString().slice(0, 7),
    draft: [],
    source: 'manual',
    filterCat: '',
    compare: null,
    donut: null,
    bar: null
  };

  /* --- семейная синхронизация: триггер после любых мутаций --- */
  let _syncTmr = null;
  function scheduleFamilySync() {
    if (!Sync.ready()) return;
    clearTimeout(_syncTmr);
    _syncTmr = setTimeout(() => Sync.tick(), 1200);
  }
  ['addTx','delTx','addFromBasket','addToBasket','updateBasket','delFromBasket','clearCheckedBasket','setStores']
    .forEach(fn => {
      if (typeof Storage[fn] !== 'function') return;
      const orig = Storage[fn].bind(Storage);
      Storage[fn] = (...a) => { orig(...a); scheduleFamilySync(); };
    });

  function toast(msg, ms = 2400) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /* ============ Tabs / месяц ============ */
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name === 'money') renderTx();
    if (name === 'budget') { renderBudget(); renderGoals(); }
    if (name === 'overview') renderOverview();
    if (name === 'deals') openDeals();
    if (name === 'settings') { loadSettingsUI(); renderStoreEdit(); }
    if (name === 'shop') renderBasket();
    window.scrollTo(0, 0);
  }

  function monthLabel() {
    const [y, m] = state.month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }
  function renderMonthLabel() {
    $('monthLabel').textContent = monthLabel();
    $('budgetMonth').textContent = monthLabel();
    const monthSpend = Storage.txsForMonth(state.month).reduce((s, t) => s + (t.total || 0), 0);
    $('headerSub').textContent = `${Storage.settings().city || Storage.settings().zip || ''} · потрачено ${fmt(monthSpend)}`;
    $('dealZip').textContent = Storage.settings().zip || '';
  }
  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  function shiftMonth(d) {
    const [y, m] = state.month.split('-').map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    state.month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    renderMonthLabel();
    if ($('screen-money').classList.contains('active')) renderTx();
  }

  /* ============ Корзина (главная) ============ */
  function renderBasket() {
    const basket = Storage.basket();
    const wrap = $('basketList');
    wrap.innerHTML = '';
    $('basketCard').hidden = basket.length === 0;
    $('basketCount').textContent = basket.length ? `· ${basket.length}` : '';
    basket.forEach(b => {
      const row = document.createElement('div');
      row.className = 'b-item' + (b.done ? ' done' : '');
      row.innerHTML = `
        <input type="checkbox" ${b.done ? 'checked' : ''} title="куплено">
        <span class="b-name">${esc(b.name)}</span>
        <input type="number" min="1" step="any" value="${b.qty}" title="кол-во">
        <button class="del" title="убрать">✕</button>`;
      row.querySelector('input[type=checkbox]').addEventListener('change', e => {
        Storage.updateBasket(b.id, { done: e.target.checked });
        renderBasket();
      });
      row.querySelector('input[type=number]').addEventListener('change', e => {
        Storage.updateBasket(b.id, { qty: Math.max(1, Number(e.target.value) || 1) });
      });
      row.querySelector('.del').addEventListener('click', () => { Storage.delFromBasket(b.id); renderBasket(); });
      wrap.appendChild(row);
    });
  }

  function addBasketFromText(text) {
    let added = 0;
    for (const it of parseItemsText(text)) {
      const name = (it.name || '').replace(/^(?:купить|купи|хочу|нужно|надо|kaufen?)\s+/i, '').trim();
      if (name.length < 2) continue;
      Storage.addToBasket({ name, qty: it.qty || 1 });
      added++;
    }
    if (!added) toast('Не понял товар — скажите или впишите');
    else toast(`🛒 +${added} в корзину`);
    renderBasket();
  }

  $('btnBasketAdd').addEventListener('click', () => {
    const v = $('basketInput').value.trim();
    if (!v) return;
    $('basketInput').value = '';
    addBasketFromText(v);
  });
  $('basketInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnBasketAdd').click(); });
  $('btnBasketClear').addEventListener('click', () => {
    Storage.clearCheckedBasket();
    renderBasket();
    toast('Отмеченные убраны из корзины');
  });

  function showVoiceHint(html) {
    const h = $('voiceHint');
    h.innerHTML = html;
    h.hidden = false;
  }

  /* Голос корзины */
  let basketAdded = 0;
  $('btnBasketVoice').addEventListener('click', () => {
    const btn = $('btnBasketVoice');
    const line = $('basketVoiceLine');
    if (Voice.active) { Voice.stop(); return; }
    basketAdded = 0;
    Voice.start(
      (text, isFinal) => {
        if (!text) return;
        line.textContent = '🛒 услышал: ' + text;
        line.classList.add('live');
        if (isFinal) {
          const rest = text.slice(basketAdded).trim();
          basketAdded = text.length;
          if (rest) addBasketFromText(rest);
        }
      },
      st => {
        btn.classList.toggle('listening', st === 'listening' || st === 'recording');
        if (st === 'listening') line.textContent = '🎙️ Слушаю… (тишина 4 сек — стоп)';
        else if (st === 'recording') line.textContent = '🔴 Запись… говорите, затем нажмите кнопку снова';
        else if (st === 'transcribing') line.textContent = '🤖 Распознаю запись… подождите пару секунд';
        else if (st === 'error') { btn.classList.remove('listening'); line.textContent = '⚠️ Не удалось расшифровать запись — попробуйте ещё раз'; toast('Ошибка распознавания'); }
        else if (st === 'bad-key') { btn.classList.remove('listening'); line.textContent = '⚠️ AI-ключ неверный — проверьте его в «Ещё»'; }
        else if (st === 'no-mic') { showVoiceHint('⚠️ Микрофон не найден. Проверьте разрешение на микрофон в настройках сайта (значок 🔒 слева от адреса).'); toast('Нет микрофона'); }
        else if (st === 'idle') {
          btn.classList.remove('listening');
          line.classList.remove('live');
          line.textContent = 'Нажми и говори: «молоко, хлеб, 6 яиц…»';
        }
        else if (st === 'denied') { showVoiceHint('⚠️ Микрофон запрещён. Разрешите доступ: значок 🔒 слева от адреса → Микрофон → Разрешить → перезагрузите.'); toast('Микрофон запрещён'); }
        else if (st === 'unsupported') { showVoiceHint('ℹ️ Здесь нет живого распознавания. Либо откройте в Chrome, либо добавьте бесплатный AI-ключ («Ещё») — тогда микрофон запишет аудио и AI расшифрует.'); }
        else if (st === 'network') toast('Нет связи с распознаванием — проверьте интернет');
        else if (st === 'empty') toast('Речь не разобрана, попробуйте снова');
      }
    );
  });

  /* ============ Сравнение цен ============ */
  // Ссылка на оффер: deep-link сети -> собственная страница акций сети -> Marktguru
  function offerHref(o) {
    if (o.e) return o.e;
    const key = o.s && o.s[0] && o.s[0].u;
    const st = key && Storage.storeByKey(key);
    if (st && st.url) return st.url;
    return key ? 'https://www.marktguru.de/r/' + key : 'https://www.marktguru.de/';
  }

  $('btnCompare').addEventListener('click', async () => {
    const out = $('compareOut');
    const basket = Storage.basket().filter(b => !b.done);
    if (!basket.length) return toast('Корзина пуста');
    out.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="cmp-found">🤖 Сверяю ${basket.length} позици${basket.length === 1 ? 'ю' : 'и'} ${basket.length < 5 ? '' : ''}с акциями рядом…</div>`;
    out.appendChild(card);
    let data;
    try { data = await Deals.load(); }
    catch (e) {
      card.querySelector('.cmp-found').textContent = '⚠️ Не удалось загрузить акции: ' + e.message;
      return;
    }
    const myKeys = new Set(Storage.stores().map(s => s.key));
    const offers = (data.offers || []).filter(o => (o.s || []).some(x => myKeys.has(x.u)));
    state.compare = { data, basket, offers };

    let html = '';
    let found = 0;
    const missed = [];
    const perItem = [];
    for (const item of basket) {
      const offs = Deals.findFor(item.name, offers, 4);
      if (!offs.length) { missed.push(item.name); continue; }
      perItem.push({ name: item.name, qty: item.qty, offs });
      found++;
      const best = offs[0];
      html += `<div class="cmp-item">
        <div class="cmp-head"><span class="cmp-name">${esc(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}</span>
        <span class="cmp-best">от ${fmt(best.p)}${best.u ? ' /' + esc(best.u) : ''}</span></div>`;
      offs.slice(0, 3).forEach(o => {
        const st = Storage.storeByKey(o.s[0]?.u);
        const dist = st && st.dist != null && st.dist !== '' ? `<span class="o-dist">🚗 ${st.dist} км</span>` : '';
        const d = Deals.discountPct(o);
        const linkKind = o.e ? '· именно эта акция' : '· текущие акции сети';
        html += `<a class="offer-row" href="${esc(offerHref(o))}" target="_blank" rel="noopener">
          <img src="${esc(o.img)}" loading="lazy" alt="">
          <div class="o-main">
            <div class="o-title">${esc(o.n)}${o.b ? ` · ${esc(o.b)}` : ''}</div>
            <div class="o-meta"><b>${esc(o.s[0]?.n || '')}</b> ${dist} · до ${esc((o.t || '').slice(5, 10))} <span class="hint-muted">${linkKind} ↗</span></div>
          </div>
          <div>${d ? `<span class="o-tag" style="background:${d >= 30 ? '#e5484d' : '#f5a623'}">−${d}%</span>` : ''}
          <span class="o-price">${fmt(o.p)}</span>${o.op ? `<span class="o-old">${fmt(o.op)}</span>` : ''}<span class="o-open">↗</span></div>
        </a>`;
      });
      html += '</div>';
    }

    const activeCount = basket.length;
    const totals = [...Deals.bestByStore(basket, offers).values()]
      .map(t => {
        const st = Storage.storeByKey(t.key);
        t.dist = st && st.dist != null && st.dist !== '' ? Number(st.dist) : null;
        return t;
      })
      .sort((a, b) => b.covers - a.covers || a.sum - b.sum);
    const coversMax = totals.length ? totals[0].covers : 0;
    const ranked = totals
      .filter(t => t.covers >= coversMax)
      .sort((a, b) => (a.sum + 0.3 * (a.dist || 0)) - (b.sum + 0.3 * (b.dist || 0)));

    let totHtml = '';
    if (totals.length) {
      const bestKey = ranked[0] && ranked[0].key;
      totHtml = '<div class="card-head" style="margin-top:14px"><h2>Во сколько обойдётся корзина</h2></div>';
      totals.slice(0, 6).forEach(t => {
        const stDef = Storage.storeByKey(t.key);
        const href = esc(stDef && stDef.url ? stDef.url : (t.key ? 'https://www.marktguru.de/r/' + t.key : 'https://www.marktguru.de/'));
        totHtml += `<a class="store-tot ${t.key === bestKey ? 'best' : ''}" href="${href}" target="_blank" rel="noopener">
          <div><span class="st-name">${esc(t.store)}</span>${t.dist != null ? `<span class="st-dist">${t.dist} км ↗</span>` : ''}</div>
          <div style="text-align:right"><span class="st-sum">${fmt(t.sum)}</span>
          <span class="st-sub">${t.covers}/${activeCount} товаров</span></div>
        </a>`;
      });
      if (ranked[0]) {
        totHtml += `<div class="cmp-found" style="margin-top:10px">💡 Цены — из реальных буклетов сетей на сегодня. Выгоднее всего: <b>${esc(ranked[0].store)}</b>${ranked[0].dist != null ? ` (${ranked[0].dist} км)` : ''} — ${fmt(ranked[0].sum)} за ${ranked[0].covers} из ${activeCount} позиций.</div>`;
      }
      totHtml += `<div class="cmp-actions">
        <button id="btnToBudget" class="btn primary">✔️ Куплено — внести в бюджет</button>
      </div>`;
    }

    // Матрица: вся корзина × все магазины, реальные цены из буклетов
    let matrix = '';
    if (perItem.length) {
      const storeKeys = [];
      const cellMap = {}; // key: item idx + store key -> offer (лучшая цена этой позиции в этом магазине)
      perItem.forEach((p, pi) => {
        const byStore = {};
        p.offs.forEach(o => {
          const k = o.s?.[0]?.u;
          if (!k) return;
          if (!byStore[k] || o.p < byStore[k].p) byStore[k] = o;
        });
        Object.entries(byStore).forEach(([k, o]) => {
          if (!storeKeys.includes(k)) storeKeys.push(k);
          cellMap[pi + '|' + k] = o;
        });
      });
      // магазины с покрытием сначала, потом по алфавиту
      const defOrder = Storage.stores().map(s => s.key);
      storeKeys.sort((a, b) => {
        const ca = perItem.filter((_, pi) => cellMap[pi + '|' + a]).length;
        const cb = perItem.filter((_, pi) => cellMap[pi + '|' + b]).length;
        return cb - ca || (defOrder.indexOf(a) + 99) - (defOrder.indexOf(b) + 99);
      });
      const minPrice = {};
      perItem.forEach((p, pi) => {
        minPrice[pi] = Math.min(...storeKeys.filter(k => cellMap[pi + '|' + k]).map(k => cellMap[pi + '|' + k].p));
      });
      matrix = '<div class="card-head" style="margin-top:14px"><h2>📋 Вся корзина по магазинам</h2></div><div class="matrix-wrap"><table class="matrix"><tr><th></th>';
      storeKeys.forEach(k => {
        const st = Storage.storeByKey(k);
        matrix += `<th>${esc(st && st.name ? st.name : k)}</th>`;
      });
      matrix += '</tr>';
      perItem.forEach((p, pi) => {
        matrix += `<tr><td class="m-name">${esc(p.name)}${p.qty > 1 ? ` ×${p.qty}` : ''}</td>`;
        storeKeys.forEach(k => {
          const o = cellMap[pi + '|' + k];
          if (!o) { matrix += '<td class="m-none">·</td>'; return; }
          const d = Deals.discountPct(o);
          const bestCls = o.p <= minPrice[pi] ? ' class="m-best"' : '';
          matrix += `<td${bestCls}>${fmt(o.p)}${d ? `<span class="m-tag">−${d}%</span>` : ''}</td>`;
        });
        matrix += '</tr>';
      });
      // итог по каждому магазину (полная корзина по его акциям)
      matrix += '<tr class="m-total"><td class="m-name">Итого:</td>';
      storeKeys.forEach(k => {
        let covered = 0;
        const sum = perItem.reduce((acc, p, pi) => {
          const o = cellMap[pi + '|' + k];
          if (!o) return acc;
          covered++;
          return acc + o.p * (p.qty || 1);
        }, 0);
        matrix += covered ? `<td>${fmt(sum)}<span class="m-sub">${covered}/${perItem.length}</span></td>` : '<td class="m-none">·</td>';
      });
      matrix += '</tr></table></div>';
    }

    card.innerHTML = `
      <div class="cmp-found">Найдено в акциях: <b>${found}</b> из ${basket.length}${missed.length ? ` · нет акций на: ${esc(missed.join(', '))} <span class="hint-muted">(товара просто нет в акциях этой недели — каталог обновляется раз в день)</span>` : ''}${data.updated ? ` · данные от ${new Date(data.updated).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
      ${matrix}${totHtml}${html}`;

    const tb = $('btnToBudget');
    if (tb) tb.addEventListener('click', basketToBudget);
  });

  function basketToBudget() {
    const basket = Storage.basket();
    const doneItems = basket.filter(b => b.done);
    const active = basket.filter(b => !b.done);
    if (!active.length && !doneItems.length) return;
    const txItems = [];
    let total = 0;
    for (const b of active.concat(doneItems)) {
      let price = 0;
      if (state.compare) {
        const offs = Deals.findFor(b.name, state.compare.offers, 1);
        if (offs.length) price = offs[0].p;
      }
      total += price * (b.qty || 1);
      txItems.push({ name: b.name, qty: b.qty || 1, price, cat: guessCat(b.name) });
    }
    Storage.addTx({
      id: uid(),
      date: todayISO(),
      cat: txItems[0].cat,
      items: txItems,
      total,
      note: '🛒 из корзины',
      source: 'basket'
    });
    Storage.basket().slice().forEach(b => Storage.delFromBasket(b.id));
    state.compare = null;
    $('compareOut').innerHTML = '';
    renderBasket();
    toast(`💸 Внесено в бюджет: ${txItems.length} позиц. на ${fmt(total)}`);
  }

  /* ============ Учёт: голос/фото/ручной + список ============ */
  CATS.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    $('filterCat').appendChild(opt);
    $('draftCat').appendChild(opt.cloneNode(true));
  });

  $('btnVoice').addEventListener('click', () => {
    const vs = $('voiceStatus');
    const vt = $('voiceText');
    if (Voice.active) { state.source = 'voice'; Voice.stop(); return; }
    state.source = 'voice';
    Voice.start(
      (text, isFinal) => {
        if (text) { vs.hidden = false; vt.textContent = text; }
        if (isFinal && text) {
          manualToggle(true);
          $('manualInput').value = text;
          makeDraft(parseItemsText(text));
        }
      },
      st => {
        if (st === 'listening') { vs.hidden = false; vt.textContent = 'Говорите… формат: «товар цена». Например: «молоко полтора евро»'; }
        else if (st === 'recording') { vs.hidden = false; vt.textContent = '🔴 Запись… говорите, затем нажмите ещё раз'; }
        else if (st === 'transcribing') { vs.hidden = false; vt.textContent = '🤖 Распознаю запись… подождите пару секунд'; }
        else if (st === 'error') { vs.hidden = true; toast('Ошибка распознавания — попробуйте ещё раз'); }
        else if (st === 'bad-key') { vs.hidden = true; toast('AI-ключ неверный — проверьте его в «Ещё»'); }
        else if (st === 'no-mic') { vs.hidden = true; showVoiceHint('⚠️ Микрофон не найден — проверьте разрешения браузера.'); }
        else if (st === 'idle') {
          vs.hidden = true;
          vt.textContent = '';
        }
        else if (st === 'denied') { showVoiceHint('⚠️ Микрофон запрещён: 🔒 слева от адреса → Микрофон → Разрешить.'); toast('Микрофон запрещён'); }
        else if (st === 'unsupported') showVoiceHint('ℹ️ Нет живого распознавания в этом браузере. Откройте в Chrome или добавьте AI-ключ — тогда запишем аудио и расшифруем.');
        else if (st === 'network') toast('Нет связи с распознаванием');
      }
    );
  });

  $('btnManual').addEventListener('click', () => { state.source = 'manual'; manualToggle(); });
  function manualToggle(force) {
    const a = $('manualArea');
    a.hidden = force === true ? false : !a.hidden;
    if (!a.hidden) $('manualInput').focus();
  }
  $('btnParseText').addEventListener('click', () => {
    const items = parseItemsText($('manualInput').value);
    if (!items.length) return toast('Не нашёл позиции — формат: молоко 1.29');
    makeDraft(items);
  });

  /* OCR */
  $('photoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (state.ocrBusy) return toast('Ещё распознаю предыдущий чек…');
    state.ocrBusy = true;
    state.source = 'photo';
    $('receiptPreview').src = URL.createObjectURL(file);
    $('receiptPreview').hidden = false;
    $('ocrProgress').hidden = false;
    $('ocrStatus').textContent = 'готовлю фото…';
    if (typeof Tesseract === 'undefined') {
      state.ocrBusy = false;
      $('ocrProgress').hidden = true;
      return toast('OCR ещё грузится, попробуйте снова');
    }
    let watchdog = setTimeout(() => {
      $('ocrProgress').hidden = true;
      $('ocrStatus').textContent = '';
      state.ocrBusy = false;
      toast('⏱ Распознавание слишком долго — сфотографируйте чек ближе и при свете');
    }, 120000);
    try {
      const small = await downscale(file, 1600);
      const res = await Tesseract.recognize(small, Storage.settings().ocrLang, {
        logger: m => {
          if (m.status === 'loading language traineddata' || m.status === 'loading tesseract core') $('ocrStatus').textContent = 'загружаю язык распознавания…';
          else if (m.status === 'recognizing text' && m.progress) $('ocrStatus').textContent = `${Math.round(m.progress * 100)}%`;
        }
      });
      await ingestReceipt(res.data.text || '');
    } catch (err) { console.error(err); toast('Не удалось распознать чек'); }
    finally { clearTimeout(watchdog); state.ocrBusy = false; $('ocrProgress').hidden = true; $('ocrStatus').textContent = ''; }
  });

  function downscale(file, maxSide) {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale >= 1) { URL.revokeObjectURL(url); return resolve(file); }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function ingestReceipt(text) {
    if (!text.trim()) return toast('Текст чека пуст — снимите ближе и чётче');
    if (Storage.settings().aiKey) {
      try {
        toast('🤖 AI разбирает чек…', 4000);
        const items = await AI.parseReceipt(text, CUR());
        if (items.length) { makeDraft(items); return; }
      } catch (err) { console.warn(err); }
    }
    const JUNK = /summe|zwischens|\bsum\b|total|итог|\bbar\b|karte|wechsel|wec?hselgeld|zahlung|zu\s*zah|\bzal\b|\bzu\b|zahlweg|pfand|leergut|mwst|\bust\b|vat|nett|brutt|kasse|filiale|datum|uhrzeit|bediener|\bbon\b|artikel|rabbat|coupon|gutschein|gutschrift|storno|girocard|contactless|edv|ungef|hauptkasse|bitte|\btse\b|\bzzv\b/i;
    const lines = text.split('\n').map(l => l.trim())
      .filter(l => l.length >= 4 && /[a-zäöüßа-яё]{2,}/i.test(l) && !JUNK.test(l));
    const items = [];
    for (const line of lines) {
      const it = parseChunk(line.replace(/\s{3,}/g, ' ').replace(/^[xX*]\s*/, ''));
      if (!it) continue;
      const words = (it.name || '').split(/[^\p{L}]+/u).filter(Boolean);
      const longest = Math.max(0, ...words.map(w => w.length));
      const letters = (it.name || '').replace(/[^\p{L}]/gu, '');
      const nameOk = longest >= 3 && letters.length >= 3 && !(it.name === it.name.toUpperCase() && letters.length <= 6);
      const priceOk = it.price > 0 && (/\d[.,]\d{1,2}(\s|$)/.test(line) || it.price >= 20) && it.price <= 500;
      if (nameOk && priceOk) items.push(it);
    }
    if (!items.length) return toast('Позиции не найдены — введите вручную или добавьте AI-ключ');
    makeDraft(items);
  }

  /* Черновик */
  function fillCatSelect(sel, chosen) {
    sel.innerHTML = CATS.map(c => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${c.name}</option>`).join('');
  }

  function makeDraft(items) {
    state.draft = [];
    for (const raw of items) {
      const it = {
        id: uid(), name: raw.name || 'Позиция', qty: Math.min(Number(raw.qty) || 1, 99),
        price: Math.min(Number(raw.price) || 0, 9999), cat: raw.cat || guessCat(raw.name)
      };
      if (!(it.name.length > 1 || it.price > 0)) continue;
      const key = it.name.trim().toLowerCase() + '|' + it.price.toFixed(2);
      const same = state.draft.find(d => d.name.trim().toLowerCase() + '|' + d.price.toFixed(2) === key);
      if (same && same.price > 0 && state.source !== 'manual') same.qty += it.qty;
      else state.draft.push(it);
    }
    $('draftDate').value = todayISO();
    renderDraft();
    $('draftArea').hidden = false;
    $('draftArea').scrollIntoView({ behavior: 'smooth' });
  }

  function renderDraft() {
    const wrap = $('draftItems');
    wrap.innerHTML = '';
    let total = 0;
    state.draft.forEach(it => {
      total += it.qty * it.price;
      const row = document.createElement('div');
      row.className = 'draft-item';
      row.innerHTML = `
        <div class="draft-item-row">
          <input type="text" value="${esc(it.name)}" data-f="name">
          <input type="number" min="0" step="any" value="${it.qty}" data-f="qty" title="кол-во">
          <input type="number" min="0" step="any" value="${it.price}" data-f="price" title="цена">
          <select data-f="cat"></select>
          <button class="del" title="удалить">✕</button>
        </div>`;
      fillCatSelect(row.querySelector('select'), it.cat);
      row.querySelector('[data-f=name]').addEventListener('input', e => { it.name = e.target.value; it.cat = guessCat(it.name); fillCatSelect(row.querySelector('select'), it.cat); });
      row.querySelector('[data-f=qty]').addEventListener('input', e => { it.qty = Number(e.target.value) || 1; });
      row.querySelector('[data-f=price]').addEventListener('input', e => { it.price = Number(e.target.value) || 0; });
      row.querySelector('select').addEventListener('change', e => { it.cat = e.target.value; });
      row.querySelector('.del').addEventListener('click', () => { state.draft = state.draft.filter(x => x.id !== it.id); renderDraft(); });
      wrap.appendChild(row);
    });
    $('draftTotal').textContent = fmt(total);
    if (!state.draft.length) $('draftArea').hidden = true;
  }

  $('btnDiscard').addEventListener('click', () => {
    state.draft = []; $('draftArea').hidden = true;
    $('manualInput').value = ''; $('manualArea').hidden = true; $('receiptPreview').hidden = true;
  });

  $('btnSaveDraft').addEventListener('click', () => {
    if (!state.draft.length) return toast('Нечего сохранять');
    const total = state.draft.reduce((s, it) => s + it.qty * it.price, 0);
    if (total > 500 && !confirm(`Сумма чека ${total.toFixed(2)} € — это правда так? Проверьте позиции.`)) return;
    Storage.addTx({
      id: uid(), date: $('draftDate').value || todayISO(), cat: $('draftCat').value,
      items: state.draft.map(({ name, qty, price, cat }) => ({ name, qty, price, cat })),
      total, source: state.source
    });
    state.draft = [];
    $('draftArea').hidden = true;
    $('manualInput').value = ''; $('manualArea').hidden = true; $('receiptPreview').hidden = true;
    toast('Сохранено ✓');
    state.month = todayISO().slice(0, 7);
    renderMonthLabel();
  });

  $('btnAiFix').addEventListener('click', async () => {
    if (!state.draft.length) return;
    if (!Storage.settings().aiKey) return toast('Добавьте AI-ключ в разделе «Ещё»');
    const btn = $('btnAiFix');
    btn.disabled = true; btn.textContent = '🤖 Думаю…';
    try {
      const fixed = await AI.fixDraft(state.draft.map(({ name, qty, price, cat }) => ({ name, qty, price, cat })), CUR());
      if (Array.isArray(fixed) && fixed.length) {
        state.draft = fixed.map(it => ({
          id: uid(), name: it.name || 'Позиция', qty: Number(it.qty) || 1,
          price: Number(it.price) || 0, cat: CATS.some(c => c.id === it.cat) ? it.cat : guessCat(it.name)
        }));
        renderDraft();
        toast('AI поправил черновик ✓');
      }
    } catch (err) { toast(err.message === 'no-key' ? 'Нет AI-ключа' : 'Ошибка AI: ' + err.message); }
    btn.disabled = false; btn.textContent = '🤖 Умная правка';
  });

  /* Операции */
  function renderTx() {
    const list = $('txList');
    list.innerHTML = '';
    const txs = Storage.txsForMonth(state.month)
      .filter(t => !state.filterCat || t.cat === state.filterCat || (t.items || []).some(i => i.cat === state.filterCat));
    $('txEmpty').hidden = txs.length > 0;
    let sum = 0, lastDay = '';
    for (const t of txs) {
      sum += t.total;
      if (t.date !== lastDay) {
        lastDay = t.date;
        const h = document.createElement('div');
        h.className = 'tx-day-header';
        h.textContent = new Date(t.date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        list.appendChild(h);
      }
      const c = catById((t.items || [])[0]?.cat || t.cat);
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div class="tx-main">
          <div class="tx-title">${esc((t.items || []).map(i => i.name).join(' + '))}${t.note ? ' ' + esc(t.note) : ''}<span class="badge">${c.name}</span></div>
          <div class="tx-meta">${t.source === 'voice' ? '🎤' : t.source === 'photo' ? '📷' : t.source === 'basket' ? '🛒' : '⌨️'} ${t.date}</div>
        </div>
        <div class="tx-amount">${t.total.toFixed(2)}${CUR()}</div>
        <button class="tx-del" title="удалить">🗑</button>`;
      row.querySelector('.tx-del').addEventListener('click', () => { Storage.delTx(t.id); renderTx(); toast('Удалено'); });
      list.appendChild(row);
    }
    $('txMonthSum').textContent = txs.length ? `${sum.toFixed(2)}${CUR()}` : '';
  }
  $('filterCat').addEventListener('change', e => { state.filterCat = e.target.value; renderTx(); });
  $('btnClearMonth').addEventListener('click', () => {
    if (!confirm('Удалить ВСЕ операции за этот месяц? Восстановить нельзя.')) return;
    Storage.data.txs = Storage.data.txs.filter(t => Storage.monthKey(t.date) !== state.month);
    Storage.save();
    renderTx();
    renderMonthLabel();
    toast('Месяц очищен');
  });

  /* Бюджет */
  function renderBudget() {
    const spent = Storage.spentByCat(state.month);
    const limits = Storage.budgetFor(state.month);
    const wrap = $('budgetList');
    wrap.innerHTML = '';
    CATS.forEach(c => {
      const s = spent[c.id] || 0;
      const lim = limits[c.id] || '';
      const pct = lim ? Math.min(100, s / Number(lim) * 100) : (s > 0 ? 100 : 0);
      const cls = !lim || pct < 75 ? '' : pct < 100 ? 'warn' : 'over';
      const row = document.createElement('div');
      row.className = 'budget-row';
      row.innerHTML = `
        <div class="budget-head">
          <span>${c.name}</span>
          <span class="limwrap">${s.toFixed(2)}${CUR()} / <input type="number" min="0" step="any" placeholder="лимит" value="${lim}" data-cat="${c.id}"></span>
        </div>
        <div class="bar"><div class="${cls}" style="width:${pct}%"></div></div>`;
      wrap.appendChild(row);
    });
  }
  $('btnSaveBudget').addEventListener('click', () => {
    document.querySelectorAll('#budgetList input[data-cat]').forEach(inp => Storage.setDefault(inp.dataset.cat, inp.value));
    toast('Лимиты сохранены ✓');
  });

  /* Цели */
  function renderGoals() {
    const wrap = $('goalsList');
    wrap.innerHTML = '';
    Storage.goals().forEach(g => {
      const pct = Math.min(100, (g.saved || 0) / g.target * 100);
      const row = document.createElement('div');
      row.className = 'goal-row';
      row.innerHTML = `
        <span style="min-width:84px">${esc(g.name)}</span>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <span style="font-size:.74rem;color:var(--muted)">${(g.saved || 0).toFixed(0)}/${g.target.toFixed(0)}</span>
        <button class="grow" title="пополнить">+10</button>
        <button class="rm" title="удалить">✕</button>`;
      row.querySelector('.grow').addEventListener('click', () => { Storage.addGoalAmount(g.id, g.target >= 500 ? 10 : 1); renderGoals(); });
      row.querySelector('.rm').addEventListener('click', () => { Storage.delGoal(g.id); renderGoals(); });
      wrap.appendChild(row);
    });
  }
  $('btnAddGoal').addEventListener('click', () => {
    const name = $('goalName').value.trim();
    const target = Number($('goalAmount').value);
    if (!name || !(target > 0)) return toast('Введите название и сумму');
    Storage.addGoal({ id: uid(), name, target, saved: 0 });
    $('goalName').value = ''; $('goalAmount').value = '';
    renderGoals();
  });

  /* Обзор */
  function renderOverview() {
    const spent = Storage.spentByCat(state.month);
    const total = Object.values(spent).reduce((a, b) => a + b, 0);
    const txs = Storage.txsForMonth(state.month);
    const now = new Date();
    const dim = state.month === todayISO().slice(0, 7) ? now.getDate() : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    $('statMonth').textContent = `${total.toFixed(2)}${CUR()}`;
    $('statDay').textContent = txs.length ? `${(total / Math.max(1, Math.min(dim, now.getDate()))).toFixed(2)}${CUR()}` : '—';
    $('statCount').textContent = txs.length;

    const vis = CATS.filter(c => spent[c.id] > 0);
    if (state.donut) state.donut.destroy();
    state.donut = new Chart($('donutChart'), {
      type: 'doughnut',
      data: { labels: vis.map(c => c.name), datasets: [{ data: vis.map(c => spent[c.id]), backgroundColor: vis.map(c => c.color), borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'bottom' } } }
    });

    const months = [], sums = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push(d.toLocaleDateString('ru-RU', { month: 'short' }));
      sums.push(Object.values(Storage.spentByCat(mk)).reduce((a, b) => a + b, 0));
    }
    if (state.bar) state.bar.destroy();
    state.bar = new Chart($('barChart'), {
      type: 'bar',
      data: { labels: months, datasets: [{ label: `Расходы, ${CUR()}`, data: sums, backgroundColor: '#0fa976', borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  $('btnAdvice').addEventListener('click', async () => {
    const out = $('adviceOut');
    if (!Storage.settings().aiKey) return AI.showErr(out, new Error('no-key'));
    const spent = Storage.spentByCat(state.month);
    const prev = (() => {
      const [y, m] = state.month.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      return Storage.spentByCat(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    })();
    out.classList.add('thinking');
    out.textContent = '🤖 Анализирую ваш бюджет…';
    try {
      out.textContent = await AI.advice({
        month: state.month, currency: CUR(), spentByCategory: spent,
        limits: Storage.budgetFor(state.month), prevMonthSpent: prev, goals: Storage.goals()
      }, CUR());
    } catch (err) { AI.showErr(out, err); }
    out.classList.remove('thinking');
  });

  /* ============ Акции ============ */
  async function openDeals() {
    $('dealsFresh').textContent = 'грузим…';
    try {
      const data = await Deals.load();
      $('dealsFresh').textContent = `${data.count} акций`;
      const upd = new Date(data.updated).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      $('dealsFreshness').textContent = `Собрано автоматически ${upd} для zip ${data.zip}. Обновление каждый день ≈06:30 (GitHub Actions). Список товаров: config/terms.txt в репозитории.`;
      const mk = new Set(Storage.stores().map(s => s.key));
      renderDealGrid(Deals.topDeals(data.offers.filter(o => (o.s || []).some(x => mk.has(x.u))), 24));
    } catch (e) {
      $('dealsFresh').textContent = 'офлайн';
      $('dealsFreshness').textContent = 'Не удалось загрузить акции — проверьте интернет.';
    }
    renderMarketsMini();
  }

  function offerCard(o) {
    const d = Deals.discountPct(o);
    const a = document.createElement('a');
    a.className = 'deal-card';
    a.href = offerHref(o); a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = `
      <img src="${esc(o.img)}" loading="lazy" alt="">
      <div class="dc-name">${esc(o.n)}${o.b ? ` · ${esc(o.b)}` : ''}</div>
      <div class="dc-row"><span class="dc-price">${fmt(o.p)}</span>${o.op ? `<span class="dc-old">${fmt(o.op)}</span>` : d ? `<span class="dc-old">−${d}%</span>` : ''}</div>
      <div class="dc-store">${esc(o.s[0]?.n || '')}</div>`;
    return a;
  }

  function renderDealGrid(list) {
    const grid = $('dealsGrid');
    grid.innerHTML = '';
    if (!list.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Ничего не нашлось 🤷</div>';
      return;
    }
    list.forEach(o => grid.appendChild(offerCard(o)));
  }

  $('btnDealsSearch').addEventListener('click', loadSearch);
  $('dealsSearch').addEventListener('keydown', e => { if (e.key === 'Enter') loadSearch(); });
  async function loadSearch() {
    const q = $('dealsSearch').value.trim();
    if (!q) return;
    const data = await Deals.load();
    const qn = Deals.expandQuery(q);
    const terms = qn.split(' ').filter(w => w.length > 2).map(w => w.slice(0, 5));
    const mk = new Set(Storage.stores().map(s => s.key));
    const list = data.offers.filter(o => {
      if (!(o.s || []).some(x => mk.has(x.u))) return false;
      const hay = Deals.expandQuery([o.n, o.b, o.d].filter(Boolean).join(' '));
      return terms.some(w => hay.includes(w));
    }).slice(0, 30);
    renderDealGrid(list);
    $('dealsSearch').blur();
  }

  function renderMarketsMini() {
    const wrap = $('marketsMini');
    wrap.innerHTML = '';
    Storage.stores().forEach(s => {
      const row = document.createElement('div');
      row.className = 'market-row';
      row.innerHTML = `
        <div class="logo" style="background:${esc(s.color || '#0fa976')}">${esc((s.name || '?').slice(0, 3).toUpperCase())}</div>
        <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}<small>акции ↗</small></a>
        <span class="mini-dist">🚗 ${s.dist || '—'} км</span>`;
      wrap.appendChild(row);
    });
  }
  $('btnGoStores').addEventListener('click', () => switchTab('settings'));

  $('btnAiDeals').addEventListener('click', async () => {
    const out = $('dealsOut');
    const text = $('dealsInput').value.trim();
    if (!text) return toast('Вставьте список акций');
    if (!Storage.settings().aiKey) return AI.showErr(out, new Error('no-key'));
    out.classList.add('thinking');
    out.textContent = '🤖 Подбираю лучшее для вашей семьи…';
    try {
      const basket = Storage.basket().map(b => `${b.qty}× ${b.name}`).join(', ');
      out.textContent = await AI.pickDeals(text, basket, {
        limits: Storage.budgetFor(state.month), spent: Storage.spentByCat(state.month), zip: Storage.settings().zip
      }, CUR());
    } catch (err) { AI.showErr(out, err); }
    out.classList.remove('thinking');
  });

  /* ============ Настройки ============ */
  function loadSettingsUI() {
    const s = Storage.settings();
    $('setCurrency').value = s.currency;
    $('setVoiceLang').value = s.voiceLang;
    $('setOcrLang').value = s.ocrLang;
    $('setAiKey').value = s.aiKey || '';
    const c = $('setCity');
    if (c) c.value = s.city || '';
    const fn = $('setFamilyName'), ft = $('setFamilyToken'), fg = $('setFamilyGist');
    if (fn) fn.value = s.familyName || '';
    if (ft) ft.value = s.familyToken || '';
    if (fg) fg.value = s.familyGistId || '';
    const pv = $('setAiProvider');
    if (pv) pv.value = s.aiProvider === 'gemini' ? 'gemini' : 'mistral';
  }
  $('btnSaveSettings').addEventListener('click', () => {
    Storage.updateSettings({
      currency: $('setCurrency').value,
      voiceLang: $('setVoiceLang').value,
      ocrLang: $('setOcrLang').value,
      aiKey: $('setAiKey').value.trim(),
      city: ($('setCity') ? $('setCity').value.trim() : '') || 'Mesum',
      aiProvider: ($('setAiProvider') ? $('setAiProvider').value : 'mistral') || 'mistral'
    });
    renderMonthLabel();
    toast('Настройки сохранены ✓');
  });
  $('btnTestKey').addEventListener('click', async () => {
    const k = $('setAiKey').value.trim();
    if (k) Storage.updateSettings({ aiKey: k });
    const btn = $('btnTestKey');
    btn.disabled = true;
    btn.textContent = '⏳ Проверяю…';
    try {
      const ans = await AI.testKey();
      btn.textContent = '✅ Ключ работает' + (ans ? ` — «${ans}»` : '');
      toast('AI подключён ✓');
    } catch (e) {
      btn.textContent = '❌ ' + (e.message === 'no-key' ? 'Сначала вставьте ключ и сохраните' : e.message.slice(0, 60));
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = '🔎 Проверить ключ'; }, 4000);
  });

  function renderStoreEdit() {
    const wrap = $('storeEdit');
    wrap.innerHTML = '';
    Storage.stores().forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'store-edit-row';
      row.innerHTML = `
        <input type="text" value="${esc(s.name)}" data-i="${i}" data-f="name" title="${esc(s.addr || '')}">
        <span class="kmwrap">🚗 <input type="number" min="0" step="0.1" value="${s.dist ?? ''}" data-i="${i}" data-f="dist"> км</span>
        <button class="rm" title="удалить">✕</button>`;
      row.querySelector('.rm').addEventListener('click', () => {
        Storage.setStores(Storage.stores().filter((_, j) => j !== i));
        renderStoreEdit();
      });
      wrap.appendChild(row);
    });
  }
  $('btnSaveStores').addEventListener('click', () => {
    const stores = Storage.stores().map(s => ({ ...s }));
    document.querySelectorAll('#storeEdit [data-i]').forEach(inp => {
      const i = Number(inp.dataset.i);
      if (inp.dataset.f === 'name') stores[i].name = inp.value.trim() || stores[i].name;
      if (inp.dataset.f === 'dist') stores[i].dist = inp.value === '' ? null : Number(inp.value);
    });
    Storage.setStores(stores);
    toast('Расстояния сохранены ✓');
  });
  $('btnAddMarket').addEventListener('click', () => {
    const name = $('mkName').value.trim();
    const url = $('mkUrl').value.trim();
    if (!name || !/^https?:\/\//.test(url)) return toast('Название и ссылка https://…');
    Storage.setStores(Storage.stores().concat([{ name, url, color: '#0fa976', dist: null, key: name.toLowerCase() }]));
    $('mkName').value = ''; $('mkUrl').value = '';
    renderStoreEdit();
  });

  /* Данные */
  $('btnExport').addEventListener('click', () => Storage.export());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    const r = new FileReader();
    r.onload = () => {
      try { Storage.importJSON(r.result); toast('Импорт готов ✓'); renderMonthLabel(); }
      catch (err) { toast('Ошибка импорта: ' + err.message); }
    };
    r.readAsText(f);
  });
  let wipeCount = 0;
  $('btnWipe').addEventListener('click', () => {
    if (++wipeCount < 2) return toast('Нажмите ещё раз для подтверждения');
    Storage.wipe();
    toast('Данные удалены');
    renderMonthLabel(); renderBasket();
    wipeCount = 0;
  });

  /* PWA */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.warn));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try {
        if (sessionStorage.getItem('swBooted')) return;
        sessionStorage.setItem('swBooted', '1');
        location.reload();
      } catch (e) { location.reload(); }
    });
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('btnInstall').hidden = true;
  });

  /* ============ Семья: общий список + чат ============ */
  function fmRender() {
    if (!Sync.ready()) { if ($('familyCard')) $('familyCard').hidden = true; return; }
    $('familyCard').hidden = false;
    const me = Sync.cfg().me;
    $('fmMsgs').innerHTML = Sync.chat().slice(-40).map(m => `
      <div class="fm-msg ${m.by === me ? 'me' : ''}">
        <span class="fm-by">${esc(m.by)} · ${new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        ${esc(m.text)}
      </div>`).join('');
    $('fmMsgs').scrollTop = $('fmMsgs').scrollHeight;
    if (Sync.lastError) { $('fmStatus').textContent = '⚠ ' + Sync.lastError.slice(0, 40); $('fmStatus').classList.remove('on'); }
    else {
      const t = Sync.lastSync ? Sync.lastSync.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '…';
      $('fmStatus').textContent = 'синхронизировано · ' + t;
      $('fmStatus').classList.add('on');
    }
  }
  Sync.setOnChange(msg => {
    if (msg && msg.by !== Sync.cfg().me) { toast('💬 ' + msg.by + ': ' + msg.text, 4200); if (navigator.vibrate) navigator.vibrate(60); }
    fmRender();
    if ($('screen-shop').classList.contains('active')) renderBasket();
  });

  const fmSend = async () => {
    const v = $('fmMsg').value.trim(); if (!v || !Sync.ready()) return;
    $('fmMsg').value = '';
    try { await Sync.sendChat(v); fmRender(); }
    catch (e) { toast('⚠ ' + e.message, 5000); }
  };
  $('btnFmSend').addEventListener('click', fmSend);
  $('fmMsg').addEventListener('keydown', e => { if (e.key === 'Enter') fmSend(); });

  $('btnFmItem').addEventListener('click', () => {
    const v = $('fmItem').value.trim(); if (!v || !Sync.ready()) return;
    $('fmItem').value = '';
    addBasketFromText(v);
    toast('🛍 добавлено в общий список', 2200);
  });
  $('fmItem').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnFmItem').click(); });

  $('btnFmCreate').addEventListener('click', async () => {
    const tok = $('setFamilyToken').value.trim();
    if (!tok) { toast('Сначала вставьте GitHub-токен и сохраните'); return; }
    Storage.updateSettings({ familyToken: tok, familyName: $('setFamilyName').value.trim() });
    const btn = $('btnFmCreate'); btn.disabled = true; const old = btn.textContent; btn.textContent = '…создаю';
    try {
      const id = await Sync.createRoom();
      $('setFamilyGist').value = id;
      Storage.updateSettings({ familyGistId: id });
      Sync.start(); fmRender();
      toast('✓ Комната создана. ID ниже — вставьте его вместе с токеном на других устройствах', 7000);
    } catch (e) { toast('⚠ ' + e.message, 6000); }
    btn.disabled = false; btn.textContent = old;
  });
  $('btnFmSave').addEventListener('click', () => {
    Storage.updateSettings({
      familyName: $('setFamilyName').value.trim(),
      familyToken: $('setFamilyToken').value.trim(),
      familyGistId: $('setFamilyGist').value.trim()
    });
    if (Sync.ready()) { Sync.start(); fmRender(); toast('Семья подключена ✓'); }
    else toast('Нужны токен и ID комнаты');
  });

  /* Старт */
  renderMonthLabel();
  renderBasket();
  fmRender();
  if (Sync.ready()) Sync.start();
})();
