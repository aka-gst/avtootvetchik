/*
 * АВТООТВЕТЧИК — боевые демоны.
 *
 * Третий способ убивать, кроме подобранного с пола. Демон не лежит в
 * инвентаре: его набирают в очередь прямо в бою — до трёх штук, — и на
 * отпускании очередь превращается в форму удара.
 *
 * Смысл именно в очереди, а не в списке заклинаний. Набор стоит времени,
 * которое игрок проводит замедленным и на виду, и стек видно над головой:
 * заряженный человек — заметная угроза, враги на это отвечают. Один демон
 * бьёт сразу и слабо, три — сильно, но такт потерян. Длина очереди тут не
 * настройка, а ставка.
 *
 * Узоры AAA / ABA / ABC подсказаны «Битвой Стихий» — там они работают
 * в пошаговом обмене. Здесь у них другая цена и другой смысл:
 * не урон (умирают все с одного касания), а форма попадания. Поэтому
 * модуль написан заново, а не скопирован: перенос чужой семантики в
 * реальное время дал бы механику, которая выглядит как та, но врёт.
 */

export const ELEMENTS = {
  therm: { id: 'therm', name: 'ТЕРМАЛ', short: 'Т', colour: '#ff5a1f' },
  ice: { id: 'ice', name: 'ЛЁД', short: 'Л', colour: '#4de1ff' },
  surge: { id: 'surge', name: 'РАЗРЯД', short: 'Р', colour: '#ffe06b' },
};

export const ELEMENT_ORDER = ['therm', 'ice', 'surge'];

export const STACK_LIMIT = 3;

/* Столько длится набор одной стихии — и столько игрок стоит замедленным. */
export const CHARGE_STEP = 0.26;

/*
 * Формы. Урон везде один — смерть, — поэтому различаются они тем, куда
 * приходится попадание: точка, конус, линия, круг. Дальше по списку —
 * дороже по времени набора.
 */
export const FORMS = {
  spit: {
    id: 'spit', name: 'ПЛЕВОК',
    kind: 'shot', speed: 620, life: 0.3, pierce: 0, noise: 300,
    hint: 'одна стихия — быстро и близко',
  },
  bolt: {
    id: 'bolt', name: 'СГУСТОК',
    kind: 'shot', speed: 780, life: 0.5, pierce: 1, noise: 360,
    hint: 'две одинаковые — дальше и сквозь одного',
  },
  cone: {
    id: 'cone', name: 'ВЫДОХ',
    kind: 'cone', reach: 124, arc: 1.0, noise: 380,
    hint: 'две разные — короткий конус перед собой',
  },
  shard: {
    id: 'shard', name: 'ЗАЛП',
    kind: 'fan', speed: 700, life: 0.42, spread: 0.22, pierce: 0, noise: 400,
    hint: 'две одинаковые и третья — веер из трёх',
  },
  beam: {
    id: 'beam', name: 'ЛУЧ',
    kind: 'beam', windup: 0.26, range: 900, noise: 520,
    hint: 'три одинаковые — линия через всю комнату, но с замахом',
  },
  pierce: {
    id: 'pierce', name: 'ПРОБОЙ',
    kind: 'shot', speed: 640, life: 1, pierce: 99, breaks: true, noise: 460,
    hint: 'по краям одинаковые — идёт сквозь тела и стекло',
  },
  nova: {
    id: 'nova', name: 'ВСПЫШКА',
    kind: 'nova', radius: 104, noise: 500,
    hint: 'три разные — круг вокруг себя, в тесноте достанет и тебя',
  },
};

/*
 * Узор очереди. Ровно то место, что подсказала «Битва Стихий», — но здесь
 * узнаются и короткие очереди: игрок потратил время и должен получить
 * ответ, даже если набрал всего одну стихию.
 */
export function shapeOf(stack) {
  if (!stack || stack.length === 0) return null;

  const [a, b, c] = stack;

  if (stack.length === 1) return FORMS.spit;
  if (stack.length === 2) return a === b ? FORMS.bolt : FORMS.cone;

  if (a === b && b === c) return FORMS.beam;
  if (a === c && a !== b) return FORMS.pierce;
  if (a !== b && b !== c && a !== c) return FORMS.nova;

  /* AAB и ABB — не узор, но и не пустота: веер. */
  return FORMS.shard;
}

/*
 * Чем набил, тем и пробил. Форма несёт все стихии своей очереди, и щит
 * гаснет насмерть, если его тип среди них. Так «прочитать комнату»
 * значит понять, чем набивать, а не заучить круг превосходств.
 */
export function formFor(stack) {
  const form = shapeOf(stack);
  if (!form) return null;
  return { form, elements: [...new Set(stack)] };
}

export function colourOf(element) {
  return (ELEMENTS[element] || ELEMENTS.therm).colour;
}
