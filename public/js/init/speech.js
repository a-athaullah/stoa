// ── Speech-to-text (Web Speech API) ────────────────────────────────────────
(function() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = document.getElementById('voice-btn');
  const langBtn = document.getElementById('voice-lang-btn');
  if (!SpeechRecognition || !voiceBtn) {
    if (voiceBtn) voiceBtn.title = 'Speech not supported in this browser';
    if (langBtn) langBtn.style.display = 'none';
    return;
  }

  const langs = [
    { code: 'en-US', label: 'EN', send: /send\s*(it\s*)?now/i, stop: /stop\s*listening/i, clear: /clear\s*all/i },
    { code: 'id-ID', label: 'ID', send: /kirim(kan)?\s*(sekarang|sekarang juga|dulu)/i, stop: /matikan\s*mic/i, clear: /hapus\s*semua/i },
    { code: 'ja-JP', label: 'JA', send: /送信(して)?/i, stop: /マイク(を)?止め/i, clear: /全部消(して|す)/i },
    { code: 'ko-KR', label: 'KO', send: /지금\s*보내/i, stop: /마이크\s*끄/i, clear: /전부\s*지우/i },
    { code: 'zh-CN', label: 'ZH', send: /现在发送/i, stop: /关闭麦克风/i, clear: /全部清除/i },
  ];
  let langIdx = parseInt(localStorage.getItem('stoa-voice-lang') || '0', 10);
  if (langIdx >= langs.length) langIdx = 0;
  langBtn.textContent = langs[langIdx].label;

  langBtn.addEventListener('click', () => {
    langIdx = (langIdx + 1) % langs.length;
    localStorage.setItem('stoa-voice-lang', langIdx);
    langBtn.textContent = langs[langIdx].label;
    if (isRecording) { stopRecognition(); startRecognition(); }
  });

  let recognition = null;
  let isRecording = false;

  const isAndroid = /Android/i.test(navigator.userAgent);

  function startRecognition() {
    const lang = langs[langIdx];
    recognition = new SpeechRecognition();
    recognition.lang = lang.code;
    recognition.continuous = true;
    recognition.interimResults = true;

    const input = document.getElementById('msg-input');
    const existingText = input.textContent.replace(/​/g, '').trim();
    let baseText = existingText ? existingText + ' ' : '';
    let finalResults = [];
    let skipUntilRestart = false;

    recognition.onresult = (event) => {
      if (skipUntilRestart) return;
      if (processingMessages.size > 0) return;
      let full;
      if (isAndroid) {
        const last = event.results[event.results.length - 1];
        full = (baseText + last[0].transcript).trim();
      } else {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalResults[i] = t;
          } else {
            interim += t;
          }
        }
        const finalTranscript = baseText + finalResults.filter(Boolean).join('');
        full = (finalTranscript + interim).trim();
      }
      if (lang.stop.test(full)) {
        input.textContent = '';
        stopRecognition();
        return;
      }
      if (lang.clear.test(full)) {
        baseText = '';
        finalResults = [];
        input.textContent = '';
        skipUntilRestart = true;
        try { recognition.stop(); } catch {}
        return;
      }
      if (lang.send.test(full)) {
        const cleaned = full.replace(lang.send, '').trim();
        input.textContent = cleaned;
        if (cleaned) sendMessage();
        baseText = '';
        finalResults = [];
        input.textContent = '';
        skipUntilRestart = true;
        try { recognition.stop(); } catch {}
        return;
      }
      input.textContent = full;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.warn('Speech recognition error:', event.error);
      stopRecognition();
    };

    recognition.onend = () => {
      if (isRecording) {
        if (isAndroid) {
          stopRecognition();
        } else {
          skipUntilRestart = false;
          const currentText = input.textContent.replace(/​/g, '').trim();
          baseText = currentText ? currentText + ' ' : '';
          finalResults = [];
          try { recognition.start(); } catch {}
        }
      }
    };

    recognition.start();
    isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.title = 'Stop recording';
  }

  function stopRecognition() {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Speech to text';
    if (recognition) {
      try { recognition.stop(); } catch {}
      recognition = null;
    }
  }

  voiceBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecognition();
    } else {
      startRecognition();
    }
  });

  window.stopVoiceRecognition = stopRecognition;

  // Auto-stop mic when tab becomes hidden
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isRecording) stopRecognition();
  });
})();

init();
