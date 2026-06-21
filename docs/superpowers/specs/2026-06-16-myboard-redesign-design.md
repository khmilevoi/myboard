# myboard — редизайн UI: дизайн-система «Soft Clay», темы и lucide-react

- **Дата:** 2026-06-16
- **Статус:** дизайн утверждён, готов к написанию плана
- **Область:** полный визуальный редизайн host-оболочки и демо-виджета Clock; интеграция `lucide-react`; темы light/dark/system с передачей темы в виджеты через мост
- **Связанный спек:** [2026-06-16-myboard-widget-board-design.md](2026-06-16-myboard-widget-board-design.md) (инфраструктура борды — не переписывается, только расширяется протокол моста полем темы)

## 1. Контекст и цель

myboard — local-first веб-приложение: настраиваемая борда на `react-grid-layout`, на которой пользователь размещает виджеты. Каждый виджет изолирован в `iframe` и общается с host через типизированный мост (`postMessage` поверх `MessageChannel`). У виджета два представления: small (на борде) и large (полноэкранное).

Текущий UI — утилитарный черновик: захардкоженная тёмная палитра, текстовые кнопки («Add clock», «Expand», «Remove», «Close»), простые рамки. Нужно:

1. Полностью переработать дизайн в выбранном направлении **Soft Clay**.
2. Интегрировать `lucide-react` (иконки уже в зависимостях, но не используются).
3. Добавить темы **light / dark / system** и **протянуть тему в виджеты** (в протоколе моста `init.theme` уже зарезервирован).

**Направление выбрано пользователем в визуальном брейншторме:** Soft Clay — тёплая, тактильная эстетика (бумага, закруглённые «глиняные» карточки, мягкие неуморфные тени, акцент-терракота). Тёмная тема — вариант **Ink**: почти чёрная база (без коричневого), терракотовый акцент как «уголёк», шалфейно-зелёные цифры.

## 2. Границы (scope)

**Входит:**

- Дизайн-система Soft Clay на CSS-переменных (единый источник цвета/формы), две темы.
- Темы light/dark/system: состояние на Reatom, персист в localStorage, реакция на `prefers-color-scheme`, применение через `data-theme` на `<html>`.
- Передача темы в виджеты: расширение протокола моста (`init.theme` + новое сообщение `theme-change`), живое переключение без перезагрузки iframe.
- Замена текстовых контролов на иконки `lucide-react` с `aria-label`.
- Новые компоненты host: `Header` (бренд + переключатель темы + «Добавить виджет»), `ThemeToggle`, `AddWidgetMenu` (popover-каталог), `EmptyState`.
- Re-skin демо-виджета Clock под Soft Clay + реакцию на тему.
- Анимации (CSS-first), доступность (WCAG AA, фокус, Escape в оверлее, reduced-motion), состояния загрузки/ошибки.
- Тесты под изменения моста и модель темы.

**Не входит (YAGNI):**

- Новые виджеты помимо Clock (инфраструктура добавления каталога — да, новые типы — нет).
- KV-хранилище состояния виджета, IndexedDB, вынос виджетов на отдельный origin (как и в исходном спеке — отложено).
- UI-фреймворки и CSS-in-JS (остаёмся на CSS-модулях + глобальных токенах — требование заказчика).
- Motion-библиотека для React (хватает CSS + View Transitions API).
- Несколько борд/вкладок, экспорт/импорт.

## 3. Дизайн-мова «Soft Clay» и токены

Единый источник правды для цвета/формы/шрифта — CSS-переменные в **`src/shared/theme/tokens.css`**. Файл импортируют **и host, и каждый виджет** (виджеты уже импортируют код из `src/shared/...`, паттерн существует), поэтому тема и шрифты согласованы по обе стороны границы iframe. Темы переключаются атрибутом `data-theme="light" | "dark"` на `<html>`.

### 3.1. Палитра

| Токен                                  | Light (бумага)                               | Dark (Ink)                              |
| -------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `--bg`                                 | `#efe6d8`                                    | `#0d0e11`                               |
| `--bg-grad`                            | радиальный тёплый блик (`#f6efe2 → #ebe0d0`) | мягкий радиальный (`#1a1c20 → #0d0e11`) |
| `--surface` (карточка)                 | `#faf5ec`                                    | `#1b1d22`                               |
| `--surface-inset` (сегменты/поля)      | `#e4d8c5`                                    | `#15161a`                               |
| `--text`                               | `#463726`                                    | `#e9e4d9`                               |
| `--text-dim`                           | приглушённый коричнево-серый                 | приглушённый тёплый серый               |
| `--accent` (терракота)                 | `#cf7b53`                                    | `#e08a5f`                               |
| `--accent-2` (шалфей, цифры)           | `#3f5d4a`                                    | `#a3c79a`                               |
| `--shadow-dark`                        | `#d8c9b2`                                    | `#0a0b0d`                               |
| `--shadow-light`                       | `#fffdf6`                                    | `#24262d`                               |
| `--border` (тонкая граница, где нужна) | полупрозрачный тёплый                        | полупрозрачный светлый                  |

