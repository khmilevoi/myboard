# Серверное время для F3 (Ofelia) — дополнение к спеке

- **Дата:** 2026-06-21
- **Статус:** утверждён к реализации
- **Дополняет:** [`2026-06-19-ofelia-tray-design.md`](./2026-06-19-ofelia-tray-design.md) — фича **F3** (раздел 5)
- **Виджет:** `client/widgets/ofelia-poop-duty/`
- **Новый общий код:** `client/src/shared/timer/`, эндпоинт `GET /api/time`

## 1. Обзор

В F3 действие **«Откатить» (undo)** реверсит последнее событие выбранного дня `D`.
Чтобы решить, доступен ли откат, нужно знать **«сегодня»**, и это «сегодня» должно
быть авторитетным, а не зависеть от (возможно неверных) часов устройства.

Поэтому виджет берёт «сегодня» **с сервера**. Сервер отдаёт простую апишку с текущим
временем; клиент один раз вычисляет смещение `offset = serverNow − clientNow` и дальше
выводит «сегодня» как `clientNow + offset` синхронно. Доступ к серверному времени даёт
новый общий объект `timer` (`await timer.sync()` под капотом дёргает `fetchServerTime()`),
который инжектится в модель Офелии как зависимость — по тому же DI-паттерну, что и `storage`.

### Принятые решения (из брейншторминга)

- **Объём server-time:** на серверное «сегодня» завязано **всё** определение «сегодня» в
  виджете (ротация дежурства, маркер `isToday`, дни гашения долга **и** гейт undo), а не
  только undo. Так отображение и гейт всегда консистентны.
- **Стратегия синка:** **offset + ре-синк**. Смещение считается при коннекте консьюмера;
  повторный синк — при возврате фокуса вкладки (`visibilitychange`) и повторном коннекте.
  Постоянного поллинга нет. Полночь перекатывается сама (через эл-апс клиентских часов).
- **Гейт undo:** откат доступен **только когда день `D` == серверное сегодня**. Прошлые дни
  в календаре — read-only, без отката. (Гейт по `D == today`, не по времени создания события.)
- **До первого синка:** **действия заблокированы.** Пока серверное время неизвестно,
  «сегодня» = `null`, дате-зависимые computed возвращают `null` (как уже делает
  `numberOfDebts`), UI показывает loading, кнопки действий и undo — disabled.
- **Размещение `timer`:** **общий синглтон** в `client/src/shared/timer/` + интерфейс-порт
  `ServerTime`, инжектится в модель пропсом; в тестах — фейк. (Не протягиваем через
  `WidgetRuntimeProps` — это лишний host-плампинг ради пока-одного консьюмера; при появлении
  второго консьюмера апгрейд до проброса через host — тонкий рефактор поверх этого.)

### Связанность с хранилищем (почему фоллбек не нужен)

Действия и история всё равно пишутся в `storage.shared.server` (HTTP). Значит, **если
сервер недоступен — действия/undo и так не работают**. Серверное время и серверное
хранилище связаны: блокировка действий до синка не ухудшает оффлайн-поведение (оффлайн
действия и так невозможны), а лишь гарантирует, что мы никогда не действуем по неверному
«сегодня».

## 2. Текущее состояние (что меняем)

В `client/widgets/ofelia-poop-duty/model/ofelia-duty.ts`:

```ts
function getToday(): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(Date.now())
    .toZonedDateTimeISO(DUTY_TIME_ZONE)
    .toPlainDate()
}
```

`getToday()` синхронно читает `Date.now()` (часы клиента) и используется в `startOfWeek`
(инициализация), `goToCurrentWeek`, `debtDays`, `currentWeek`. После изменения «сегодня»
выводится из `timer` и становится `PlainDate | null`.

## 3. Контракт 4.7 — ServerTime (новый шов)

Фиксируется первым; модель Офелии реализуется против него, в тестах — фейк.

```ts
// client/src/shared/timer/model/server-time.ts
export interface ServerTime {
  /** Текущий серверный момент (clientNow + offset) или null до первого синка. */
  nowMs(): number | null
  /** Серверное «сегодня» в указанной зоне или null до первого синка. */
  today(timeZone: string): Temporal.PlainDate | null
  /** Async-экшен: считает offset через fetchServerTime(); withAsync-статус. */
  readonly sync: Action<() => Promise<void>>
  /** true после первого успешного синка (offset известен). */
  readonly isSynced: Atom<boolean>
}
```

- `nowMs()`/`today()` — синхронные геттеры; пригодны для чтения в reatom-computed.
- `sync` обогащён `withAsync({ status: true })` — статус/ошибка доступны UI.
- RTT при вычислении offset **игнорируется** (`offset = serverNow − clientNow_at_response`):
  для гранулярности «день» поправка в несколько мс несущественна.

## 4. Общий код `client/src/shared/timer/`

### 4.1 `model/http-time.ts`

```ts
export type ServerTimeResponse = { now: number } // epoch ms, UTC
export function fetchServerTime(baseUrl = '/api/time'): Promise<number | TimeError>
```

- `fetch(baseUrl)` → zod-парс `{ now: number }`; ошибки — значениями (тегированный
  `TimeError` через errore, по аналогии со `StorageError`).
- Не бросает: сеть/парс-сбой возвращается как `TimeError`.

### 4.2 `model/server-time.ts` — синглтон

