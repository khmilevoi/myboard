# Виджет «Лоток Офелии» — обновление визуала под новый дизайн

- **Дата:** 2026-06-23
- **Статус:** утверждён к реализации
- **Виджет:** `client/widgets/ofelia-poop-duty/`
- **Референсы дизайна:**
  - [`assets/2026-06-23-ofelia-tray-flow.html`](./assets/2026-06-23-ofelia-tray-flow.html) — флоу виджета: тиры, состояния, контролы
  - [`assets/2026-06-23-ofelia-large.html`](./assets/2026-06-23-ofelia-large.html) — large/fullscreen layout
- **Предыдущая спека:** [`2026-06-19-ofelia-tray-design.md`](./2026-06-19-ofelia-tray-design.md)

## 1. Обзор

Виджет «Лоток Офелии» уже реализован (F1–F6 из предыдущей спеки). Новый дизайн
уточняет визуал: цвета кнопок, размеры, состояния disabled, единицы в чипах,
hint-тексты, компактные бейджи истории, расширенные комментарии (аватар + имя +
дата + IP), responsive-режим с tabs для large/fullscreen.

Объём: **полное соответствие новому дизайну**. Структура model-слоя не меняется
(кроме расширения `CommentView`). UI-слой обновляется через новые под-компоненты
и рефакторинг существующих.

### Принятые решения (из брейншторминга)

- **Объём:** полное соответствие новому дизайну — все структурные + визуальные + данные отличия.
- **«Контролы виджета»:** новый вариант кнопок (подписанные, 36px/34px) для всех тиров кроме `compact` и `tiny`. `compact` сохраняет icon-only.
- **Standard тир:** использует дизайн кнопок из секции «Контролы» (состояния A/B/C).
- **Large/fullscreen:** отдельный дизайн `OpheliaLarge` — обновляется RichLayout.
- **«Сегодня» кнопка** в week nav — остаётся.
- **Подход:** новые под-компоненты + рефакторинг существующих (не полная перезапись).

## 2. Что меняется (сводно)

| Компонент | Изменение |
|-----------|-----------|
| `ActionButtons` | разделяется на `IconButtons` + `LabeledButtons`; остаётся маршрутизатором |
| `IconButtons` | новый: color-coding (✓=фиолетовый, ⏲=серый, −=зелёный) + per-button hover |
| `LabeledButtons` | новый: подписанные кнопки 36/34px, состояния A/B/C, disabled, notes |
| `DebtChips` | единица в чипах («2 дня»), state C «баланс ровный · 0 : 0» |
| `CompactTier` | убрать `UserToggle` |
| `StandardTier` | убрать `UserToggle`, добавить hint, `LabeledButtons`, `inactive` для future |
| `RichLayout` | container queries, `MobileTabs`, primary «Подтвердить уборку», status chip без «осталось», hint с именем, `LabeledButtons` с `showNotes` |
| `HistoryList` | компактные бейджи («за К», «долг», «−1 день»), вертикальный layout |
| `CommentThread` | аватар + полное имя + дата + IP + текст; icon send-кнопка |
| `WeekStrip` | аватар 26px (с 20px) |
| `CommentView` | расширить: `authorName`, `date`, `ipTail` |
| `format.ts` | `selectedDaySubtitle` без «осталось» |

## 3. Компоненты — детальный дизайн

### 3.1 IconButtons (`ui/parts/IconButtons.tsx`)

Выносится из `ActionButtons` (compact-режим).

- 3 иконки: `Check` (✓), `Clock` (⏲), `Minus` (−)
- Color-coding через `data-tone`:
  - `confirm` → `var(--primary)` (фиолетовый), hover `var(--accent-soft)` + border `oklch(0.82 0.07 281)`
  - `debt` → `var(--text-dim)` (серый), hover `var(--secondary)`
  - `forgive` → `var(--ofelia-forgive)` (зелёный), hover `var(--ofelia-ok-soft)` + border `oklch(0.82 0.07 155)`
- `−` disabled когда `!canForgive` (opacity 0.6)
- Размеры: 26px, border-radius 7px (как сейчас)

**Новый токен:** `--ofelia-forgive: oklch(0.55 0.13 155)` в `ofelia-poop-duty.module.css`
(+ dark вариант `--ofelia-forgive: oklch(0.72 0.14 155)`).

### 3.2 LabeledButtons (`ui/parts/LabeledButtons.tsx`)

Новый компонент для `standard`/`large`/`fullscreen`.

```ts
type LabeledButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  inactive?: boolean
  primaryLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}
```

**Состояния:**

- **A (pending, `!inactive`):** primary 36px (`var(--primary)`, white, radius 9px) + secondary row 34px
  - «В долг» — `var(--text)`, border, radius 9px
  - «Простить» — `var(--ofelia-forgive)` (зелёный), border, radius 9px; disabled когда `!canForgive`
- **B (closed, `!inactive`):** plaque 36px (`var(--ofelia-ok-soft)`, `var(--ofelia-ok-fg)`, «Уборка подтверждена») + undo 36px (border, `var(--text-dim)`) + secondary row disabled (opacity 0.35)
  - Если `showNotes`: «анду · только сегодня» подпись под plaque+undo
