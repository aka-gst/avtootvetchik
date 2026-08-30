# ТЕХНОМАГИЯ — задание на звук

Задание самодостаточное. Промты по-английски — так генераторы точнее понимают
жанровые термины; пояснения и правила по-русски. У музыки два вида промта:
**строка стиля** для Suno и **развёрнутое описание** для ElevenLabs Music или
Stable Audio. Брать один из двух.

## Что за игра

Экшен про техно-магов в ночном кибер-парке, **вид сверху**. С одного касания
умирают все, включая игрока; проигрыш стоит полсекунды и начинается заново.

Изометрию пробовали и убрали: объём она давала, но забирала читаемость поля, а
здесь всё решается по клеткам — где лужа, докуда достанет цепь, попадёт ли
конус. От неё остались палитра и маги, поменялась только точка обзора.

Оружия у мага нет вовсе. Есть **очередь из трёх стихий** и две независимые оси:
**состав решает вещество** — что прилетело, **порядок решает форму** — куда
прилетело. Вещество не исчезает после попадания: лужа, пожар, лёд и грязь
остаются на полу и встречаются со следующим заклинанием. Разряд идёт по воде
и не разбирает своих.

Из этого следует главное требование к звуку: **вещества должны узнаваться на
слух и звучать по-разному, когда встречаются друг с другом**. Игрок бросает
воду, потом разряд — и звук должен подтвердить, что произошла не просто вторая
атака, а реакция.

## Главное: место под музыку уже готово

`src/audio.js` при старте сам запрашивает `music/manifest.json` и, если файл
есть, играет треки вместо синтеза. Кода писать не нужно — только разложить
файлы. Но синтез, который они заменят, уже отлажен под игру, и трек должен
занять его место точно:

- **Темп 108 ударов в минуту**, движок считает шаг как `60 / 108 / 4`.
- **Круг на 32 такта**, разбитый на четыре раздела по восемь, с гармонией из
  четырёх ступеней.
- **Разделы, где барабана нет вовсе.** Это записано в устройстве встроенного
  трека и проверено на слух: пустые такты важнее полных, короткая петля с
  барабаном в каждом такте давит через минуту, даже если сама по себе приятная.
- **Ровная громкость.** Напряжение движок поднимает сам через `setIntensity`,
  а в меню приглушает музыку. Трек с собственным нарастанием будет с этим
  драться.
- **Никаких пауз в начале и конце файла.**

Формат манифеста:

```json
{
  "tracks": [
    { "id": 0, "title": "Парк", "file": "floor-1.mp3" }
  ]
}
```

## Правила выдачи

- **Музыка:** MP3, 128–160 kbps, 60–120 секунд, бесшовная петля по такту,
  108 BPM, без вокала.
- **Звуки:** WAV 44.1 кГц, короткие, без хвоста тишины, пик −3 дБ.
- **Вес:** каталог `music/` выкладывается вместе с игрой.
- **Права:** файлы уезжают на публичный сайт.
- Один промт — один файл.

---

# Музыка

## 1. `music/floor-1.mp3` — ночной парк

Городская магия под открытым небом: синтезаторы, но не боевые. Игрок здесь
думает, какую очередь собрать, поэтому трек должен быть просторным.

```
melodic techno, 108 BPM, D minor, warm analog pads, sparse plucked arpeggio,
deep sub bass, bars without drums, no vocals, loopable, nocturnal, spacious
```

Развёрнутое описание:

```
A spacious melodic techno loop for a top-down night-time action game.
Exactly 108 BPM, D minor, a four-chord progression. Warm analog pads, a sparse
plucked arpeggio and a deep sub bass. Structure is 32 bars in four sections of
eight, and at least one full section must have no drums at all — the empty
bars are what keep the loop bearable over a long session. One constant
intensity throughout: no build-up, no drop. No vocals. Seamless loop with no
silence at either end.
```

## 2. `music/floor-2.mp3` — глубже в парк

```
dark melodic techno, 108 BPM, D minor, detuned pads, driving bassline,
metallic percussion, bars without drums, no vocals, loopable, tense
```

Развёрнутое описание:

```
A darker melodic techno loop for a later level of the same game. Exactly
108 BPM, D minor so it follows the first track cleanly. Detuned pads, a
driving bassline and dry metallic percussion; the arpeggio from the first
track returns lower and slower. 32 bars in four sections, at least one with
no drums. Constant intensity, no build-up, no vocals. Seamless loop.
```

## 3. `music/menu.mp3`

```
ambient techno intro, 108 BPM, D minor, filtered pad, no drums, distant
electricity, no vocals, loopable, waiting
```

---

# Звуки

Это половина задания и самая интересная его часть: у стихий здесь не эффекты,
а **вещества**, и звук должен объяснять правила без текста.

Сейчас синтезируется в `src/audio.js` через `sfx()` — готовые имена там
`pickup`, `spot`, `ui`.

## Вещества — четыре голоса

Каждое вещество звучит дважды: в полёте и на полу. Лужа, пожар, лёд и грязь
остаются лежать, и у лежащего вещества должен быть свой негромкий голос,
который игрок слышит и помнит, где что.