- `offsetMs = atom<number | null>(null)`.
- `sync = action(async () => { const res = await wrap(fetchServerTime()); if (res instanceof Error) throw res; offsetMs.set(res - Date.now()) }).extend(withAsync({ status: true }))`.
- `nowMs() = offsetMs() == null ? null : Date.now() + offsetMs()`.
- `today(zone) = nowMs() == null ? null : Instant.fromEpochMilliseconds(nowMs()).toZonedDateTimeISO(zone).toPlainDate()`.
- `isSynced = computed(() => offsetMs() != null)`.
- **Ре-синк:**
  - `withConnectHook` на внутреннем connect-атоме → `sync()` при первом и повторном коннекте
    консьюмера (виджет смонтировался/перемонтировался).
  - единый `document.addEventListener('visibilitychange', …)` → `sync()` при `visibilityState === 'visible'`.
- `getServerTime()` — ленивый app-wide инстанс (один offset на все консьюмеры).

### 4.3 `model/fakes.ts`

```ts
export function createFakeTimer(options?: {
  today?: Temporal.PlainDate | null
  nowMs?: number
}): ServerTime
```

- Контролируемые `today()`/`nowMs()`; `sync` — резолвится в no-op; `isSynced` управляем.
- Позволяет тесту задать «сегодня» детерминированно и проверить null-состояние до синка.

## 5. Изменения в модели Офелии (F3)

`model/ofelia-duty.ts`:

- Сигнатура: `ofeliaDutyModel({ storage, timer }: { storage: WidgetStorage; timer: ServerTime })`.
- `getToday()` удаляется; вводится `const today = () => timer.today(DUTY_TIME_ZONE)` →
  `PlainDate | null`.
- Текущий `startOfWeek` (не-nullable) заменяется на **override-атом**
  `startOfWeekOverride = atom<PlainDate | null>(null)` (`null` ⇒ «следовать за неделей
  сегодня»); просматриваемая неделя — производная:
  `viewWeekStart = computed(() => startOfWeekOverride() ?? (today() ? getStartOfWeek(today()!) : null))`.
  `goToPrev/Next` сдвигают override относительно `viewWeekStart`; `goToCurrentWeek` сбрасывает
  override в `null`.
- `debtDays` и `currentWeek` возвращают `null`, пока `today() == null` **или** долги ещё не
  загружены (расширение текущего `!debts → null`).
- Действия `confirmClean(date?)`, `goIntoDebt(date?)`, `forgive(date?)`, `undo(date?)`
  (default `date = selectedDate() ?? today()`): **гард** — при `today() == null` действие
  блокируется (no-op). Действия — async (`withAsync`), эмитят `HistoryEventDraft` через
  `HistoryPort` (контракт 4.5).
- `selectedDate = atom<PlainDate | null>(null)` (`null` ⇒ резолвится в `today()`), `selectDay(date)`.
- **Undo-гейт:**
  `undoAvailable = computed(() => { const t = today(); const d = selectedDate() ?? t; return t != null && d != null && d.equals(t) && hasReversibleEvent(d) })`.
  Предикат `D == today` — в скоупе F3; `hasReversibleEvent(d)` (есть откатываемое событие дня)
  подключается на стыке с историей (F4) и до тех пор может быть `true`-плейсхолдером за портом.

## 6. UI-состояния (контракт F3 → F6)

- `currentWeek() == null` ⇒ loading/skeleton вместо рендера недели.
- Кнопки действий disabled, пока `today == null` (и пока их `withAsync`-статус pending).
- Undo-аффорданс рендерится **только** при `undoAvailable()`; на прошлых выбранных днях
  отката нет.

Сам визуал тиров/состояний — фича **F6**; F3 лишь поставляет nullable/gated-состояние модели
и предикат `undoAvailable`.

## 7. Тестирование

- **server** (`server/handlers.test.ts`): `GET /api/time` отдаёт `{ now: <число> }`, статус 200.
- **shared/timer** (`client/src/shared/timer/model/server-time.test.ts`):
  - offset вычисляется из фейкового `fetchServerTime`; `today()` = `null` до синка, корректен после;
  - ре-синк по `visibilitychange`;
  - ошибка fetch ⇒ offset остаётся `null`, статус — error, `isSynced === false`.
- **ofelia model** (`…/model/ofelia-duty.test.ts`, fake `StorageApi` + `createFakeTimer`):
  - `today == null` ⇒ `currentWeek == null`, действия заблокированы;
  - `today` задан ⇒ действия меняют долг по таблице 3.2, эмитят корректные drafts;
  - undo-гейт `true` только при `D == today`; выбран прошлый день ⇒ undo-гейт `false`.

Перед PR: `pnpm test` и `pnpm typecheck`; для браузерного поведения — `pnpm test:e2e`.

## 8. Влияние на основную спеку

- Добавляется **контракт 4.7 (ServerTime)** к разделу 4 спеки ofelia-tray.
- Уточняется **F3** (раздел 5): «сегодня» выводится из `ServerTime`; модель принимает `timer`
  как зависимость; `currentWeek`/действия `null`/заблокированы до синка; undo-гейт `D == today`.
- Эндпоинт `GET /api/time` — общий, вне виджета (рядом с `/api/storage/*`).

## 9. Вне скоупа

- Проброс `timer` через `WidgetRuntimeProps`/host (понадобится при втором консьюмере; тонкий
  рефактор поверх этого дизайна).
- Точная RTT-компенсация offset (не нужна при дневной гранулярности).
- Защита от намеренной подмены клиентских часов (бытовой виджет на двоих; цель — корректность,
  а не противодействие злоумышленнику). При откате клиентских часов назад offset-вывод может
  «съехать» — приемлемо для этого контекста.
- Поллинг по таймеру (ограничиваемся ре-синком на focus/reconnect).