- **C (`inactive=true`):** все кнопки disabled (opacity 0.3), primary показывает `primaryLabel`

- `primaryLabel` default: «Какашки убраны»; для large/fullscreen: «Подтвердить уборку»
- Secondary всегда рендерятся (не скрыты в B/C), disabled через opacity
- `showNotes`: «неактивны для других дней» подпись под secondary (всегда при `showNotes=true`)
- Иконки: `Check` (primary/plaque), `Undo2` (undo), `Clock` (В долг), `Minus` (Простить)

### 3.3 ActionButtons (маршрутизатор)

```tsx
if (compact) return <IconButtons {...} />
return <LabeledButtons {...} />
```

Проп `alwaysSecondary` убирается (LabeledButtons всегда показывает secondary).

### 3.4 DebtChips

- `pluralizeDays(entry.debt)` вместо `entry.debt` — показывает «2 дня» вместо «2»
- Когда `balance.every(e => e.debt === 0)`: текст «баланс ровный · 0 : 0» вместо чипов
- Аватар остаётся в чипах

### 3.5 CompactTier

- Убрать `<UserToggle>` из bottom row
- `ActionButtons compact` → `IconButtons` (color-coded)
- Остальное без изменений

### 3.6 StandardTier

- Убрать `<UserToggle>` из footer
- Добавить hint-текст перед кнопками: «Не успеваешь? Уберёт {otherPerson}, а тебе +1 день долга.»
  - `otherPerson(selected.person)` — динамическое имя другого человека
- `<ActionButtons>` → `<LabeledButtons>` (через ActionButtons без `compact`)
- `selected.isFuture` → `inactive={selected.isFuture}` (вместо `isFuture ? null : <ActionButtons>`)
- Всегда рендерить ActionButtons/LabeledButtons (не скрывать для future)

### 3.7 RichLayout (large/fullscreen)

**Responsive:**
- `container-type: inline-size` на `.root`
- `@container (max-width: 680px)`: body → column, today → full width, split → column + `MobileTabs`
- `MobileTabs` (`ui/parts/MobileTabs.tsx`): переключатель История/Комментарии
  - Tab state: `useState<'history' | 'comments'>('history')` в RichLayout
  - `data-tab` на `.split` контролирует видимость через CSS
  - Tabs видимы только ≤680px (`display: none` по умолчанию, `display: flex` в container query)

**Today panel:**
- Status chip: `selectedDaySubtitle` без «осталось» (см. 3.10)
- Аватар: 62px (через `px={62}`, был `lg`=56px)
- `LabeledButtons` с `primaryLabel="Подтвердить уборку"`, `showNotes={true}`, `inactive={selected.isFuture}`
- Hint: «Не успеваешь — сегодня уберёт {otherPerson}, а тебе запишется +1 день.»
  - `otherPerson(selected.person)` — динамическое имя

**Week nav:**
- «Сегодня» кнопка остаётся (без изменений)

**Week strip:**
- Аватар: 26px через `px={26}` (был `sm`=20px)

**Header:**
- `UserToggle` в шапке — без изменений
- Close/expand/delete — без изменений

### 3.8 HistoryList

**Новый формат записей (по OpheliaLarge):**

- Вертикальный layout: дата (mono 11px, `var(--text-3)`) → строка (аватар 20px + имя 12.5px + бейдж)
- Компактные цветные бейджи:
  - `cleaned` + `onBehalfOf` → «за {initial}» (`var(--primary)` / `var(--accent-soft)`)
  - `went_into_debt` → «долг» (`var(--primary)` / `var(--accent-soft)`)
  - `forgiven` → «−1 день» (`var(--ofelia-forgive)` / `var(--ofelia-ok-soft)`)
  - `cleaned` без `onBehalfOf` → без бейджа
  - `cancelled` → без бейджа
- `border-bottom` между записями
- Аватар 20px (tone-based, через существующий `Avatar` с size `sm` или новым размером)

### 3.9 CommentThread

**Расширение CommentView:**

```ts
type CommentView = {
  id: string
  author: Person
  authorName: string  // новое: «Карина» / «Лёша»
  date: string        // новое: «10 июн» (из ts)
  ipTail: string      // новое: хвост IP
  text: string
}
```

- `commentThread` computed в `ofelia-comments.ts`: мапить `ts` → дата («10 июн»), `ip` → хвост
- Формат даты: `{day} {month short}` — «10 июн» (как в дизайне)
- IP хвост: последние `IP_TAIL_LENGTH` символов (как в history)

**UI элемент комментария (по OpheliaLarge):**

- Аватар 22px (tone-based) + полное имя (600 12.5px) + дата (mono 10.5px, `var(--text-3)`) + IP (mono 10px, `var(--text-3)`, opacity 0.6) + текст (400 13px, `var(--text-dim)`)
- `border-bottom` между записями

**Input + send:**

- Input 36px, radius 9px, `var(--background)` bg, padding 0 12px
- Send кнопка: 36px, `var(--primary)` bg, white, `Send` icon (lucide `Send`), radius 9px
- Enter → submit (без изменений)