Точные значения уточняются при имплементации в пределах подтверждённого визуального направления; контраст текста/иконок проверяется под WCAG AA (см. §7).

### 3.2. Форма и тени (неуморфизм)

- Радиусы: `--radius-sm: 8px`, `--radius-md: 16px`, `--radius-lg: 18px`, `--radius-xl: 22px`, `--radius-pill: 999px`.
- Композитные тени:
  - `--shadow-raised: 5px 5px 13px var(--shadow-dark), -5px -5px 13px var(--shadow-light)` — приподнятая «глиняная» поверхность.
  - `--shadow-pressed: inset 2px 2px 5px var(--shadow-dark), inset -2px -2px 5px var(--shadow-light)` — утопленные элементы (вдавленные сегменты, поля).
  - `--shadow-accent: 0 4px 14px rgba(<accent>, .28)` — для акцентной кнопки.
- Неуморфизм применяется аккуратно: на тёмной (Ink) теме эффект тоньше, дополняется мягким `--border` и/или свечением акцента, чтобы карточки читались.

### 3.3. Типографика

- `--font-display`: **Fraunces** (variable, мягкий serif) — крупные цифры, бренд, акцентные числа.
- `--font-ui`: **Nunito** (variable, округлый) — весь UI-текст и лейблы.
- Шрифты **self-hosted** (local-first, без CDN): зависимости `@fontsource-variable/fraunces`, `@fontsource-variable/nunito`, импорт в `tokens.css`.

## 4. Архитектура темы (host)

Тема — отдельная вертикаль, не смешивается с `board-model`.

### 4.1. Типы

`src/shared/theme/types.ts`:

- `type ThemeMode = 'light' | 'dark' | 'system'` — пользовательское предпочтение.
- `type ResolvedTheme = 'light' | 'dark'` — вычисленная тема, которая реально применяется и уходит в виджеты.

Лежат в `shared/theme`, потому что их использует и host-модель, и протокол моста (`widget-bridge`). Это исключает циклическую зависимость: `widget-bridge` импортирует только `ResolvedTheme` из `shared/theme/types`.

### 4.2. Reatom-модель

`src/theme/theme-model.ts`:

- `themeMode = atom<ThemeMode>('system', 'theme.mode')` — персистится в localStorage.
- `systemPrefersDark = atom<boolean>(..., 'theme.systemPrefersDark')` — инициализируется из `matchMedia('(prefers-color-scheme: dark)').matches`; слушатель `change` обновляет атом.
- `resolvedTheme` — computed: `mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode`.
- `setThemeMode(mode)` — action, ставит `themeMode`.
- `effect`: применяет `document.documentElement.dataset.theme = resolvedTheme()`.
- `initTheme()` — action: грузит сохранённый режим из storage, ставит начальный `data-theme` (вызывается из `main.tsx` рядом с `initBoard()`).

`src/theme/theme-storage.ts`: чтение/запись `themeMode` в localStorage, обёрнуто в **errore** (как `board-storage`): ошибки квоты/парсинга — значения `StorageError`, не исключения. Невалидное сохранённое значение → фолбэк `'system'`.

### 4.3. Переключатель темы

`src/app/ThemeToggle.tsx` (+ `.module.css`):

- Сегментированный контрол на 3 кнопки: `Sun` (light), `Moon` (dark), `Monitor` (system) — иконки lucide.
- Семантика: группа `role="group"` (или radiogroup) с `aria-label="Тема"`; активная кнопка — `aria-pressed="true"`.
- Анимация «таблетки» под активным сегментом (CSS), `--shadow-pressed` на дорожке.

## 5. Тема внутри виджетов (расширение моста)

**Выбран Подход A** — живое сообщение `theme-change`, без перезагрузки iframe (мгновенная смена темы, без потери состояния виджета). Подход B (только `init` + reload iframe) отклонён из-за мигания и потери состояния; подход C (CSS-наследование от host) невозможен через границу iframe.

### 5.1. Изменения протокола (`src/shared/widget-bridge`)

`messages.ts`:

- Импорт `ResolvedTheme` из `shared/theme/types`.
- `InitMessage` → `{ type:'init'; instanceId; mode; theme: ResolvedTheme }`.
- Новое: `ThemeChangeMessage = { type:'theme-change'; theme: ResolvedTheme }`.
- `HostMessage` включает `ThemeChangeMessage`.

`parse.ts` (`parseHostMessage`):

- В ветке `init`: валидировать `theme` (`'light' | 'dark'`); невалид → `BridgeError`. Для обратной совместимости допускается отсутствие `theme` с фолбэком на `'light'` (решение зафиксировать в тесте).
- Новая ветка `theme-change`: валидировать `theme`; невалид → `BridgeError`.

`client.ts` (`WidgetClient`):

- Добавить поле `theme: ResolvedTheme` (из `init`).
- Добавить `onThemeChange(cb: (t: ResolvedTheme) => void): () => void` — рядом с существующим `onModeChange`.
- В `port.onmessage`: обрабатывать `theme-change`, оповещая слушателей.

### 5.2. Изменения host-стороны

`widget-connection.ts`:

- `CreateWidgetConnectionOptions` получает `theme: ResolvedTheme`; `init` формируется с темой.

`WidgetFrame.tsx`:

- Передаёт текущую `resolvedTheme()` при создании соединения (в `init`).
- **Отдельный** эффект подписывается на атом `resolvedTheme` и шлёт `connection.send({ type:'theme-change', theme })`, **не** пересоздавая соединение (тема не входит в зависимости основного эффекта, чтобы не перезагружать iframe). Ссылка на текущее соединение хранится в ref.

### 5.3. Виджет-сторона

- Виджет импортирует `tokens.css` и ставит `document.documentElement.dataset.theme` из `client.theme`, далее обновляет по `onThemeChange`.
- `widgets/clock`: использует токены и `--font-display` для времени; реагирует на смену темы вместе с host.

## 6. Компоненты и lucide-react

`lucide-react@1.19.0` уже в зависимостях. Текстовые контролы заменяются иконками (с `aria-label`):

| Сейчас            | Станет                                       |
| ----------------- | -------------------------------------------- |
| «Add clock»       | `Plus` + «Добавить виджет» → `AddWidgetMenu` |
| «Expand»          | `Maximize2` (на ховере шапки карточки)       |
| «Remove»          | `X` (на ховере шапки карточки)               |
| «Close» (оверлей) | `X`                                          |
| «Retry» (ошибка)  | `RotateCw`                                   |
| drag-ручка        | `GripVertical`                               |
| бренд             | `LayoutGrid` (мини-логотип)                  |
| ошибка            | `AlertTriangle`                              |

- **Header** (`src/app/Header.tsx`): бренд + `ThemeToggle` + кнопка «Добавить виджет». Забирает тулбар из `Board` (тулбар разрастается — выносим в shell). `App` рендерит `Header` над `Board`.
- **Карточка виджета** (`Board.module.css`): `--surface`, `--shadow-raised`, подъём на ховере; шапка с лейблом и контролами `Maximize2`/`X`, проявляющимися на ховере/фокусе; drag-ручка `GripVertical` остаётся drag-handle для RGL.
- **AddWidgetMenu** (`src/board/AddWidgetMenu.tsx`): popover со списком типов из `widget-registry`. Нативный **Popover API** + CSS **anchor positioning** с фолбэком на абсолютное позиционирование. Каждая строка — иконка (см. ниже) + `title`.
- **widget-registry** (`registry.ts`): к `WidgetType` добавить поле `icon: string` (имя иконки lucide, напр. `'Clock'`); рендер строки меню резолвит иконку по имени. Clock получает `icon: 'Clock'`.
- **EmptyState** (`src/board/EmptyState.tsx`): когда инстансов нет — дружелюбный экран «Добавьте первый виджет» с иконкой и кнопкой.
- **Re-skin Clock** (`widgets/clock/Clock.tsx`, `clock.module.css`): small — крупное время (`Fraunces`) на глиняной плашке (клик → fullscreen); large — время + дата по центру, `X` для закрытия.

## 7. Анимации, доступность, состояния

### 7.1. Анимации (CSS-first)

- **Появление борды:** карточки каскадом (fade + подъём) через `animation-delay` от индекса (CSS-переменная `--i`).
- **Смена темы:** мягкий кросс-фейд токенов (`transition` цвета/тени). Прогрессивное улучшение — **View Transitions API** (`document.startViewTransition`): круговое раскрытие новой темы из точки клика по тумблеру; фолбэк на обычный transition.
- **Микро:** подъём карточки на ховере, нажатие кнопок, проявление контролов шапки, «таблетка» в `ThemeToggle`.

