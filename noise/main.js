let audioCtx;
let gainNode;
let noiseNode;
let stopTimerId = null;
let currentTypeKey = 'white';

const NoiseType = { white: 0, pink: 1, brown: 2 };

const $ = (sel) => document.querySelector(sel);

const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const typeButtons = [$('#typeWhite'), $('#typePink'), $('#typeBrown')];
const volumeSlider = $('#volumeSlider');
const timerMinutes = $('#timerMinutes');
const statusEl = $('#status');

// === ФЛАГ: аудио уже инициализировано
let audioInitialized = false;

// === ИНИЦИАЛИЗАЦИЯ ПРИ ПЕРВОМ КЛИКЕ/КАСАНИИ ===

function initAudio() {
  // Удаляем обработчики
  document.body.removeEventListener('click', initAudio);
  document.body.removeEventListener('touchstart', initAudio);

  // Создаём AudioContext
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Проверяем состояние
  if (audioCtx.state === 'suspended') {
    audioCtx.resume(); // ✅ Синхронный вызов — сохраняет user gesture
  }

  console.log('✅ AudioContext: создан и возобновлён');

  // Теперь можно безопасно загружать worklet и создавать узлы
  audioCtx.audioWorklet.addModule('./white-pink-brown-processor.js?v=1.9')
    .then(() => {
      console.log('✅ Worklet загружен');

      // Создаём узлы
      gainNode = new GainNode(audioCtx, { gain: 0 });
      gainNode.connect(audioCtx.destination);

      noiseNode = new AudioWorkletNode(audioCtx, 'noise-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // Устанавливаем тип
      const now = audioCtx.currentTime;
      noiseNode.parameters.get('type')?.setValueAtTime(NoiseType[currentTypeKey], now);

      console.log('✅ Аудиограф инициализирован');
      audioInitialized = true;
      setStatus('готов (нажмите Старт)');
    })
    .catch(err => {
      console.error('❌ Ошибка загрузки worklet:', err);
      setStatus('Ошибка: не удалось загрузить шум');
    });
}

// Назначаем обработчики (без async!)
document.body.addEventListener('touchstart', initAudio, { once: true, passive: false });
document.body.addEventListener('click', initAudio, { once: true });

// === УТИЛИТЫ ===

function setStatus(text) {
  statusEl.textContent = `Статус: ${text}`;
}

function updateTypeButtons(activeKey) {
  for (const btn of typeButtons) {
    const isActive = btn.dataset.type === activeKey;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.classList.toggle('primary', isActive);
  }
}

// === УПРАВЛЕНИЕ ШУМОМ ===

function startNoiseUI() {
  if (!audioInitialized || !noiseNode || !gainNode) {
    setStatus('Ошибка: аудио не инициализировано');
    return;
  }

  try {
    noiseNode.disconnect();
    noiseNode.connect(gainNode);

    const vol = Math.max(0, Math.min(1, parseFloat(volumeSlider.value) || 0.04));
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(vol, now + 0.3);

    const typeValue = NoiseType[currentTypeKey] ?? 0;
    noiseNode.parameters.get('type')?.setValueAtTime(typeValue, now);

    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);

    scheduleAutoTimerFromUI();
  } catch (err) {
    console.error('❌ Ошибка при запуске шума:', err);
    setStatus('Ошибка при запуске');
  }
}

function stopNoiseUI({ ramp = 0.3 } = {}) {
  if (!gainNode || !noiseNode) return;

  clearAutoTimer();

  const now = audioCtx.currentTime;
  const currentGain = gainNode.gain.value;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(currentGain, now);
  gainNode.gain.linearRampToValueAtTime(0, now + ramp);

  setTimeout(() => {
    try { noiseNode?.disconnect(); } catch {}
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('остановлен');
  }, ramp * 1000 + 50);
}

function setTypeUI(key) {
  currentTypeKey = key;
  updateTypeButtons(key);

  if (noiseNode && audioCtx) {
    const typeValue = NoiseType[key] ?? 0;
    const now = audioCtx.currentTime;
    noiseNode.parameters.get('type')?.setValueAtTime(typeValue, now);
    noiseNode.port.postMessage({ type: typeValue });

    const vol = gainNode?.gain.value ?? 0;
    setStatus(`играет (${key}), громк. ${vol.toFixed(3)}`);
  }
}

function setVolumeUI(value) {
  if (!gainNode || !audioCtx) return;

  const vol = Math.max(0, Math.min(1, Number(value) || 0));
  const now = audioCtx.currentTime;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(vol, now + 0.08);

  if (noiseNode) {
    setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);
  }
}

function clearAutoTimer() {
  if (stopTimerId) {
    clearTimeout(stopTimerId);
    stopTimerId = null;
  }
}

function scheduleAutoTimerFromUI() {
  clearAutoTimer();
  const mins = Math.max(0, Number(timerMinutes.value) || 0);
  if (mins > 0) {
    stopTimerId = setTimeout(() => stopNoiseUI({ ramp: 0.4 }), mins * 60 * 1000);
    statusEl.textContent += ` • авто-стоп через ${mins} мин`;
  }
}

// === ОБРАБОТЧИКИ UI ===

startBtn.addEventListener('click', startNoiseUI);
stopBtn.addEventListener('click', () => stopNoiseUI({ ramp: 0.3 }));

for (const btn of typeButtons) {
  btn.addEventListener('click', () => setTypeUI(btn.dataset.type));
}

volumeSlider.addEventListener('input', (e) => setVolumeUI(e.target.value));
timerMinutes.addEventListener('change', () => {
  if (noiseNode) scheduleAutoTimerFromUI();
});

// === ИНИЦИАЛИЗАЦИЯ ===
updateTypeButtons(currentTypeKey);
setStatus('готов (коснитесь экрана)');

window.addEventListener('beforeunload', () => {
  if (noiseNode) stopNoiseUI({ ramp: 0 });
});