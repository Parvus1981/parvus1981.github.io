/* Главный модуль приложения */
(() => {
  const $ = id => document.getElementById(id);
  const CUR = () => Storage.settings().currency;
  const fmt = n => `${(Number(n) || 0).toFixed(2)}${CUR()}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let state = {
    month: new Date().toISOString().slice(0, 7),
    draft: [],
    donut: null,
    bar: null,
    filterCat: ''
  };

  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------- Навигация ---------- */
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name === 'tx') renderTx();
    if (name === 'budget') renderBudget();
    if (name === 'overview') renderOverview();
    if (name === 'deals') renderMarkets();
    if (name === 'settings') loadSettingsUI();
    window.scrollTo(0, 0);
  }

  $('prevMonth').addEventListener('click', () => shiftMonth(-1));
  $('nextMonth').addEventListener('click', () => shiftMonth(1));
  function shiftMonth(d) {
    const [y, m] = state.month.split('-').map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    state.month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    renderMonthLabel(); renderTx();
  }
  function renderMonthLabel() {
    const [y, m] = state.month.split('-').map(Number);
    $('monthLabel').textContent = new Date(y, m - 1, 1)
      .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    $('budgetMonth').textContent = `(${state.month})`;
  }

  /* ---------- Голосовой ввод ---------- */
  let recog = null;
  $('btnVoice').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Голос не поддерживается этим браузером — используйте Chrome'); manualToggle(true); return; }
    if (recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = Storage.settings().voiceLang || 'de-DE';
    recog.continuous = true;
    recog.interimResults = false;
    let collected = '';
    recog.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) collected += ' ' + e.results[i][0].transcript;
      }
      $('voiceStatus').querySelector('span:last-child')?.remove();
      $('voiceStatus').innerHTML = `<span class="pulse">🎙️</span> ${collected.trim() || 'Говорите…'}`;
    };
    recog.onend = () => {
      $('voiceStatus').hidden = true;
      recog = null;
      if (collected.trim()) {
        manualToggle(true);
        $('manualInput').value = ($('manualInput').value + ' ' + collected).trim();
        makeDraft(parseItemsText(collected));
        toast('Голос распознан ✓');
      }
    };
    recog.onerror = e => { toast('Ошибка распознавания: ' + e.error); $('voiceStatus').hidden = true; recog = null; };
    $('voiceStatus').hidden = false;
    recog.start();
  });

  /* ---------- Ручной ввод / парсинг ---------- */
  $('btnManual').addEventListener('click', () => manualToggle());
  function manualToggle(force) {
    const a = $('manualArea');
    a.hidden = force === true ? false : !a.hidden;
    if (!a.hidden) $('manualInput').focus();
  }
  $('btnParseText').addEventListener('click', () => {
    const items = parseItemsText($('manualInput').value);
    if (!items.length) return toast('Не нашёл позиции — напишите в формате: молоко 1.29');
    makeDraft(items);
  });

  /* ---------- OCR чека ---------- */
  $('photoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const url = URL.createObjectURL(file);
    const prev = $('receiptPreview');
    prev.src = url; prev.hidden = false;
    $('ocrProgress').hidden = false;
    if (typeof Tesseract === 'undefined') {
      $('ocrProgress').hidden = true;
      return toast('OCR-библиотека ещё не загрузилась, попробуйте снова');
    }
    try {
      const langs = Storage.settings().ocrLang || 'deu+rus+eng';
      const res = await Tesseract.recognize(file, langs, {
        logger: m => { if (m.status === 'recognizing text' && m.progress) $('ocrStatus').textContent = `${Math.round(m.progress * 100)}%`; }
      });
      const text = res.data.text || '';
      await ingestReceipt(text);
    } catch (err) {
      console.error(err);
      toast('Не удалось распознать чек');
    } finally {
      $('ocrProgress').hidden = true;
      $('ocrStatus').textContent = '';
    }
  });

  async function ingestReceipt(text) {
    if (!text.trim()) return toast('Текст чека пуст — сфотографируйте ближе и чётче');
    if (Storage.settings().aiKey) {
      try {
        toast('🤖 AI разбирает чек…', 4000);
        const items = await AI.parseReceipt(text, CUR());
        if (items.length) { makeDraft(items); return; }
      } catch (err) { AI.showErr($('toast') ?? {}, err); console.warn(err); }
    }
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !/summe|total|итог|bar|karte|change|wec?hselgeld|zwischensumme|mwst|ust|vat|edv|ungef/i.test(l));
    const items = [];
    for (const line of lines) {
      const it = parseChunk(line.replace(/\s{3,}/g, ' ').replace(/^[xX*]\s*/, ''));
      if (it && it.price > 0 && it.name.length > 1) items.push(it);
    }
    if (!items.length) return toast('Позиции не найдены — добавьте AI-ключ или введите вручную');
    makeDraft(items);
  }

  /* ---------- Черновик ---------- */
  function fillCatSelect(sel, chosen) {
    sel.innerHTML = CATS.map(c => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${c.name}</option>`).join('');
  }
  CATS.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    $('filterCat').appendChild(opt);
    $('draftCat').appendChild(opt.cloneNode(true));
  });

  function makeDraft(items) {
    state.draft = items.map(it => ({
      id: uid(), name: it.name || 'Позиция', qty: Number(it.qty) || 1,
      price: Number(it.price) || 0, cat: it.cat || guessCat(it.name)
    }));
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
      row.querySelector('.del').addEventListener('click', () => {
        state.draft = state.draft.filter(x => x.id !== it.id);
        renderDraft();
      });
      wrap.appendChild(row);
    });
    $('draftTotal').textContent = fmt(total);
    if (!state.draft.length) $('draftArea').hidden = true;
  }

  $('btnDiscard').addEventListener('click', () => {
    state.draft = []; $('draftArea').hidden = true;
    $('manualInput').value = ''; $('receiptPreview').hidden = true;
    $('manualArea').hidden = true;
  });

  $('btnSaveDraft').addEventListener('click', () => {
    if (!state.draft.length) return toast('Нечего сохранять');
    const cat = $('draftCat').value;
    const total = state.draft.reduce((s, it) => s + it.qty * it.price, 0);
    Storage.addTx({
      id: uid(),
      date: $('draftDate').value || todayISO(),
      cat,
      items: state.draft.map(({ name, qty, price, cat: icat }) => ({ name, qty, price, cat: icat })),
      total,
      source: state.source
    });
    state.draft = [];
    $('draftArea').hidden = true;
    $('manualInput').value = ''; $('manualArea').hidden = true; $('receiptPreview').hidden = true;
    toast('Сохранено ✓');
    state.month = todayISO().slice(0, 7);
    renderMonthLabel(); renderTx();
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
    } catch (err) { AI.showErr($('toast') ?? {}, err); }
    btn.disabled = false; btn.textContent = '🤖 Умная правка (AI)';
  });
  state.source = 'manual';

  ['btnVoice', 'photoInput', 'btnManual', 'btnParseText'].forEach(() => {});
  $('btnVoice').addEventListener('click', () => { state.source = 'voice'; });
  $('photoInput').addEventListener('change', () => { state.source = 'photo'; });
  $('btnManual').addEventListener('click', () => { state.source = 'manual'; });

  /* ---------- Операции ---------- */
  function renderTx() {
    const list = $('txList');
    list.innerHTML = '';
    const txs = Storage.txsForMonth(state.month)
      .filter(t => !state.filterCat || t.cat === state.filterCat || t.items.some(i => i.cat === state.filterCat));
    $('txEmpty').hidden = txs.length > 0;
    let sum = 0;
    let lastDay = '';
    for (const t of txs) {
      sum += t.total;
      if (t.date !== lastDay) {
        lastDay = t.date;
        const h = document.createElement('div');
        h.className = 'tx-day-header';
        h.textContent = new Date(t.date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        list.appendChild(h);
      }
      const c = catById(t.items[0]?.cat || t.cat);
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div class="tx-main">
          <div class="tx-title">${esc(t.items.map(i => i.name).join(' + '))}<span class="badge">${c.name}</span></div>
          <div class="tx-meta">${t.source === 'voice' ? '🎤' : t.source === 'photo' ? '📷' : '⌨️'} ${t.date}</div>
        </div>
        <div class="tx-amount">${t.total.toFixed(2)}${CUR()}</div>
        <button class="tx-del" title="удалить">🗑</button>`;
      row.querySelector('.tx-del').addEventListener('click', () => {
        Storage.delTx(t.id);
        renderTx(); toast('Удалено');
      });
      list.appendChild(row);
    }
    $('txMonthSum').textContent = txs.length ? `${sum.toFixed(2)}${CUR()}` : '';
  }
  $('filterCat').addEventListener('change', e => { state.filterCat = e.target.value; renderTx(); });

  /* ---------- Бюджет ---------- */
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
          <span class="limit">${s.toFixed(2)}${CUR()} / <input type="number" min="0" step="any" placeholder="лимит" value="${lim}" data-cat="${c.id}"></span>
        </div>
        <div class="bar"><div class="${cls}" style="width:${pct}%"></div></div>`;
      wrap.appendChild(row);
    });
  }
  $('btnSaveBudget').addEventListener('click', () => {
    document.querySelectorAll('#budgetList input[data-cat]').forEach(inp => {
      Storage.setDefault(inp.dataset.cat, inp.value);
    });
    toast('Лимиты сохранены — применяются к каждому месяцу ✓');
  });

  /* ---------- Цели ---------- */
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
        <span style="font-size:.78rem;color:var(--muted)">${(g.saved || 0).toFixed(0)}/${g.target.toFixed(0)}</span>
        <button class="grow" title="пополнить">+10</button>
        <button class="rm" style="border:0;background:none;cursor:pointer">✕</button>`;
      row.querySelector('.grow').addEventListener('click', () => {
        Storage.addGoalAmount(g.id, g.target >= 500 ? 10 : 1);
        renderGoals();
      });
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

  /* ---------- Обзор + графики ---------- */
  function renderOverview() {
    const spent = Storage.spentByCat(state.month);
    const total = Object.values(spent).reduce((a, b) => a + b, 0);
    const txs = Storage.txsForMonth(state.month);
    const now = new Date();
    const dim = state.month === todayISO().slice(0, 7) ? now.getDate() : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    $('statMonth').textContent = `${total.toFixed(2)}${CUR()}`;
    $('statDay').textContent = txs.length ? `${(total / Math.max(1, Math.min(dim, now.getDate()))).toFixed(2)}${CUR()}` : '—';
    $('statCount').textContent = txs.length;

    const labels = CATS.filter(c => spent[c.id] > 0).map(c => c.name);
    const vals = CATS.filter(c => spent[c.id] > 0).map(c => spent[c.id]);
    const colors = CATS.filter(c => spent[c.id] > 0).map(c => c.color);
    if (state.donut) state.donut.destroy();
    state.donut = new Chart($('donutChart'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'bottom' } } }
    });

    const months = [];
    const sums = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push(d.toLocaleDateString('ru-RU', { month: 'short' }));
      const s = Storage.spentByCat(mk);
      sums.push(Object.values(s).reduce((a, b) => a + b, 0));
    }
    if (state.bar) state.bar.destroy();
    state.bar = new Chart($('barChart'), {
      type: 'bar',
      data: { labels: months, datasets: [{ label: `Расходы, ${CUR()}`, data: sums, backgroundColor: '#10b981', borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  $('btnAdvice').addEventListener('click', async () => {
    const out = $('adviceOut');
    if (!Storage.settings().aiKey) return AI.showErr(out, new Error('no-key'));
    const spent = Storage.spentByCat(state.month);
    const limits = Storage.budgetFor(state.month);
    const prev = (() => {
      const [y, m] = state.month.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      return Storage.spentByCat(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    })();
    out.classList.add('thinking');
    out.textContent = '🤖 Анализирую ваш бюджет…';
    try {
      out.textContent = await AI.advice({
        month: state.month,
        currency: CUR(),
        spentByCategory: spent,
        limits,
        prevMonthSpent: prev,
        goals: Storage.goals()
      }, CUR());
    } catch (err) { AI.showErr(out, err); }
    out.classList.remove('thinking');
  });

  /* ---------- Акции ---------- */
  function renderMarkets() {
    const wrap = $('marketsList');
    wrap.innerHTML = '';
    Storage.settings().markets.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'market-row';
      row.innerHTML = `
        <div class="logo" style="background:${m.color || '#10b981'}">${esc((m.name || '?').slice(0, 3).toUpperCase())}</div>
        <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}<small>открыть акции ↗</small></a>
        <button class="rm" title="удалить">✕</button>`;
      row.querySelector('.rm').addEventListener('click', () => {
        const list = Storage.settings().markets.filter((_, j) => j !== i);
        Storage.setMarkets(list);
        renderMarkets();
      });
      wrap.appendChild(row);
    });
  }
  $('btnAddMarket').addEventListener('click', () => {
    const name = $('mkName').value.trim();
    let url = $('mkUrl').value.trim();
    if (!name || !/^https?:\/\//.test(url)) return toast('Название и ссылка https://… обязательны');
    const list = Storage.settings().markets.concat([{ name, url, color: '#10b981' }]);
    Storage.setMarkets(list);
    $('mkName').value = ''; $('mkUrl').value = '';
    renderMarkets();
  });

  $('btnAiDeals').addEventListener('click', async () => {
    const out = $('dealsOut');
    const text = $('dealsInput').value.trim();
    if (!text) return toast('Вставьте список акций из магазина');
    if (!Storage.settings().aiKey) return AI.showErr(out, new Error('no-key'));
    out.classList.add('thinking');
    out.textContent = '🤖 Подбираю лучшее для вашей семьи…';
    const recent = Storage.txsForMonth(state.month).flatMap(t => t.items).map(i => i.name);
    try {
      out.textContent = await AI.pickDeals(text, recent, {
        limits: Storage.budgetFor(state.month),
        spent: Storage.spentByCat(state.month)
      }, CUR());
    } catch (err) { AI.showErr(out, err); }
    out.classList.remove('thinking');
  });

  /* ---------- Настройки ---------- */
  function loadSettingsUI() {
    const s = Storage.settings();
    $('setCurrency').value = s.currency;
    $('setVoiceLang').value = s.voiceLang;
    $('setOcrLang').value = s.ocrLang;
    $('setAiKey').value = s.aiKey || '';
  }
  $('btnSaveSettings').addEventListener('click', () => {
    Storage.updateSettings({
      currency: $('setCurrency').value,
      voiceLang: $('setVoiceLang').value,
      ocrLang: $('setOcrLang').value,
      aiKey: $('setAiKey').value.trim()
    });
    renderMonthLabel();
    toast('Настройки сохранены ✓');
  });

  $('btnExport').addEventListener('click', () => Storage.export());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    const r = new FileReader();
    r.onload = () => {
      try {
        Storage.importJSON(r.result);
        toast('Импорт готов ✓');
        renderMonthLabel(); renderTx();
      } catch (err) { toast('Ошибка импорта: ' + err.message); }
    };
    r.readAsText(f);
  });
  let wipeCount = 0;
  $('btnWipe').addEventListener('click', () => {
    wipeCount++;
    if (wipeCount < 2) return toast('Нажмите ещё раз для подтверждения');
    Storage.wipe();
    toast('Данные удалены');
    renderMonthLabel(); renderTx();
    wipeCount = 0;
  });

  /* ---------- PWA: SW + установка ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.warn));
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

  /* ---------- Утилиты ---------- */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /* ---------- Старт ---------- */
  renderMonthLabel();
  renderTx();
  window.__FB = { state };
})();
