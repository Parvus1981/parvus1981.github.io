/* Голосовой движок: Web Speech API + резервная запись аудио → Mistral Voxtral */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR;
  let rec = null;
  let active = false;
  let wantStop = false;
  let buffer = '';
  let idleTimer = null;
  let sessTimer = null;
  let onResult = null;
  let onState = null;
  let recStartTs = 0;
  let fastEnds = 0;

  function start(resultCb, stateCb) {
    onResult = resultCb || (() => {});
    onState = stateCb || (() => {});
    buffer = '';
    wantStop = false;
    if (!supported) {
      if (Storage.settings().aiKey) return recordWithVoxtral();
      onState('unsupported');
      return false;
    }
    startSR();
    return true;
  }

  function appendFinal(chunk) {
    chunk = (chunk || '').trim();
    if (!chunk) return;
    const tail = buffer.trim();
    if (tail.endsWith(chunk)) return;
    const tw = tail.split(' ').filter(Boolean);
    const cw = chunk.split(' ').filter(Boolean);
    const maxK = Math.min(tw.length, cw.length, 8);
    let overlap = 0;
    for (let k = maxK; k > 0; k--) {
      if (tw.slice(-k).join(' ') === cw.slice(0, k).join(' ')) { overlap = k; break; }
    }
    const add = overlap ? cw.slice(overlap).join(' ') : chunk;
    if (tail.length + add.length < 400) buffer += add + ' ';
  }

  function startSR() {
    if (rec) { try { rec.abort(); } catch (e) {} }
    rec = new SR();
    rec.lang = Storage.settings().voiceLang || 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) appendFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      onResult((buffer + interim).trim(), false);
      armIdle();
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stop();
        onState('denied');
      } else if (e.error === 'audio-capture') {
        stop();
        onState('no-mic');
      } else if (e.error === 'network' && !buffer) {
        onState('network');
      }
    };
    rec.onend = () => {
      if (active && !wantStop) {
        const uptime = Date.now() - recStartTs;
        if (uptime < 900) {
          fastEnds++;
          if (fastEnds >= 4) { active = false; onState('unsupported'); return; }
        } else fastEnds = 0;
        try { rec.start(); } catch (err) { active = false; onState('idle'); }
      } else onState('idle');
    };
    active = true;
    onState('listening');
    try { rec.start(); } catch (e) { /* уже запущен */ }
    recStartTs = Date.now();
    armIdle();
    clearTimeout(sessTimer);
    sessTimer = setTimeout(() => stop(), 30000);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop(), 4000);
  }

  function stop() {
    wantStop = true;
    clearTimeout(idleTimer);
    clearTimeout(sessTimer);
    if (rec) { try { rec.stop(); } catch (e) { try { rec.abort(); } catch (e2) {} } }
    active = false;
    onState('idle');
    const text = buffer.trim();
    buffer = '';
    if (text) onResult(text, true);
  }

  /* Резерв: запись микрофона → Voxtral (Mistral) */
  let mediaStream = null, mediaRec = null, chunks = [];

  async function recordWithVoxtral() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      onState('denied');
      return false;
    }
    chunks = [];
    mediaRec = new MediaRecorder(mediaStream);
    mediaRec.ondataavailable = e => chunks.push(e.data);
    mediaRec.onstop = async () => {
      mediaStream.getTracks().forEach(t => t.stop());
      onState('transcribing');
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const fd = new FormData();
        fd.append('file', blob, 'speech.webm');
        fd.append('model', 'voxtral-mini-latest');
        const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${Storage.settings().aiKey}` },
          body: fd
        });
        if (!res.ok) { onState(res.status === 401 ? 'bad-key' : 'error'); return; }
        const j = await res.json();
        const text = (j.text || '').trim();
        onState('idle');
        if (text) onResult(text, true);
        else onState('empty');
      } catch (err) {
        onState('error');
      }
    };
    active = true;
    onState('recording');
    mediaRec.start();
    clearTimeout(sessTimer);
    sessTimer = setTimeout(() => voxStop(), 45000);
    return true;
  }

  function voxStop() {
    clearTimeout(sessTimer);
    if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  }

  return {
    supported,
    start(resultCb, stateCb) { return start(resultCb, stateCb); },
    stop() {
      if (mediaRec && mediaRec.state === 'recording') voxStop();
      else stop();
    },
    voxRecording: () => !!(mediaRec && mediaRec.state === 'recording'),
    get active() { return active; }
  };
})();