### 3.10 format.ts

- `selectedDaySubtitle`: убрать «осталось»
  - Было: «гасит долг · осталось 2 дня»
  - Стало: «гасит долг · 2 дня»
  - `closed` state: было «долг сокращён · осталось 2 дня» → «долг сокращён · 2 дня»

### 3.11 WeekStrip

- Аватар 26px в day cards (с 20px)
- Остальное без изменений (border, selected, today, dot)

### 3.12 Avatar — размеры

Новый дизайн использует много pixel-точных размеров аватара. Текущий `Avatar`
имеет только `sm` (20px), `md` (44px), `lg` (56px). Нужные размеры из дизайна:

| Контекст | Размер | Текущий |
|----------|--------|---------|
| Compact debt chips | 18px | sm (20px) |
| Standard debt chips | 19px | sm (20px) |
| HistoryList | 20px | sm (20px) ✅ |
| CommentThread | 22px | — (новый) |
| RichLayout balance | 24px | sm (20px) |
| WeekStrip | 26px | sm (20px) |
| Compact/Standard person | 44px | md (44px) ✅ |
| Tiny person | 56px | lg (56px) ✅ |
| RichLayout today | 62px | lg (56px) |

**Решение:** добавить проп `px?: number` в `Avatar` для pixel-точных размеров,
переопределяющий named-size. Named sizes (`sm`/`md`/`lg`) остаются для
обратной совместимости. CSS: `[data-px] { width: calc(var(--px) * 1px); ... }`.

## 4. Токены

Добавить в `ofelia-poop-duty.module.css`:

```css
.widget {
  /* существующие */
  --ofelia-forgive: oklch(0.55 0.13 155);
}

:root[data-theme='dark'] .widget {
  /* существующие */
  --ofelia-forgive: oklch(0.72 0.14 155);
}
```

## 5. Data model изменения

### 5.1 CommentView (расширение)

В `model/ofelia-comments.ts`:

```ts
export type CommentView = {
  id: string
  author: Person
  authorName: string
  date: string
  ipTail: string
  text: string
}
```

`commentThread` computed:

```ts
comments()
  .slice()
  .sort((a, b) => a.ts - b.ts)
  .map((comment) => ({
    id: comment.id,
    author: comment.author,
    authorName: comment.author, // Person — это уже полное имя («Карина»/«Лёша»)
    date: formatDateShort(comment.ts),
    ipTail: comment.ip?.slice(-IP_TAIL_LENGTH) ?? '',
    text: comment.text,
  }))
```

`formatDateShort(ts)`: `{day} {monthShort}` — «10 июн». Месяцы: `['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']`.

### 5.2 Person — полное имя

`Person = 'Леша' | 'Карина'` — уже полное имя. `authorName = comment.author` (1:1).

## 6. Тестирование

### Новые тесты

- `IconButtons.test.tsx` — `data-tone` атрибуты (confirm/debt/forgive), disabled когда `!canForgive`
- `LabeledButtons.test.tsx` — states A/B/C: primary/plaque/disabled, secondary disabled в B, all disabled в C, `primaryLabel`, `showNotes` видимость («анду», «неактивны»)
- `MobileTabs.test.tsx` — переключение tab, `data-tab` атрибут

### Обновляемые тесты

- `DebtChips.test.tsx` — единица в чипах (`pluralizeDays`), state C «баланс ровный · 0 : 0»
- `CompactTier.test.tsx` — отсутствие `UserToggle`
- `StandardTier.test.tsx` — отсутствие `UserToggle`, presence hint-текста, `LabeledButtons` (не full-size), `inactive` для future days (кнопки видны disabled, не скрыты)
- `RichLayout.test.tsx` — `primaryLabel="Подтвердить уборку"`, `showNotes`, `MobileTabs` structure, status chip без «осталось»
- `HistoryList.test.tsx` — компактные бейджи («за К», «долг», «−1 день»), вертикальный layout, `border-bottom`
- `CommentThread.test.tsx` — аватар, полное имя, дата, IP, icon send-кнопка
- `WeekStrip.test.tsx` — аватар 26px (data-size или pixel check)
- `format.test.ts` — `selectedDaySubtitle` без «осталось»
- `ofelia-comments.test.ts` — `CommentView` с `authorName`, `date`, `ipTail`

### E2E

- Существующие e2e (`client/e2e`) — проверить, что текст «Какашки убраны» (standard) и «Подтвердить уборку» (large) не ломает селекторы. Обновить testid при необходимости.

### Команды

- `pnpm test` — unit/component
- `pnpm typecheck` — TypeScript
- `pnpm test:e2e` — Playwright

## 7. Вне скоупа

- Model-слой (`ofelia-duty.ts`) — не меняется (кроме `CommentView` в `ofelia-comments.ts`)
- Storage/server — не меняется
- Тир-инфраструктура (`WidgetTier`, `resolveTier`) — не меняется
- `WidgetControls` — не меняется
- `Avatar` sizes — добавляется проп `px?: number` для pixel-точных размеров; named sizes остаются
- Бандлинг шрифтов — не меняется (существующие `--font-ui` / `--font-mono`)
