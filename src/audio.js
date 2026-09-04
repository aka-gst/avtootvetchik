/*
 * ТЕХНОМАГИЯ — звук.
 *
 * Пока своих треков в игре нет, музыка собирается на месте из
 * осцилляторов: тот же размер, тот же темп, та же роль. Как только рядом
 * появится music/manifest.json с файлами, движок молча переключится на
 * них — код игры об этом не узнает.
 *
 * Так сделано не из любви к синтезу, а чтобы не проектировать звук
 * дважды: темп, громкость и переключение по уровням уже отлажены, файлу
 * останется занять готовое место.
 *
 * Формат манифеста:
 *
 *   { "tracks": [ { "id": 0, "title": "...", "file": "floor-1.mp3" } ] }
 *
 * id — тот самый номер трека, что лежит в коде уровня.
 */

const STEP_PER_BAR = 16;
const BPM = 108;

/*
 * Разбор немого флага вынесен из createAudio наружу по одной причине:
 * внутри его нельзя проверить. Там оно трогает `window`, которого в узле
 * нет, а значит проверки туда не ходят вовсе — и ошибка прожила в
 * рабочем коде до тех пор, пока её не нашли замером на бою.
 *
 * Ошибка была в `\b` после кириллицы. Граница слова в JavaScript
 * определена через `\w`, то есть латиницу с цифрами; после «о» границы
 * нет ни перед концом строки, ни перед «&», и `?тихо` не совпадало
 * никогда. Латинское `?quiet` при этом работало, поэтому выражение
 * выглядело исправным.
 *
 * Соседняя сессия объяснила это тем, что адрес приезжает закодированным
 * и его не расшифровывают. Это не так: `decodeURIComponent` стоял здесь
 * с самого начала, и незакодированная строка тоже не совпадала. Верным
 * оказалось второе их замечание, про границу слова.
 *
 * `try/catch` не украшение: `decodeURIComponent('?%')` бросает URIError,
 * и без защиты игра падала бы на битом адресе ещё до первого кадра.
 */
