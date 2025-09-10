let audioCtx;
let gainNode;
let noiseNode;
let stopTimerId = null;
let currentTypeKey = 'white';

const NoiseType = { white: 0, pink: 1, brown: 2 };

// Утилита поиска элементов
const $ = (sel) => document.querySelector(sel);

// DOM-элементы
const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const typeButtons = [$('#typeWhite'), $('#typePink'), $('#typeBrown')];
const volumeSlider = $('#volumeSlider');
const timerMinutes = $('#timerMinutes');
const statusEl = $('#status');

// === ПРОБУЖДЕНИЕ АУДИО ПРИ ПЕРВОМ ВЗАИМОДЕЙСТВИИ ===

/**
 * Пробуждает AudioContext при первом клике или касании
 * Должен быть синхронным, чтобы обойти ограничения мобильных браузеров
 */
function wakeUpAudio() {
  // Удаляем обработчики
  document.body.removeEventListener('click', wakeUpAudio);
  document.body.removeEventListener('touchstart', wakeUpAudio);

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
      .then(() => {
        const gain = audioCtx.createGain();
        gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        console.log('✅ AudioContext: пробуждён');
      })
      .catch(err => console.error('❌ AudioContext: не удалось возобновить', err));
  }
}

// Важно: passive: false для touchstart, чтобы можно было вызвать resume()
document.body.addEventListener('touchstart', wakeUpAudio, { once: true, passive: false });
document.body.addEventListener('click', wakeUpAudio, { once: true });

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

// === ЗАГРУЗКА И ПРОВЕРКА WORKLET ===

/**
 * Гарантирует, что AudioContext и worklet готовы к использованию
 */
async function ensureContext() {
  if (!audioCtx) {
    // Это резервный случай — ideally уже пробуждён через wakeUpAudio
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.warn('AudioContext создан в ensureContext — лучше в user gesture');
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  // Загружаем worklet только один раз
  if (!globalThis._workletLoaded) {
    const url = './white-pink-brown-processor.js?v=1.7'; // Обнови при изменениях
    console.log('⏳ Загрузка worklet:', url);

    try {
      await audioCtx.audioWorklet.addModule(url);
      globalThis._workletLoaded = true;
      console.log('✅ Worklet загружен');
    } catch (err) {
      console.error('❌ Ошибка загрузки worklet:', err);
      setStatus('Ошибка: не удалось загрузить шум');
      throw err;
    }
  }

  // Дополнительная проверка: можно ли создать узел?
  try {
    const test = new AudioWorkletNode(audioCtx, 'noise-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    test.disconnect();
    test.port.postMessage({ ping: 'ready' });
    console.log('✅ noise-processor проверен и готов');
  } catch (err) {
    console.error('❌ noise-processor недоступен:', err);
    globalThis._workletLoaded = false;
    throw new Error('Worklet не готов — перезагрузка...');
  }
}

// === УПРАВЛЕНИЕ ШУМОМ ===

async function startNoiseUI() {
  try {
    console.log('🔊 startNoiseUI: вызван');
    await ensureContext();

    // Создаём узлы
    gainNode = new GainNode(audioCtx, { gain: 0 });
    gainNode.connect(audioCtx.destination);

    noiseNode = new AudioWorkletNode(audioCtx, 'noise-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { type: NoiseType[currentTypeKey] ?? 0 },
    });
    noiseNode.connect(gainNode);

    // Плавное включение
    const vol = Math.max(0, Math.min(1, parseFloat(volumeSlider.value) || 0.04));
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.3);

    // UI
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);

    // Таймер
    scheduleAutoTimerFromUI();
  } catch (err) {
    console.error('❌ Ошибка при запуске шума:', err);
    setStatus(`Ошибка: ${err.message || 'неизвестная ошибка'}`);
  }
}

async function stopNoiseUI({ ramp = 0.3 } = {}) {
  if (!audioCtx || !gainNode || !noiseNode) return;

  clearAutoTimer();

  const now = audioCtx.currentTime;
  const currentGain = gainNode.gain.value;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(currentGain, now);
  gainNode.gain.linearRampToValueAtTime(0, now + ramp);

  setTimeout(() => {
    try { noiseNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    noiseNode = null;
    gainNode = null;

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
    const param = noiseNode.parameters.get('type');

    if (param) param.setValueAtTime(typeValue, now + 0.01);
    noiseNode.port.postMessage({ type: typeValue });

    const vol = gainNode.gain.value;
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
setStatus('остановлен');

// Очистка при выходе
window.addEventListener('beforeunload', () => {
  if (noiseNode) stopNoiseUI({ ramp: 0 });
});