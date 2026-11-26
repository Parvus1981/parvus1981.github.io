/* Интеграция с Mistral AI (api.mistral.ai) — ключ хранится только в браузере пользователя */
const AI = (() => {
  const PROVIDERS = {
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', label: 'Mistral' },
    gemini:  { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', label: 'Google Gemini' }
  };

  /* Google часто меняет модели: спрашиваем у API список доступных и запоминаем рабочую */
  const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-2.0-flash'];
  async function pickGeminiModel(key) {
    const saved = Storage.settings().geminiModel;
    if (saved) return saved;
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', { headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) {
        const j = await res.json();
        const ids = (j.data || []).map(m => (m.id || '').replace(/^models\//, ''))
          .filter(id => /^gemini/i.test(id) && /flash/i.test(id) && !/(tts|image|audio|live|embedding|native|thinking|pro)/i.test(id))
          .sort((a, b) => (/lite/i.test(a) ? 0 : 1) - (/lite/i.test(b) ? 0 : 1) || a.length - b.length);
        if (ids.length) {
          Storage.updateSettings({ geminiModel: ids[0] });
          return ids[0];
        }
      }
    } catch (e) { /* сеть — упадём в fallback ниже */ }
    return GEMINI_FALLBACKS[0];
  }

  async function chat(messages, temp = 0.3) {
    const st = Storage.settings();
    const key = st.aiKey;
    if (!key) throw new Error('no-key');
    const p = PROVIDERS[st.aiProvider === 'gemini' ? 'gemini' : 'mistral'];
    let model = p.model;
    if (p === PROVIDERS.gemini) model = await pickGeminiModel(key);

    // кандидаты: выбранная модель + резервные
    const seen = new Set([model, ...GEMINI_FALLBACKS]);
    const candidates = [model, ...GEMINI_FALLBACKS].filter(Boolean);
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await new Promise(r => setTimeout(r, attempt ? 1500 : 0)); // пауза перед повтором
        const res = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: temp, messages })
        });
        if (res.ok) {
          const json = await res.json();
          return json.choices[0].message.content;
        }
        const txt = await res.text();
        lastErr = `${res.status}: ${txt.slice(0, 120)}`;
        if (res.status === 402) {
          throw new Error('У аккаунта Mistral не включён платёж за API (ошибка 402). Варианты: 1) включить биллинг в console.mistral.ai, 2) переключиться на бесплатный Google Gemini в «Ещё» → AI-ключ');
        }
        // 401/403 — нет смысла перебирать модели
        if (res.status === 401 || res.status === 403) throw new Error(`${p.label} ${lastErr}`);
        const transient = res.status === 500 || res.status === 503 || res.status === 429;
        const notFound = res.status === 404 || /not found|not available/i.test(txt);
        if (transient || notFound) {
          if (notFound) Storage.updateSettings({ geminiModel: '' });
          const nextModel = candidates.find(c => c !== model);
          if (attempt < 3 && nextModel) { model = nextModel; continue; }
          if (attempt < 3) continue; // та же модель, но после паузы
        }
        throw new Error(`${p.label} ${lastErr}`);
      } catch (e) {
        if (attempt === 3 || e.message.includes('402') || e.message.includes('401') || e.message.includes('403')) throw e;
      }
    }
    throw new Error(`${p.label}: модель перегружена или недоступна (${lastErr.slice(0, 80)}) — попробуйте ещё раз через минуту`);
  }

  function showErr(out, e) {
    out.classList.remove('thinking');
    out.textContent = e.message === 'no-key'
      ? '⚠️ Добавьте AI-ключ в разделе «Ещё» — бесплатный есть в Google AI Studio (aistudio.google.com/apikey).'
      : `⚠️ ${e.message}`;
  }

  /* Умная правка черновика: AI нормализует названия, категории и суммы */
  async function fixDraft(items, currency) {
    const sys = `Ты — помощник семейного бюджета. Пользователь вводит покупки с чеков/голосом.
Верни STRICT JSON: {"items":[{"name":"короткое чистое название","qty":число,"price":цена за единицу ${currency},"cat":"id категории"}]}
Категории: ${CATS.map(c => `${c.id}=${c.name}`).join(', ')}.
Исправь ошибки распознавания, убери мусор. Не выдумывай позиции — только уточняй введённое.`;
    const raw = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(items) }
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return parsed.items || [];
  }

  /* Совет по бюджету на основе месяцев трат */
  async function advice(summary, currency) {
    const raw = await chat([
      { role: 'system', content: `Ты — дружелюбный семейный финансовый советник. Отвечай на русском, кратко (до 6 пунктов), с эмодзи, конкретно: где можно сэкономить, что заметил в тратах. Данные в ${currency}.` },
      { role: 'user', content: JSON.stringify(summary) }
    ], 0.6);
    return raw;
  }

  /* Подбор выгодных покупок из вставленного списка акций */
  async function pickDeals(dealsText, recentItems, budgetInfo, currency) {
    const raw = await chat([
      { role: 'system', content: `Ты — помощник для экономии в супермаркетах. Пользователь вставил список акций. Учитывая его недавние покупки и лимиты бюджета, выбери самые выгодные для семьи предложения, отметь что стоит закупить впрок, а что маркетинговая ловушка. Отвечай на русском, кратко, с эмодзи, до 8 пунктов. Цены в ${currency}.` },
      { role: 'user', content: `АКЦИИ:\n${dealsText.slice(0, 4000)}\n\nНЕДАВНИЕ ПОКУПКИ: ${JSON.stringify(recentItems.slice(0, 40))}\n\nБЮДЖЕТ: ${JSON.stringify(budgetInfo)}` }
    ], 0.5);
    return raw;
  }

  /* Уборка OCR-текста чека в позиции */
  async function parseReceipt(text, currency) {
    const sys = `Ты парсишь текст, распознанный OCR с кассового чека. Верни STRICT JSON:
{"items":[{"name":"название товара коротко","qty":число,"price":цена позиции ${currency},"cat":"id"}]}
Категории: ${CATS.map(c => `${c.id}=${c.name}`).join(', ')}.
Итоги, сдачу, change и строки SUMME/ИТОГО/TOTAL как item НЕ включай — только купленные товары.`;
    const raw = await chat([
      { role: 'system', content: sys },
      { role: 'user', content: text.slice(0, 2500) }
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return parsed.items || [];
  }

  // проверка API-ключа: реальный минимальный запрос один раз
  async function testKey() {
    const raw = await chat([{ role: 'user', content: 'Ответь ровно одно слово: OK' }], 0);
    return (raw || '').trim().slice(0, 40);
  }

  return { fixDraft, advice, pickDeals, parseReceipt, testKey, showErr };
})();
