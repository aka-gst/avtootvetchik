/*
 * ТЕХНОМАГИЯ — счёт за забег.
 *
 * Очки тут не отчётность, а способ задать вопрос: «а быстрее и грязнее
 * можешь?». Поэтому платят не за факт убийства, а за цепочку — убийства
 * подряд множатся, пауза обнуляет множитель. Одинокая аккуратная зачистка
 * из-за угла даёт D, тот же этаж на одном дыхании — S.
 *
 * Оружия у игрока нет, поэтому считаются не выстрелы, а выпуски демонов:
 * разнообразие форм поощряется, холостой выпуск — единственное, что
 * прямо наказывается потерей бонуса.
 *
 * Модуль ничего не знает про DOM и про мир: он ест события, которые мир
 * и так порождает, и отдаёт числа. Поэтому его можно прогнать в Node.
 */

const KILL = 100;
const EXECUTION = 150;      /* добить лежачего дороже: это отдельное решение */
const CROSSFIRE = 50;       /* враг застрелил своего — заслуга косвенная */
const COMBO_WINDOW = 4;     /* столько секунд цепочка ждёт следующего убийства */
const COMBO_CAP = 8;

/* Во сколько очков оценивается один враг, если играть хорошо. */
const PAR_PER_ENEMY = 900;

const RANKS = [
  { rank: 'S', at: 1.2 },
  { rank: 'A', at: 0.95 },
  { rank: 'B', at: 0.75 },
  { rank: 'C', at: 0.55 },
  { rank: 'D', at: 0 },
];


export function createScore(level, attempts = 1) {
  const state = {
    score: 0,
    combo: 0,
    comboLeft: 0,
    maxCombo: 0,
    kills: 0,
    executions: 0,
    crossfire: 0,
    releases: 0,
    forms: new Set(),
    attempts,
  };

  /*
   * Начисление возвращается наружу, а не только копится внутри. Причина
   * не в удобстве: игрок должен узнать, что его способ засчитан, в тот
   * момент, когда способ сработал, — а не через минуту в таблице. Считать
   * же это дважды, здесь и на экране, значит однажды разойтись.
   */
  function kill(event) {
    if (event.by !== 'player') {
      state.crossfire += 1;
      state.score += CROSSFIRE;
      return { gain: CROSSFIRE, reason: 'ЧУЖИМИ РУКАМИ' };
    }

    state.combo = Math.min(COMBO_CAP, state.combo + 1);
    state.comboLeft = COMBO_WINDOW;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.kills += 1;

    if (event.execution) state.executions += 1;

    const gain = (event.execution ? EXECUTION : KILL) * state.combo;
    state.score += gain;

    /* Причина называется той же, что и в итоговой таблице: два разных
       слова за одно и то же читаются как два разных правила. */
    const reason = event.execution ? 'ДОБИВАНИЕ'
      : event.cause === 'chain' ? 'ПО ВОДЕ'
      : event.cause === 'fire' ? 'ОГНЁМ'
      : event.cause === 'fling' ? 'ТЕЛОМ'
      : 'ВЫРЕЗАН';

    return { gain, reason, combo: state.combo };
  }

  function feed(events) {
    const awards = [];

    for (const event of events) {
      if (event.type === 'kill') {
        const award = kill(event);
        if (award) awards.push({ ...award, x: event.x, y: event.y });
      } else if (event.type === 'daemon') {
        /* Считаем не выстрелы, а выпуски: у игрока нет оружия, только формы. */
        state.releases += 1;
        state.forms.add(event.form);
      }
    }

    return awards;
  }

  /*
   * Цепочка живёт по часам, а не по кадрам: на слабом телефоне кадров
   * меньше, но окно должно оставаться тем же самым.
   */
  function update(dt) {
    if (state.comboLeft <= 0) return;
    state.comboLeft -= dt;
    if (state.comboLeft <= 0) {
      state.comboLeft = 0;
      state.combo = 0;
    }
  }

  /* Норматив времени зависит от размера этажа, а не от секундомера в вакууме. */
  function par(total) {
    return 15 + total * 7;
  }

  function finish(world) {
    const lines = [];
    let total = state.score;

    const add = (label, value) => {
      if (value <= 0) return;
      lines.push({ label, value });
      total += value;
    };

    lines.push({ label: 'ЗА УБИЙСТВА', value: state.score });

    const limit = par(world.total);
    if (world.time < limit) add('БЫСТРО', Math.round((limit - world.time) * 25));

    add('РАЗНЫХ ФОРМ ' + state.forms.size, (state.forms.size - 1) * 200);
    add('МАКС. КОМБО ×' + state.maxCombo, (state.maxCombo - 1) * 150);

    /*
     * Выпущенный в пустоту демон стоил времени и шума, поэтому забег без
     * единого холостого — отдельная заслуга. Один выпуск может убить
     * нескольких, так что сравниваем счётчики, а не пары.
     */
    if (state.releases > 0 && state.kills >= state.releases) add('НИ ОДНОГО ХОЛОСТОГО', 700);
    if (state.crossfire > 0) add('ЧУЖИМИ РУКАМИ ' + state.crossfire, 0);
    if (state.attempts === 1) add('С ПЕРВОГО РАЗА', 500);

    const share = world.total ? total / (world.total * PAR_PER_ENEMY) : 0;
    const rank = RANKS.find((entry) => share >= entry.at).rank;

    return { lines, total, rank, share };
  }

  return { state, feed, update, finish };
}


/* =========================================================
   РЕКОРДЫ
   =========================================================
   Ключ — сам код уровня, свёрнутый в короткий хеш. Так рекорд
   привязан к этажу, а не к его названию: чужой этаж, пришедший
   кодом, заводит собственную строку и не спорит со встроенным.
   ========================================================= */

export function levelKey(code) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i += 1) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `avto-best-${hash.toString(36)}`;
}

export function readBest(code) {
  try {
    const raw = localStorage.getItem(levelKey(code));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

export function writeBest(code, result, time) {
  const best = readBest(code);
  if (best && best.total >= result.total) return { best, record: false };

  const fresh = { total: result.total, rank: result.rank, time };
  try {
    localStorage.setItem(levelKey(code), JSON.stringify(fresh));
  } catch (error) {
    /* приватный режим: рекорд не переживёт вкладку, но забег засчитан */
  }
  return { best: fresh, record: Boolean(best) || result.total > 0 };
}
