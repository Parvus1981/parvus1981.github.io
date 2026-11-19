/* Голосовой движок: Web Speech API + резервная запись аудио → Mistral Voxtral */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR;
  let rec = null;
  let active = false;
  let wantStop = false;
  let buffer = '';
  let idleTimer = null;
  let onResult = null;
  let onState = null;

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
        if (r.isFinal) buffer += r[0].transcript + ' ';
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
      if (active && !wantStop) { try { rec.start(); } catch (err) { active = false; onState('idle'); } }
      else onState('idle');
    };
    active = true;
    onState('listening');
    try { rec.start(); } catch (e) { /* уже запущен */ }
    armIdle();
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop(), 12000);
  }

  function stop() {
    wantStop = true;
    clearTimeout(idleTimer);
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
        if (!res.ok) throw new Error('Voxtral ' + res.status);
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
    armIdle();
    return true;
  }

  function voxStop() {
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
