# myboard — local-first платформа-борда с виджетами (инфраструктурный MVP)

- **Дата:** 2026-06-16
- **Статус:** утверждён дизайн, готов к написанию плана
- **Область:** только инфраструктура («движок борды»), без проектирования конкретных виджетов

## 1. Контекст и цель

Нужно local-first веб-приложение — настраиваемая борда, на которой пользователь размещает
виджеты. Каждый виджет имеет два представления: **small** (на борде) и **large** (полноэкранное).
Виджеты должны быть **изолированы** друг от друга и от host'а.

На этом этапе проектируем и реализуем **только платформу** (host, изоляция, мост, механика
двух представлений, состояние, хранение, ошибки). Конкретные виджеты не проектируются;
для проверки инфраструктуры реализуется один тривиальный **демо-виджет**.

## 2. Границы (scope)

**Входит в MVP:**

- Борда на `react-grid-layout`: добавление/удаление/перетаскивание/ресайз инстансов; раскладка
  сохраняется локально.
- Изоляция виджета в `iframe` + типизированный мост host ↔ widget (postMessage поверх `MessageChannel`).
- Два представления: small на борде и large в полноэкранном оверлее.
- Демо-виджет, реализующий контракт моста (для проверки инфраструктуры).
- Обработка ошибок через **errore** (errors-as-values) на всех ненадёжных границах.

**Не входит в MVP (отложено):**

- KV-хранилище состояния виджета на стороне host'а (get/set через мост). Зарезервировано в протоколе,
  но не реализуется. Это же — точка, где позже можно делить состояние между small/large.
- IndexedDB (пока достаточно localStorage — структура борды это маленький JSON).
- Вынос виджетов на отдельный origin/порт для «жёсткой» изоляции (протокол к этому готов).
- Сторонние/пользовательские виджеты, каталог-маркетплейс.
- Авторизация (приложение запускается локально).
- SSR (приложение — SPA).

## 3. Стек и ключевые решения

| Решение            | Выбор                                                               | Причина                                                           |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Сборка/рантайм     | **Vite (multi-entry) + React + TypeScript**, SPA                    | local-first, без SSR                                              |
| Сетка борды        | **react-grid-layout**                                               | требование заказчика                                              |
| Логика/состояние   | **Reatom v1000** (`@reatom/core@1000`)                              | требование заказчика                                              |
| Ошибки             | **errore** (errors-as-values)                                       | требование заказчика                                              |
| Загрузка виджета   | **Подход A** — отдельная HTML-точка входа (Vite-entry) на виджет    | максимальная изоляция, чистый контракт, путь к сторонним виджетам |
| Стилизация         | **CSS-модули**                                                      | требование заказчика                                              |
| Хранилище          | **localStorage** через persist-привязку Reatom                      | структура борды — крошечный JSON; IndexedDB на будущее            |
| Расположение моста | `src/shared/widget-bridge` (общий код, не отдельный monorepo-пакет) | проще для MVP                                                     |

## 4. Архитектура

Система разбита на маленькие модули с одной ответственностью, общающиеся через явные интерфейсы.

### 4.1. Host (борда-оболочка)

- **`board-model`** (Reatom) — единственный источник правды о структуре борды.
  - Состояние: `instances: { id: string; typeId: string }[]`, `layout: RGL.Layout[]` (`{ i, x, y, w, h }` на инстанс).
  - Экшены: `addInstance(typeId)`, `removeInstance(id)`, `updateLayout(layout)`.
  - Персист в localStorage. Чистое состояние, без DOM.
  - Зависит от: `widget-registry` (дефолтный размер при добавлении), storage-утилиты.

- **`widget-registry`** — статический каталог типов виджетов.
  - Запись: `{ id, title, entry (путь к index.html), defaultSize: {w,h} }`.
  - В MVP содержит только `demo`. Чистые данные + функция поиска по `typeId`.

