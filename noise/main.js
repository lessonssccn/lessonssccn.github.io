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

// === ПРОБУЖДЕНИЕ АУДИО И СОЗДАНИЕ ГРАФА ПРИ ПЕРВОМ КАСАНИИ ===

/**
 * Создаёт AudioContext и аудиограф при первом взаимодействии
 */
async function wakeUpAudio() {
  // Удаляем обработчики
  document.body.removeEventListener('click', wakeUpAudio);
  document.body.removeEventListener('touchstart', wakeUpAudio);

  // Создаём контекст
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
    console.log('✅ AudioContext: возобновлён');
  }

  // Инициализируем аудиограф
  await initializeAudioGraph();
}

/**
 * Создаёт узлы: gain и noise
 */
async function initializeAudioGraph() {
  try {
    // Загружаем worklet, если ещё не загружен
    if (!globalThis._workletLoaded) {
      const url = './white-pink-brown-processor.js?v=1.9';
      await audioCtx.audioWorklet.addModule(url);
      globalThis._workletLoaded = true;
      console.log('✅ Worklet загружен');
    }

    // Создаём gainNode и подключаем к выходу
    gainNode = new GainNode(audioCtx, { gain: 0 });
    gainNode.connect(audioCtx.destination);

    // Создаём noiseNode, но НЕ подключаем к gainNode
    noiseNode = new AudioWorkletNode(audioCtx, 'noise-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2], // стерео
    });

    // Устанавливаем тип шума по умолчанию
    const now = audioCtx.currentTime;
    noiseNode.parameters.get('type')?.setValueAtTime(NoiseType[currentTypeKey], now);

    console.log('✅ Аудиограф инициализирован и готов');
  } catch (err) {
    console.error('❌ Ошибка инициализации аудиографа:', err);
    setStatus('Ошибка: не удалось настроить аудио');
  }
}

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
  if (!noiseNode || !gainNode || !audioCtx) {
    setStatus('Ошибка: аудио не инициализировано');
    return;
  }

  try {
    // Убедимся, что не подключён
    noiseNode.disconnect();

    // Подключаем шум к gain
    noiseNode.connect(gainNode);

    // Плавное включение громкости
    const vol = Math.max(0, Math.min(1, parseFloat(volumeSlider.value) || 0.04));
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(vol, now + 0.3);

    // Обновляем тип
    const typeValue = NoiseType[currentTypeKey] ?? 0;
    noiseNode.parameters.get('type')?.setValueAtTime(typeValue, now);

    // UI
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);

    // Таймер
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
    // gainNode остаётся подключённым, но с gain=0
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

// Пробуждаем аудио при первом касании/клике
document.body.addEventListener('touchstart', wakeUpAudio, { once: true, passive: false });
document.body.addEventListener('click', wakeUpAudio, { once: true });

startBtn.addEventListener('click', startNoiseUI);
stopBtn.addEventListener('click', () => stopNoiseUI({ ramp: 0.3 }));

for (const btn of typeButtons) {
  btn.addEventListener('click', () => setTypeUI(btn.dataset.type));
}

volumeSlider.addEventListener('input', (e) => setVolumeUI(e.target.value));
timerMinutes.addEventListener('change', () => {
  if (noiseNode) scheduleAutoTimerFromUI();
});

// === ИНИЦИАЛИЗАЦИЯ ИНТЕРФЕЙСА ===
updateTypeButtons(currentTypeKey);
setStatus('готов (коснитесь экрана)');

// Очистка при выходе
window.addEventListener('beforeunload', () => {
  if (noiseNode) stopNoiseUI({ ramp: 0 });
});