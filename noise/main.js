// === Глобальные переменные ===
let audioCtx = null;
let gainNode = null;
let noiseNode = null;
let stopTimerId = null;
let currentTypeKey = 'white';
let audioInitialized = false;

const NoiseType = { white: 0, pink: 1, brown: 2 };

const $ = (sel) => document.querySelector(sel);

const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const typeButtons = [$('#typeWhite'), $('#typePink'), $('#typeBrown')];
const volumeSlider = $('#volumeSlider');
const timerMinutes = $('#timerMinutes');
const statusEl = $('#status');
const volumeValue = $('#volumeValue');

// === Утилиты ===
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

// === ИНИЦИАЛИЗАЦИЯ АУДИО ПРИ ПЕРВОМ КЛИКЕ НА СТАРТ ===
async function initAudio() {
  // Создаём контекст — СИНХРОННО в обработчике клика
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
    // Возобновляем (на случай, если был suspended)
    await audioCtx.resume();
    console.log('✅ AudioContext запущен');

    // Загружаем worklet
    await audioCtx.audioWorklet.addModule('./white-pink-brown-processor.js?v=1.9');

    // Создаём узлы
    gainNode = new GainNode(audioCtx, { gain: 0 });
    gainNode.connect(audioCtx.destination);

    noiseNode = new AudioWorkletNode(audioCtx, 'noise-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    noiseNode.connect(gainNode);

    // Устанавливаем тип
    const now = audioCtx.currentTime;
    const param = noiseNode.parameters.get('type');
    if (param) param.setValueAtTime(NoiseType[currentTypeKey], now);

    audioInitialized = true;
    console.log('✅ Аудио инициализировано');
    setStatus(`готов, тип: ${currentTypeKey}`);
  } catch (err) {
    console.error('❌ Ошибка инициализации аудио:', err);
    setStatus('Ошибка: ' + err.message);
    audioInitialized = false;
    audioCtx = null;
  }
}

// === УПРАВЛЕНИЕ ШУМОМ ===
async function startNoiseUI() {
  if (!audioInitialized) {
    await initAudio();
    if (!audioInitialized) return; // ошибка
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const vol = Math.max(0, Math.min(1, +volumeSlider.value));

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(vol, now + 0.3);

  const typeValue = NoiseType[currentTypeKey];
  const param = noiseNode.parameters.get('type');
  if (param) param.setValueAtTime(typeValue, now);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus(`играет (${currentTypeKey}), громк. ${(vol * 100).toFixed(1)}%`);
  scheduleAutoTimerFromUI();
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
    try { noiseNode?.disconnect(); } catch { }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('остановлен');
  }, ramp * 1000 + 50);
}

function setTypeUI(key) {
  currentTypeKey = key;
  updateTypeButtons(key);

  if (audioInitialized && noiseNode && audioCtx) {
    const now = audioCtx.currentTime;
    const param = noiseNode.parameters.get('type');
    if (param) param.setValueAtTime(NoiseType[key], now);

    const vol = gainNode.gain.value;
    setStatus(`играет (${key}), громк. ${(vol * 100).toFixed(1)}%`);
  }
}

function setVolumeUI(value) {
  const vol = Math.max(0, Math.min(1, +value));
  volumeValue.textContent = `${(vol * 100).toFixed(1)}%`;

  if (audioInitialized && gainNode && audioCtx) {
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(vol, now + 0.08);

    if (noiseNode) {
      setStatus(`играет (${currentTypeKey}), громк. ${(vol * 100).toFixed(1)}%`);
    }
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
  const mins = Math.max(0, +timerMinutes.value);
  if (mins > 0) {
    stopTimerId = setTimeout(() => stopNoiseUI({ ramp: 0.4 }), mins * 60 * 1000);
    statusEl.textContent += ` • авто-стоп через ${mins} мин`;
  }
}

// === ОБРАБОТЧИКИ UI ===
startBtn.addEventListener('click', startNoiseUI);
stopBtn.addEventListener('click', () => stopNoiseUI({ ramp: 0.3 }));

typeButtons.forEach(btn => {
  btn.addEventListener('click', () => setTypeUI(btn.dataset.type));
});

volumeSlider.addEventListener('input', (e) => setVolumeUI(e.target.value));
timerMinutes.addEventListener('change', () => {
  if (audioInitialized) scheduleAutoTimerFromUI();
});

// === ОЧИСТКА ПРИ ЗАКРЫТИИ ===
window.addEventListener('beforeunload', () => {
  if (noiseNode) stopNoiseUI({ ramp: 0 });
});

// === ИНИЦИАЛИЗАЦИЯ UI ===
updateTypeButtons(currentTypeKey);
setStatus('готов — нажмите Старт');