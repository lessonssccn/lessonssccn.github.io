class NoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'type', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' } // 0=white,1=pink,2=brown
    ];
  }

  constructor() {
    super();
    // Массив из 6 ячеек для розового шума (не 7!)
    this._pink = new Float32Array(6); // b0..b5
    this._lastOut = 0.0;              // для коричневого шума
    this._noiseType = 0;              // тип шума из сообщений

    this.port.onmessage = (e) => {
      const t = e?.data?.type;
      if (typeof t === 'number') {
        this._noiseType = Math.max(0, Math.min(2, t | 0));
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0]; // outputs[0] — массив каналов
    const numChannels = output.length;
    if (numChannels === 0) return true;

    const channelCount = output.length;
    const frameCount = output[0].length;

    const paramType = parameters.type;
    const typeIsConstant = paramType.length === 1;
    const typeConst = typeIsConstant ? (paramType[0] | 0) : 0;

    for (let i = 0; i < frameCount; i++) {
      // Определяем текущий тип шума
      const t = typeIsConstant ? typeConst : ((paramType[i] | 0) || this._noiseType);
      let sample = 0;

      if (t === 0) {
        // Белый шум
        sample = Math.random() * 2 - 1;
      } else if (t === 1) {
        // Розовый шум — IIR фильтр (6 каскадов)
        const white = Math.random() * 2 - 1;

        // Коэффициенты и состояния
        const b = this._pink;

        b[0] = 0.99765 * b[0] + white * 0.099046;
        b[1] = 0.96300 * b[1] + white * 0.296516;
        b[2] = 0.84970 * b[2] + white * 0.57047;
        b[3] = 0.60347 * b[3] + white * 0.761723;

        // Эти коэффициенты более стабильны
        sample = b[0] + b[1] + b[2] + b[3] + white * 0.160; // + white * gain

        // Нормализация (примерная)
        sample *= 0.3; // Подбирается экспериментально
      } else if (t === 2) {
        // Коричневый шум (интегрирующий фильтр)
        const white = Math.random() * 2 - 1;
        this._lastOut = (this._lastOut + 0.02 * white) / 1.02;
        sample = this._lastOut * 3.5;
      }

      // Записываем в каждый канал
      for (let ch = 0; ch < channelCount; ch++) {
        output[ch][i] = sample;
      }
    }

    return true;
  }
}

registerProcessor('noise-processor', NoiseProcessor);