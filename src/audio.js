/*
 * АВТООТВЕТЧИК — звук.
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
const BPM = 126;

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

  try {
    muted = localStorage.getItem('avto-muted') === '1';
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
    musicBus.gain.value = 0.55;
    musicBus.connect(musicFilter);
    musicFilter.connect(master);

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
  };

  function sfx(name) {
    if (muted || !ensure() || ctx.state !== 'running') return;
    const effect = EFFECTS[name];
    if (effect) effect();
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
    const bassLines = [
      [0, 0, 7, 0, 5, 0, 3, 0],
      [0, 3, 5, 3, 7, 5, 3, 0],
    ];
    const root = [55, 49, 58, 46][trackId % 4];
    let step = 0;
    let next = ctx.currentTime + 0.06;

    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.2);
    bus.connect(musicBus);

    function note(type, frequency, at, duration, gain, filter) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, at);

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

      if (filter) {
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.setValueAtTime(filter, at);
        low.Q.value = 8;
        osc.connect(low);
        low.connect(envelope);
      } else {
        osc.connect(envelope);
      }

      envelope.connect(bus);
      osc.start(at);
      osc.stop(at + duration + 0.02);
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
        filter.frequency.value = 7000;
        envelope.gain.setValueAtTime(0.16, at);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
        tail = 0.07;
      } else {
        filter.type = 'bandpass';
        filter.frequency.value = 1800;
        filter.Q.value = 0.8;
        envelope.gain.setValueAtTime(0.32, at);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
        tail = 0.2;
      }

      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(bus);
      /* stop только после start: иначе узел бросает InvalidStateError и такт молчит. */
      source.start(at);
      source.stop(at + tail);
    }

    function kick(at) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.9, at);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);

      osc.connect(envelope);
      envelope.connect(bus);
      osc.start(at);
      osc.stop(at + 0.3);
    }

    function schedule() {
      while (next < ctx.currentTime + 0.15) {
        const inBar = step % STEP_PER_BAR;
        const bar = Math.floor(step / STEP_PER_BAR);
        const line = bassLines[Math.floor(bar / 4) % bassLines.length];

        if (inBar % 4 === 0) kick(next);
        if (inBar === 4 || inBar === 12) percussion(next, 'snare');
        if (inBar % 2 === 1) percussion(next, 'hat');

        if (inBar % 2 === 0) {
          const semitone = line[(inBar / 2) % line.length];
          note('sawtooth', root * Math.pow(2, semitone / 12), next, seconds * 1.7, 0.34,
            520 + intensity * 900);
        }

        /* Аркада поверх включается со второго такта — вступление должно дышать. */
        if (bar % 4 >= 1 && inBar % 2 === 1) {
          const semitone = [12, 15, 19, 22][(step / 1) % 4 | 0] || 12;
          note('square', root * 2 * Math.pow(2, semitone / 12), next, seconds * 0.9,
            0.06 + intensity * 0.07, 2400);
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