- **`WidgetConnection`** — host-сторона моста для одного iframe.
  - Создаёт `MessageChannel`, отдаёт один порт виджету (через `init`), второй держит у себя.
  - Типизированные `send`/`onMessage`; handshake; проверка `event.origin` и `instanceId`.
  - Все ненадёжные операции возвращают `Error | T`.
  - Зависит от: `widget-bridge` (типы сообщений).

- **`WidgetFrame`** (React) — рендерит `<iframe>` для пары (инстанс, режим).
  - Поднимает `WidgetConnection`, ждёт `ready` с таймаутом; при ошибке загрузки/таймауте показывает
    карточку «виджет сломан» + retry.
  - Пробрасывает наверх `request-fullscreen` / `request-close`.
  - Зависит от: `WidgetConnection`, `widget-registry` (URL entry).

- **`Board`** (React) — связывает `react-grid-layout` с `board-model`.
  - Рендерит `WidgetFrame` (mode=small) на каждый инстанс; тулбар «добавить из каталога»;
    кнопки удалить/развернуть на ячейке.
  - При изменении раскладки вызывает `updateLayout`.

- **`FullscreenOverlay`** (React) — оверлей полноэкранного режима.
  - Когда инстанс «развёрнут», монтирует **отдельный** `WidgetFrame` (mode=large) в оверлее.
  - Закрытие убирает оверлей и возвращает на борду.

- **`app shell`** — общий layout, монтирует `Board` и `FullscreenOverlay`, верхнеуровневый React error boundary.

### 4.2. Widget-сторона (общий SDK + демо)

- **`widget-bridge`** (`src/shared/widget-bridge`) — общий код, импортируется host'ом и виджетами.
  - Схема сообщений (discriminated unions, см. §5).
  - `createWidgetClient()` — клиентский SDK виджета: устанавливает handshake (получает `MessagePort`
    из `init`), отдаёт `onInit(cb)`, `onModeChange(cb)`, `requestFullscreen()`, `requestClose()`,
    `reportError(err)`. Возвращает результаты в стиле errore.

- **`widgets/demo/`** — минимальный виджет на React + SDK.
  - Разный контент для small и large.
  - Кнопка `requestFullscreen()`; кнопка `reportError()` — для проверки пути ошибки.
  - Используется в `widget-registry` как единственный тип.

### 4.3. Граф зависимостей (упрощённо)

```
app shell ──> Board ──> WidgetFrame ──> WidgetConnection ──┐
                 │                          │              ├─> widget-bridge (типы)
          FullscreenOverlay ──> WidgetFrame ┘              │
                 │                                          │
          board-model ──> widget-registry                  │
                                                            │
widgets/demo ──> widget-bridge (createWidgetClient) ────────┘
```

## 5. Протокол моста (postMessage поверх MessageChannel)

**Установление связи:**