### 7.2. Доступность (WCAG AA)

- Иконочные кнопки — `aria-label`; `ThemeToggle` — группа с `aria-pressed`.
- Контраст текста/иконок на глиняных поверхностях ≥ AA (токены с запасом; неуморфизм не должен ронять читаемость).
- Видимые focus-ring акцентным цветом на всех интерактивных элементах.
- **FullscreenOverlay:** закрытие по `Escape` + возврат фокуса на триггер (добавляется — сейчас нет).
- `system`-тема следует за `prefers-color-scheme`; все нетривиальные анимации отключаются при `prefers-reduced-motion: reduce`.

### 7.3. Состояния загрузки/ошибки

- **Загрузка** (`status:'connecting'`): мягкий скелетон/пульс на глиняной плашке (сейчас визуала нет).
- **Ошибка/таймаут:** карточка «виджет сломан» в стиле Soft Clay, `AlertTriangle` + `RotateCw` retry. Логика errore не меняется — только вид.

## 8. Тестирование (vitest)

- `shared/widget-bridge/parse.test.ts`: `init.theme` (валид/невалид/отсутствует→фолбэк), `theme-change` (валид/невалид → `BridgeError`).
- `shared/widget-bridge/client.test.ts`: `theme` из `init`; `onThemeChange` доставляет тему; отписка работает.
- `theme/theme-model.test.ts`: `resolvedTheme` (light/dark/system × `prefers-color-scheme`), реакция на смену системной темы, round-trip персиста (`save → load === исходное`), фолбэк при битом значении.
- `tests/bridge-handshake.test.ts`: `init` несёт `theme`; после handshake `theme-change` доходит до клиента и триггерит `onThemeChange`.
- Правка существующих тестов под новую форму `init` (везде, где конструируется/проверяется `init`).

## 9. Структура файлов

```
src/
  shared/theme/
    types.ts                 # ThemeMode, ResolvedTheme
    tokens.css               # CSS-переменные обеих тем + @fontsource (host + виджеты)
  theme/
    theme-model.ts           # Reatom: themeMode, systemPrefersDark, resolvedTheme, init, apply-effect
    theme-storage.ts         # localStorage через errore
    theme-model.test.ts
  app/
    Header.tsx (+ .module.css)
    ThemeToggle.tsx (+ .module.css)
    App.tsx                  # рендерит Header + Board + FullscreenOverlay (правка)
    main.tsx                 # initTheme() рядом с initBoard() (правка)
    global.css               # импорт tokens.css, reset, transitions (правка)
  board/
    AddWidgetMenu.tsx (+ .module.css)
    EmptyState.tsx (+ .module.css)
    Board.tsx (+ Board.module.css)   # тулбар вынесен в Header; re-skin (правка)
  widget-host/
    WidgetFrame.tsx (+ .module.css)  # отправка темы; re-skin состояний (правка)
    widget-connection.ts             # theme в init (правка)
    FullscreenOverlay.tsx (+ .module.css)  # Escape/фокус; re-skin (правка)
  shared/widget-bridge/
    messages.ts, parse.ts, client.ts # расширение протокола темой (правка)
  widget-registry/
    registry.ts                       # поле icon (правка)
widgets/clock/
  Clock.tsx, clock.module.css, main.tsx # re-skin + применение темы (правка)
package.json                          # +@fontsource-variable/{fraunces,nunito} (правка)
```

## 10. Ключевые решения и принципы

- **Тема в виджеты — живым сообщением `theme-change`** (без reload): мгновенно, без потери состояния; протокол расширяется минимально и по форме обратносовместимо.
- **Единый `tokens.css`** для host и виджетов — согласованность по обе стороны iframe, один источник цвета.
- **Тема — отдельная вертикаль** (`theme-model`/`theme-storage`), не смешана с `board-model`.
- **CSS-first анимации + View Transitions API** вместо тяжёлых зависимостей — в духе local-first.
- **Self-hosted шрифты** — без сетевых зависимостей.
- **errore** на всех ненадёжных границах (persist темы, парсинг моста) — как в текущей кодовой базе.
- **Доступность как часть работы** (фокус, Escape, контраст, reduced-motion), а не как надстройка задним числом.

## 11. Открытые вопросы / на будущее

- Тонкая настройка точных hex-значений токенов при имплементации (в рамках утверждённого направления).
- Реальные виджеты и расширение каталога `AddWidgetMenu` (поле `icon` уже готовит почву).
- Передача темы дальше — при выносе виджетов на отдельный origin протокол уже несёт `theme`.