`sfx/cast-water.wav` / `sfx/pool-water.wav`

```
Water spell cast, 0.35 seconds. A pressurised liquid surge released and
splashing onto stone. Cold, clean, no reverb. Mono.
```

```
Shallow water pool ambience, 2 seconds, seamless loop. Very quiet lapping and
trickling, no impact. Must be soft enough to sit under gameplay unnoticed
until the player listens for it. Mono.
```

`sfx/cast-fire.wav` / `sfx/pool-fire.wav`

```
Fire spell cast, 0.35 seconds. A short whoosh igniting into a dry roaring
burst. Close, dry, no reverb. Mono.
```

```
Burning ground ambience, 2 seconds, seamless loop. Quiet crackling of flames
with a faint low roar. Steady, no flare-ups. Mono.
```

`sfx/cast-ice.wav` / `sfx/pool-ice.wav`

```
Ice spell cast, 0.4 seconds. A sharp freezing crackle spreading outward, with
a bright glassy edge and a low compression underneath. Cold and clean. Mono.
```

```
Ice sheet ambience, 2 seconds, seamless loop. Faint glassy settling and
occasional small cracks. Very quiet. Mono.
```

`sfx/cast-mud.wav` / `sfx/pool-mud.wav`

```
Mud spell cast, 0.35 seconds. A thick wet slap of heavy sludge landing. Dull,
low, no bright content. Mono.
```

```
Mud ambience, 2 seconds, seamless loop. Slow thick bubbling, very quiet and
low. Mono.
```

## Разряд — особый случай

Разряд идёт по воде и не разбирает своих. Это единственное правило игры,
которое убивает игрока за его же удачную комбинацию, и звук обязан
предупреждать за долю секунды до урона.

`sfx/cast-spark.wav`

```
Electric discharge cast, 0.3 seconds. A hard crackling zap with a bright
snapping attack. Dry, close, no reverb. Mono.
```

`sfx/spark-conduct.wav` — разряд пошёл по луже.

```
Electricity spreading through water, 0.6 seconds. A rising buzzing crackle
travelling outward, with a wet edge to it. Must clearly read as spreading
rather than striking — the sound is a warning that the current is coming.
Mono.
```

## Реакции веществ

Три коротких звука на стык. Их задача — подтвердить игроку, что произошла
реакция, а не второй удар.

`sfx/react-steam.wav` — огонь встретил воду.

```
Water hitting fire, 0.5 seconds. A violent hiss of steam bursting and fading.
Bright, wet, no reverb. Mono.
```

`sfx/react-freeze.wav` — лёд встретил воду.

```
Water freezing instantly, 0.5 seconds. A fast glassy crackle spreading with a
low compression underneath, ending in a solid settle. Mono.
```

`sfx/react-quench.wav` — грязь погасила огонь.

```
Fire being smothered by mud, 0.5 seconds. A wet heavy slap cutting off a
crackle, ending in a dull hiss. Mono.
```

## Бой и мир

`sfx/death.wav` — с одного касания умирают все.

```
Instant death cue for a fast arcade game, 0.3 seconds. A short low impact with
a downward pitch collapse and a faint electrical crackle. Blunt, no drama — it
plays dozens of times per minute. Mono.
```

`sfx/enemy-death.wav`

```
Techno-mage enemy dissolving, 0.4 seconds. A wet impact followed by a short
electrical discharge and a descending synth collapse. Dry, close. Mono.
```

`sfx/spot.wav` — противник заметил игрока.

```
Enemy detection cue, 0.4 seconds. Two sharp ascending electronic tones with a
faint electrical buzz. Cuts through music, dry, no reverb. Mono.
```

`sfx/pickup.wav`

```
Magic element pickup, 0.25 seconds. A bright warm synth blip with a short
shimmer. Clean and rewarding. Mono.
```

`sfx/queue-add.wav` и `sfx/queue-fire.wav` — набор очереди и её пуск. Очередь
из трёх стихий — центр всей игры, и на слух должно быть понятно, сколько
набрано, не глядя на панель.

```
UI tick for adding an element to a spell queue, 0.1 seconds. A short warm
synth blip. Generate three versions rising in pitch, so that the first,
second and third element of the queue sound progressively higher. Mono.
```

```
Spell queue release, 0.2 seconds. A short descending synth sweep with a soft
whoosh, clearly marking the moment the queue empties. Mono.
```

`sfx/step.wav` — 3–4 варианта.

```
Single footstep on park pavement, 0.09 seconds. Dry, soft, quiet. Mono.
```

---

# Что делать с готовыми файлами

1. Положить треки в `music/`, скопировать манифест и вписать их:

   ```sh
   cp music/manifest.example.json music/manifest.json
   ```

2. Больше ничего не трогать — `src/audio.js` подхватит манифест сам.
3. Звуки положить в `assets/sfx/`, приёмник для них ещё нужно дописать.
4. Начинать стоит с четырёх `cast-*` и `spark-conduct`: они объясняют правила
   игры, а всё остальное только сопровождает.
5. Нормализовать треки между собой: игра их не выравнивает.
