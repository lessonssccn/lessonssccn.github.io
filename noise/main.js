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

async function ensureContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('./white-pink-brown-processor.js');
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

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

async function startNoiseUI() {
  await ensureContext();

  // Узлы
  gainNode = new GainNode(audioCtx);
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.connect(audioCtx.destination);

  noiseNode = new AudioWorkletNode(audioCtx, 'noise-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [22],
    parameterData: { type: NoiseType[currentTypeKey] ?? 0 },
  });
  noiseNode.connect(gainNode);

  // Плавный старт
  const vol = parseFloat(volumeSlider.value) || 0.04;
  gainNode.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.3);

  // Кнопки
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);

  // Таймер
  scheduleAutoTimerFromUI();
}

async function stopNoiseUI({ ramp = 0.3 } = {}) {
  if (!audioCtx || !gainNode || !noiseNode) return;

  clearAutoTimer();

  const now = audioCtx.currentTime;
  const cur = gainNode.gain.value;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(cur, now);
  gainNode.gain.linearRampToValueAtTime(0, now + ramp);

  setTimeout(() => {
    try { noiseNode.disconnect(); } catch {}
    try { gainNode.disconnect(); } catch {}
    noiseNode = null;
    gainNode = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus('остановлен');
  }, ramp * 1000 + 25);
}

function setTypeUI(key) {
  currentTypeKey = key;
  updateTypeButtons(key);
  if (noiseNode) {
    const t = NoiseType[key] ?? 0;
    const now = audioCtx.currentTime;
    const param = noiseNode.parameters.get('type');
    if (param) param.setValueAtTime(t, now + 0.01);
    noiseNode.port.postMessage({ type: t });
    setStatus(`играет (${key}), громк. ${(gainNode?.gain.value ?? 0).toFixed(3)}`);
  }
}

function setVolumeUI(value) {
  if (!gainNode || !audioCtx) return;
  const vol = Math.max(0, Math.min(1, Number(value) || 0));
  const now = audioCtx.currentTime;
  // Избегаем щелчков — короткая линейная огибающая
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.linearRampToValueAtTime(vol, now + 0.08);
  setStatus(`играет (${currentTypeKey}), громк. ${vol.toFixed(3)}`);
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

/* wire UI */
startBtn.addEventListener('click', startNoiseUI);
stopBtn.addEventListener('click', () => stopNoiseUI({ ramp: 0.3 }));
for (const btn of typeButtons) {
  btn.addEventListener('click', () => setTypeUI(btn.dataset.type));
}
volumeSlider.addEventListener('input', (e) => setVolumeUI(e.target.value));
timerMinutes.addEventListener('change', () => {
  if (noiseNode) scheduleAutoTimerFromUI();
});

updateTypeButtons(currentTypeKey);
setStatus('остановлен');