export function quietFrom(search = '', hash = '') {
  const raw = String(search) + String(hash);
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    /* Битый процент — разбираем как есть, а не роняем страницу. */
  }
  return /(^|[?&#])(тихо|tiho|quiet)(=(1|true))?([&#]|$)/i.test(text);
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let musicFilter = null;
  let sfxBus = null;
  let noiseBuffer = null;

  let manifest = null;
  let element = null;      /* когда играют настоящие файлы */
  let synth = null;        /* когда играет синтез */
  let muted = false;
  let started = false;
  let intensity = 0;

  /*
    На боевом сайте музыка включена с первой секунды — так
    задумано. А локальный предпросмотр открывается заново
    десятки раз за вечер, каждый раз на новом порту, и
    localStorage там всегда пустой: музыка запускалась бы
    снова и снова. Поэтому на localhost умолчание — тишина,
    а явно сохранённый выбор всё равно сильнее умолчания.
  */
  /*
   * Съёмка и обходы витрины идут при выключенном звуке, и выключать его
   * снаружи ненадёжно: звуковой контекст оживает сам при изменении
   * размера окна. Поэтому запрет ставится до старта и живёт в адресе:
   * ?тихо. Латинское написание принимается тоже — адрес нередко
   * набирают руками.
   */
  const quiet = quietFrom(window.location.search, window.location.hash);

  try {
    /* Ключ памяти остаётся прежним намеренно: сменить его — значит
       забыть у всех, кто уже выключил звук, ради красоты имени. */
    const saved = quiet ? '1' : localStorage.getItem('avto-muted');

    const local =
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
        window.location.hostname);

    muted = saved === null ? local : saved === '1';
  } catch (error) {
    muted = false;
  }

  fetch('music/manifest.json', { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => { manifest = data && Array.isArray(data.tracks) ? data : null; })
    .catch(() => { manifest = null; });


  function ensure() {
    if (ctx) return ctx;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 18000;

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.42;
    musicBus.connect(musicFilter);
    musicFilter.connect(master);

    /*
     * Короткое эхо с затуханием. Без него синтез звучит впритык к уху и
     * давит — именно на это и жаловались. Свёртки нет, обходимся линией
     * задержки: дёшево, а воздух появляется.
     */
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 2200;

    musicBus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(echoFilter);
    echoFilter.connect(echo);
    echo.connect(musicFilter);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.85;
    sfxBus.connect(master);

    const frames = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }


  /* =======================================================
     ЭФФЕКТЫ
     ======================================================= */

  function noise(duration, filterType, frequency, gain, q) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    if (q) filter.Q.value = q;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(sfxBus);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  function tone(type, from, to, duration, gain) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(envelope);
    envelope.connect(sfxBus);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /* У каждой стихии свой голос: набор слышно, не глядя на экран. */
  const PITCH = { fire: 220, water: 330, wind: 480 };

  const EFFECTS = {
    shot() { noise(0.16, 'highpass', 900, 0.55); tone('square', 320, 60, 0.14, 0.35); },
    swing() { noise(0.16, 'bandpass', 1500, 0.14, 1.2); },
    /* Глухой удар в тело: низ даёт вес, шум — треск. Свист остаётся промахом. */
    impact() {
      tone('sine', 240, 55, 0.2, 0.7);
      noise(0.14, 'lowpass', 900, 0.55);
      tone('square', 110, 45, 0.1, 0.28);
    },
    knock() { tone('sine', 180, 50, 0.18, 0.5); noise(0.1, 'lowpass', 500, 0.3); },
    kill() { noise(0.28, 'lowpass', 1200, 0.5); tone('sawtooth', 140, 40, 0.3, 0.35); },
    death() { tone('sawtooth', 420, 40, 0.9, 0.5); noise(0.6, 'lowpass', 700, 0.4); },
    pickup() { tone('square', 620, 940, 0.09, 0.22); },
    dry() { noise(0.05, 'highpass', 3000, 0.25); },
    glass() { noise(0.5, 'highpass', 2600, 0.45, 6); },
    spot() { tone('square', 700, 1300, 0.12, 0.28); },
    step() { noise(0.05, 'lowpass', 380, 0.11); },
    exit() { tone('triangle', 520, 1040, 0.35, 0.3); },
    ui() { tone('square', 300, 520, 0.06, 0.16); },

    /* Демоны: набор ползёт вверх, выстрел щёлкает, луч гудит, вспышка бьёт. */
    charge(detail) {
      const base = PITCH[detail && detail.element] || 320;
      tone('triangle', base, base * 2, 0.13, 0.2);
    },
    /*
     * Стихия легла в очередь. Отдельный звук от начала набора, и это не
     * прихоть: набор из трёх — это три события, а не одно действие, и
     * ровно в промежутке между ними живёт предвкушение связки. Пока
     * звучало только начало, три нажатия слышались как одно.
     *
     * Высота растёт с местом в очереди: на слух понятно, сколько уже
     * набрано, не отрывая глаз от поля.
     */
    land(detail) {
      const base = PITCH[detail && detail.element] || 320;
      const step = 1 + ((detail && detail.size) || 1) * 0.22;
      tone('square', base * step, base * step * 1.5, 0.07, 0.2);
      tone('sine', base * step * 2, base * step * 2, 0.05, 0.1);
    },
    zap(detail) {
      const base = PITCH[detail && detail.elements && detail.elements[0]] || 320;
      tone('sawtooth', base * 4, base, 0.13, 0.28);
      noise(0.08, 'highpass', 2200, 0.18);
    },
    /* Отбитая стихия: глухой шлепок и звон — ни с попаданием, ни с промахом
       это спутать нельзя, а именно тут игрок и не понимает, что произошло. */
    resist() {
      tone('square', 760, 300, 0.16, 0.26);
      noise(0.22, 'bandpass', 1300, 0.3, 5);
    },
    beamup() { tone('sawtooth', 180, 900, 0.26, 0.22); },
    beam() { tone('sawtooth', 1200, 300, 0.4, 0.4); noise(0.35, 'bandpass', 2400, 0.3, 3); },
    nova() { tone('sine', 320, 40, 0.5, 0.7); noise(0.45, 'lowpass', 1400, 0.6); },

    /* Голоса поля. Цепь трещит, пожар дышит, вода шипит — по звуку должно
       быть понятно, что случилось, даже если смотришь в другой угол. */
    chain() { noise(0.24, 'highpass', 2200, 0.5, 5); tone('square', 1500, 180, 0.2, 0.3); },
    ignite() { noise(0.5, 'lowpass', 900, 0.32, 1); tone('sawtooth', 90, 220, 0.4, 0.18); },
    doused() { noise(0.42, 'highpass', 3200, 0.3, 2); },
  };

  function sfx(name, detail) {
    if (muted || !ensure() || ctx.state !== 'running') return;
    const effect = EFFECTS[name];
    if (effect) effect(detail);
  }


  /* =======================================================
     СИНТЕЗИРОВАННЫЙ ТРЕК
     ======================================================= */

  /*
   * Планировщик смотрит вперёд на 150 мс и раскладывает ноты по точному
   * времени AudioContext. Играть по setInterval «сейчас» нельзя: таймер
   * браузера гуляет на десятки миллисекунд, и ритм разъезжается.
   */
  function startSynth(trackId) {
    stopSynth();

    const seconds = 60 / BPM / 4;

    /*
     * Трек длиной в 32 такта, а не в четыре.
     *
     * Раньше он повторялся каждые несколько секунд и оттого давил: ухо
     * успевало выучить петлю и начинало её ждать. Теперь есть гармония из
     * четырёх ступеней, которая меняется раз в четыре такта, и разделы —
     * где-то только бас, где-то с барабаном, где-то пусто. Пустые такты
     * важнее полных: тишина и делает громкое громким.
     */
    const DEGREES = [0, -3, -5, -7];           /* минорный ход вниз */
    const SECTIONS = [
      /* такты 0–7 */   { drums: false, bass: true, arp: false, pad: true },
      /* такты 8–15 */  { drums: true, bass: true, arp: false, pad: true },
      /* такты 16–23 */ { drums: true, bass: true, arp: true, pad: false },
      /* такты 24–31 */ { drums: false, bass: false, arp: true, pad: true },
    ];

    const BASS = [
      [0, 0, 7, 0, 5, 0, 3, 0],
      [0, 3, 5, 3, 7, 5, 3, 0],
    ];

    const root = [55, 49, 58, 46][trackId % 4];
    let step = 0;
    let next = ctx.currentTime + 0.06;

    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.6);
    bus.connect(musicBus);

    function note(type, frequency, at, duration, gain, filter) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, at);

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(gain, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

      if (filter) {
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.setValueAtTime(filter, at);
        low.Q.value = 6;
        osc.connect(low);
        low.connect(envelope);
      } else {
        osc.connect(envelope);
      }

      envelope.connect(bus);
      osc.start(at);
      osc.stop(at + duration + 0.05);
    }

    /* Пад держит гармонию и даёт тот воздух, которого не хватало. */
    function pad(frequency, at, duration) {
      for (const detune of [-4, 4]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(frequency, at);
        osc.detune.setValueAtTime(detune, at);

        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(0.055, at + duration * 0.4);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.setValueAtTime(900 + intensity * 1200, at);

        osc.connect(low);
        low.connect(envelope);
        envelope.connect(bus);
        osc.start(at);
        osc.stop(at + duration + 0.1);
      }
    }

    function percussion(at, kind) {
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      const envelope = ctx.createGain();
      let tail;

      if (kind === 'hat') {
        filter.type = 'highpass';
        filter.frequency.value = 8000;
        envelope.gain.setValueAtTime(0.075, at);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
        tail = 0.06;
      } else {
        filter.type = 'bandpass';
        filter.frequency.value = 1600;
        filter.Q.value = 0.7;
        envelope.gain.setValueAtTime(0.18, at);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        tail = 0.18;
      }

      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(bus);
      source.start(at);
      source.stop(at + tail);
    }

    function kick(at) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, at);
      osc.frequency.exponentialRampToValueAtTime(44, at + 0.13);

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.55, at);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);

      osc.connect(envelope);
      envelope.connect(bus);
      osc.start(at);
      osc.stop(at + 0.32);
    }

    function schedule() {
      while (next < ctx.currentTime + 0.15) {
        const inBar = step % STEP_PER_BAR;
        const bar = Math.floor(step / STEP_PER_BAR) % 32;
        const section = SECTIONS[Math.floor(bar / 8)];
        const degree = DEGREES[Math.floor(bar / 4) % DEGREES.length];
        const base = root * Math.pow(2, degree / 12);

        if (section.pad && inBar === 0) pad(base * 2, next, seconds * 14);

        if (section.drums) {
          if (inBar === 0 || inBar === 6 || inBar === 10) kick(next);
          if (inBar === 8) percussion(next, 'snare');
          if (inBar % 4 === 2) percussion(next, 'hat');
        } else if (inBar === 0) {
          kick(next);
        }

        if (section.bass && inBar % 2 === 0) {
          const line = BASS[Math.floor(bar / 8) % BASS.length];
          const semitone = line[(inBar / 2) % line.length];
          note('sawtooth', base * Math.pow(2, semitone / 12), next, seconds * 1.6, 0.26,
            420 + intensity * 1100);
        }

        /* Аркада входит только в своей части — иначе она и есть то самое давление. */
        if (section.arp && inBar % 2 === 1) {
          const shape = [12, 15, 19, 22, 19, 15];
          const semitone = shape[Math.floor(step / 1) % shape.length];
          note('square', base * 2 * Math.pow(2, semitone / 12), next, seconds * 0.8,
            0.045 + intensity * 0.05, 2600);
        }

        next += seconds;
        step += 1;
      }
    }

    const timer = setInterval(schedule, 40);
    schedule();

    synth = {
      stop() {
        clearInterval(timer);
        try {
          bus.gain.cancelScheduledValues(ctx.currentTime);
          bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
          bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        } catch (error) { /* контекст уже закрыт */ }
      },
    };
  }

  function stopSynth() {
    if (!synth) return;
    synth.stop();
    synth = null;
  }


  /* =======================================================
     ТРЕК УРОВНЯ
     ======================================================= */

  function playTrack(trackId) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;

    const entry = manifest && manifest.tracks.find((track) => track.id === trackId);

    if (entry) {
      stopSynth();
      if (!element) {
        element = new Audio();
        element.loop = true;
        element.crossOrigin = 'anonymous';
        /*
         * Манифест может пережить сами файлы: в репозитории аудио не
         * версионируется, и в свежем клоне его нет. Тишина в этом случае
         * хуже синтеза — возвращаемся к нему, а не молчим.
         */
        element.addEventListener('error', () => {
          element = null;
          startSynth(trackId || 0);
        });
        const source = ctx.createMediaElementSource(element);
        source.connect(musicBus);
      }
      const file = `music/${entry.file}`;
      if (!element.src.endsWith(entry.file)) element.src = file;
      element.play().catch(() => { /* браузер ещё не отпустил автоплей */ });
      return;
    }

    if (element) { element.pause(); }
    startSynth(trackId || 0);
  }

  function stop() {
    stopSynth();
    if (element) element.pause();
    started = false;
  }

  /* В меню трек не выключается, а глохнет — как будто дверь в зал закрыли. */
  function setMenu(inMenu) {
    if (!ctx) return;
    const target = inMenu ? 420 : 18000;
    musicFilter.frequency.setTargetAtTime(target, ctx.currentTime, 0.15);
    musicBus.gain.setTargetAtTime(inMenu ? 0.32 : 0.55, ctx.currentTime, 0.15);
  }

  function setIntensity(value) { intensity = Math.max(0, Math.min(1, value)); }

  function setMuted(value) {
    muted = value;
    try { localStorage.setItem('avto-muted', muted ? '1' : '0'); } catch (error) { /* приватный режим */ }
    if (!ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  }

  return {
    unlock, sfx, playTrack, stop, setMenu, setIntensity, setMuted,
    isMuted: () => muted,
    isPlaying: () => started,
    hasFiles: () => Boolean(manifest),
  };
}