1. Host создаёт `<iframe src="/widgets/<id>/index.html?mode=small&instanceId=...">`.
2. По событию `load` host создаёт `MessageChannel` и шлёт виджету `init` через `iframe.contentWindow.postMessage(initMsg, targetOrigin, [port2])`.
3. Виджет в `createWidgetClient()` слушает `message`, получает `port`, отвечает `ready` по этому порту.
4. Дальнейший обмен — только через приватный порт (нет перекрёстных помех между iframe'ами).
5. Если `ready` не пришёл за таймаут (по умолчанию **5000 мс**) → `HandshakeTimeoutError`, карточка «сломан».

**Сообщения host → widget:**

- `init { type:'init', instanceId, mode: 'small'|'large', theme? }`
- `mode-change { type:'mode-change', mode }` — зарезервировано (MVP использует отдельные iframe'ы)
- `ping { type:'ping' }`

**Сообщения widget → host:**

- `ready { type:'ready', instanceId }`
- `request-fullscreen { type:'request-fullscreen', instanceId }`
- `request-close { type:'request-close', instanceId }`
- `error { type:'error', message, name? }`
- `pong { type:'pong' }`

**Валидация:** каждое входящее сообщение проверяется по схеме; невалидный payload → значение `Error`
(`BridgeError`), не throw. Проверяются `origin` (в MVP — same-origin) и совпадение `instanceId`.

## 6. Два представления (small / large)

- На борде у инстанса — small-iframe (`?mode=small`).
- «Развернуть» → `FullscreenOverlay` монтирует **отдельный** large-iframe (`?mode=large`) со своим
  `WidgetConnection`. Отдельный инстанс — потому что перенос iframe в DOM всё равно перезагружает его;
  чище поднять свежее соединение.
- Виджет читает `mode` из `init` и рендерит соответствующее представление.
- Сообщение `mode-change` зарезервировано для будущего in-place переключения.
- Деление состояния между small и large в MVP отсутствует (появится вместе с отложенным KV-хранилищем).

## 7. Состояние и хранение

- `board-model` хранит `instances` и `layout`; всё сериализуется в один JSON-блоб в localStorage
  через persist-привязку Reatom.
- Чтение/запись/parse localStorage обёрнуты в errore (ошибки квоты/парсинга — значения, не исключения).
- Состояние виджета внутри iframe в MVP **не** персистится (KV-хранилище отложено).

## 8. Обработка ошибок (errore)

Tagged-ошибки через `createTaggedError`:

- `StorageError` — чтение/запись/parse localStorage.
- `BridgeError` — невалидный/неожиданный payload моста.
- `WidgetLoadError` — сбой загрузки iframe.
- `HandshakeTimeoutError` — виджет не прислал `ready` в срок.

Правила:

- Все ненадёжные границы возвращают `Error | T`; вызывающий проверяет `instanceof Error`.
- Сбой одного виджета изолирован в его фрейме — показывается карточка «виджет сломан» + retry,
  остальная борда работает.
- Host-рендер прикрыт верхнеуровневым React error boundary как последней линией защиты.

## 9. Стилизация

- **CSS-модули** (`*.module.css`) для всех host-компонентов и демо-виджета.
- Без UI-фреймворков и CSS-in-JS. Глобальные стили (reset, переменные темы) — отдельный
  глобальный css, остальное — локальные модули рядом с компонентами.

## 10. Тестирование (vitest)

- **Юнит:**
  - `board-model`: add/remove/updateLayout, дефолтный размер из реестра.
  - Валидация сообщений моста (валидные/невалидные payload → `Error`).
  - Пути errore (каждый tagged-error возникает в нужной ситуации).
  - Round-trip сериализации хранилища (save → load === исходное).
- **Интеграция:**
  - Handshake host ↔ widget через mock `MessageChannel`: `init` → `ready`.
  - Таймаут handshake → `HandshakeTimeoutError`.
  - Flow демо-виджета: `request-fullscreen` доходит до host'а.
- E2E (Playwright) — за рамками MVP, отметить как возможное расширение.

## 11. Структура каталогов

```
myboard/
  index.html                      # host entry
  src/
    app/                          # оболочка, error boundary, глобальные стили
    board/                        # Board + обвязка react-grid-layout
    board-model/                  # reatom-атомы/экшены + persistence
    widget-host/                  # WidgetFrame, WidgetConnection, FullscreenOverlay
    widget-registry/              # каталог типов виджетов
    shared/widget-bridge/         # протокол сообщений + createWidgetClient (SDK)
  widgets/
    demo/
      index.html                  # entry демо-виджета
      main.tsx
  vite.config.ts                  # multi-entry: host + каждый виджет
  tests/                          # (или *.test.ts рядом с модулями)
```

## 12. Открытые вопросы и развитие (после MVP)

- KV-хранилище виджета через мост (get/set), персист в localStorage/IndexedDB.
- Деление состояния между small и large через host-хранилище.
- Вынос виджетов на отдельный origin/порт → жёсткая изоляция (CSP, sandbox-атрибуты).
- Реальные виджеты и каталог; возможно, манифест виджета + загрузка сторонних.
- Тема (light/dark), прокидываемая в виджеты через `init.theme`.
- Несколько бордов/вкладок; экспорт/импорт борды в JSON.
