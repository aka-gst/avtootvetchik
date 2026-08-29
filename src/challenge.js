/*
 * ТЕХНОМАГИЯ — вызов по ссылке.
 *
 * Единственное в этой игре, что один человек может отправить другому.
 * Этаж и так помещается в строку, поэтому к нему достаточно приписать
 * результат отправителя — и ссылка перестаёт быть «посмотри, что я
 * сделал», превращаясь в «повтори, если сможешь».
 *
 * Ни сервера, ни входа, ни таблицы рекордов здесь не нужно: всё, что
 * нужно обоим, уже лежит в адресной строке. Ссылка, отправленная год
 * назад, откроется и завтра — ровно как код этажа.
 *
 *   #l=<код этажа>&c=<ник>~<десятые секунды>~<очки>~<ранг>
 *
 * Вызов намеренно не подписан и не защищён: подделать своё же время в
 * дружеском споре можно и без нас, а лишняя криптография сделала бы
 * ссылку длиннее без единого выигранного спора.
 */

const SEPARATOR = '~';

/* Ник живёт в том же ключе, что и у остальных игр сайта. */
export const NICK_KEY = 'aka-gst-nickname';

export function cleanNick(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]/gi, '')
    .slice(0, 6);
}

export function encodeChallenge(challenge) {
  if (!challenge) return '';
  const nick = cleanNick(challenge.nick) || 'ГОСТЬ';
  const tenths = Math.max(0, Math.round((challenge.time || 0) * 10));
  const score = Math.max(0, Math.round(challenge.score || 0));
  const rank = String(challenge.rank || 'D').slice(0, 1);
  return [nick, tenths, score, rank].join(SEPARATOR);
}

export function decodeChallenge(raw) {
  if (!raw) return null;

  const parts = String(raw).split(SEPARATOR);
  if (parts.length < 4) return null;

  const [nick, tenths, score, rank] = parts;
  const time = Number(tenths) / 10;
  if (!Number.isFinite(time) || !Number.isFinite(Number(score))) return null;

  return {
    nick: cleanNick(nick) || 'ГОСТЬ',
    time,
    score: Number(score),
    rank: /^[SABCD]$/.test(rank) ? rank : 'D',
  };
}

/*
 * Разбор адреса. Порядок частей не фиксирован, потому что ссылку правят
 * руками чаще, чем кажется: её пересылают, обрезают и склеивают заново.
 */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return { code: null, challenge: null };

  const result = { code: null, challenge: null };

  for (const chunk of raw.split('&')) {
    const at = chunk.indexOf('=');
    if (at < 0) continue;
    const key = chunk.slice(0, at);
    const value = decodeURIComponent(chunk.slice(at + 1));
    if (key === 'l') result.code = value;
    if (key === 'c') result.challenge = decodeChallenge(value);
  }

  return result;
}

export function buildLink(base, code, challenge) {
  const parts = [`l=${encodeURIComponent(code)}`];
  const packed = encodeChallenge(challenge);
  if (packed) parts.push(`c=${encodeURIComponent(packed)}`);
  return `${base}#${parts.join('&')}`;
}

/*
 * Сравнение забегов. Главным считается время, а не очки: время понимают
 * оба, даже если один из них никогда не смотрел на ранги.
 */
export function compare(mine, theirs) {
  if (!theirs) return null;

  const delta = theirs.time - mine.time;
  return {
    faster: delta > 0,
    delta: Math.abs(delta),
    scoreDelta: mine.score - theirs.score,
    beaten: delta > 0,
  };
}
