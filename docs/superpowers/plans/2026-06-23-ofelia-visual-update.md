# Ofelia Visual Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Ofelia poop-duty widget UI to match the new design references (tray-flow + OpheliaLarge).

**Architecture:** New sub-components (IconButtons, LabeledButtons, MobileTabs) + refactoring existing components. Model layer unchanged except CommentView expansion. All changes within `client/widgets/ofelia-poop-duty/`.

**Tech Stack:** React, Reatom, CSS Modules, Vitest, Testing Library, lucide-react.

## Global Constraints

- All exported React function components must use `reatomMemo` from `@/shared/reatom/reatom-memo`
- TypeScript ESM imports, 2-space indent, single quotes, no semicolons, named exports
- CSS Modules named `*.module.css`
- Test files: `*.test.tsx` / `*.test.ts`, colocated with code
- Run `pnpm test` and `pnpm typecheck` before committing
- Design references: `docs/superpowers/specs/assets/2026-06-23-ofelia-tray-flow.html` and `2026-06-23-ofelia-large.html`
- Spec: `docs/superpowers/specs/2026-06-23-ofelia-visual-update-design.md`

---

## File Structure

**New files:**

- `ui/parts/IconButtons.tsx` + `.module.css` + `.test.tsx` — compact icon-only action buttons with color-coding
- `ui/parts/LabeledButtons.tsx` + `.module.css` + `.test.tsx` — labeled action buttons (36/34px) with A/B/C states
- `ui/parts/MobileTabs.tsx` + `.module.css` + `.test.tsx` — history/comments tab switcher for narrow RichLayout

**Modified files:**

- `ui/parts/Avatar.tsx` + `.module.css` + `.test.tsx` — add `px` prop
- `ui/format.ts` + `.test.ts` — `selectedDaySubtitle` without "осталось", add `formatDateShort`
- `model/ofelia-comments.ts` + `.test.ts` — expand `CommentView` with `authorName`, `date`, `ipTail`
- `ui/parts/ActionButtons.tsx` + `.module.css` + `.test.tsx` — refactor as router
- `ui/parts/DebtChips.tsx` + `.module.css` + `.test.tsx` — pluralized units, state C
- `ui/tiers/CompactTier.tsx` — remove UserToggle
- `ui/tiers/StandardTier.tsx` + `.module.css` + `.test.tsx` — remove UserToggle, add hint, LabeledButtons, inactive
- `ui/parts/HistoryList.tsx` + `.module.css` + `.test.tsx` — compact badges, vertical layout
- `ui/parts/CommentThread.tsx` + `.module.css` + `.test.tsx` — avatar + name + date + IP, icon send
- `ui/parts/WeekStrip.tsx` + `.test.tsx` — avatar 26px
- `ui/parts/RichLayout.tsx` + `.module.css` + `.test.tsx` — container queries, MobileTabs, LabeledButtons, hint, avatar 62px
- `ui/ofelia-poop-duty.module.css` — `--ofelia-forgive` token

---

### Task 1: Avatar `px` prop

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.module.css`
- Test: `client/widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx`

**Interfaces:**

- Produces: `Avatar` accepts `px?: number` prop; when set, overrides named size with exact pixel dimensions via `style` + `data-px` attribute.

- [ ] **Step 1: Write the failing test**

```tsx
// Append to Avatar.test.tsx
it('renders with exact pixel size via px prop', () => {
  const { container } = render(<Avatar person="Карина" px={26} />)
  const avatar = container.querySelector('[data-tone="k"]')!
  expect(avatar).toHaveStyle({ width: '26px', height: '26px' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx`
Expected: FAIL — `px` prop not implemented.

- [ ] **Step 3: Implement the `px` prop**

```tsx
// Avatar.tsx — add px prop
export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
  px?: number
}

export const Avatar = reatomMemo<AvatarProps>(({ person, size = 'md', px }) => {
  const style = px ? { width: `${px}px`, height: `${px}px`, fontSize: `${px * 0.4}px` } : undefined
  return (
    <span
      className={styles.avatar}
      data-tone={personTone(person)}
      data-size={size}
      style={style}
      aria-hidden
    >
      {personInitial(person)}
    </span>
  )
}, 'Avatar')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/Avatar.tsx client/widgets/ofelia-poop-duty/ui/parts/Avatar.test.tsx
git commit -m "feat(ofelia): add px prop to Avatar for pixel-precise sizes"
```

---

### Task 2: format.ts — selectedDaySubtitle + formatDateShort

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/format.ts`
- Test: `client/widgets/ofelia-poop-duty/ui/format.test.ts`

**Interfaces:**

- Produces: `selectedDaySubtitle` returns "гасит долг · 2 дня" (no "осталось"). `formatDateShort(ts: number): string` returns "10 июн".

- [ ] **Step 1: Write the failing tests**

```ts
// Append to format.test.ts
describe('selectedDaySubtitle (updated)', () => {
  const noDebt = [
    { person: 'Карина', debt: 0, over: false },
    { person: 'Леша', debt: 0, over: false },
  ] as DebtBalanceEntry[]

  it('omits "осталось" in the debt-day subtitle', () => {
    const selected = { isDebtDay: true, status: 'pending', debtRemaining: 2 } as SelectedDayView
    expect(selectedDaySubtitle(selected, noDebt)).toBe('гасит долг · 2 дня')
  })

  it('omits "осталось" in the closed debt-day subtitle', () => {
    const selected = { isDebtDay: true, status: 'closed', debtRemaining: 1 } as SelectedDayView
    expect(selectedDaySubtitle(selected, noDebt)).toBe('долг сокращён · 1 день')
  })
})

describe('formatDateShort', () => {
  it('formats a timestamp as "day monthShort"', () => {
    // 2026-06-10T12:00:00Z → "10 июн"
    const ts = new Date(2026, 5, 10, 12, 0, 0).getTime()
    expect(formatDateShort(ts)).toBe('10 июн')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/format.test.ts`
Expected: FAIL — `formatDateShort` not defined, subtitle still has "осталось".

- [ ] **Step 3: Implement the changes**

```ts
// format.ts — update selectedDaySubtitle
export function selectedDaySubtitle(
  selected: SelectedDayView,
  balance: DebtBalanceEntry[],
): string {
  if (selected.isDebtDay) {
    const lead = selected.status === 'closed' ? 'долг сокращён' : 'гасит долг'
    return `${lead} · ${pluralizeDays(selected.debtRemaining)}`
  }

  const noDebt = balance.every((entry) => entry.debt === 0)
  return noDebt ? 'по очереди · долгов нет' : 'по очереди'
}

// Add formatDateShort
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const

export function formatDateShort(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/format.ts client/widgets/ofelia-poop-duty/ui/format.test.ts
git commit -m "feat(ofelia): remove 'осталось' from subtitle, add formatDateShort"
```

---

### Task 3: CommentView expansion

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/model/ofelia-comments.ts`
- Test: `client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`

**Interfaces:**

- Produces: `CommentView` type now includes `authorName: string`, `date: string`, `ipTail: string`. `commentThread` computed maps these fields.
- Consumes: `formatDateShort` from `ui/format.ts`, `IP_TAIL_LENGTH` from `model/ofelia-duty.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// Append to ofelia-comments.test.ts
describe('commentThread view', () => {
  it('maps authorName, date, and ipTail from raw comments', () => {
    // Use the existing model factory with a fake storage that has one comment
    // Verify commentThread() returns { authorName: 'Карина', date: '...', ipTail: '...' }
    // (exact test depends on existing test setup patterns in this file)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`
Expected: FAIL — `authorName`, `date`, `ipTail` not in CommentView.

- [ ] **Step 3: Implement the expansion**

```ts
// ofelia-comments.ts — update CommentView
export type CommentView = {
  id: string
  author: Person
  authorName: string
  date: string
  ipTail: string
  text: string
}

// Update commentThread computed
import { formatDateShort } from '../ui/format'
import { IP_TAIL_LENGTH } from './ofelia-duty'

// In the commentThread computed:
const commentThread = computed<CommentView[]>(
  () =>
    comments()
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map((comment) => ({
        id: comment.id,
        author: comment.author,
        authorName: comment.author,
        date: formatDateShort(comment.ts),
        ipTail: comment.ip?.slice(-IP_TAIL_LENGTH) ?? '',
        text: comment.text,
      })),
  'ofeliaComments.commentThread',
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/model/ofelia-comments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/model/ofelia-comments.ts client/widgets/ofelia-poop-duty/model/ofelia-comments.test.ts
git commit -m "feat(ofelia): expand CommentView with authorName, date, ipTail"
```

---

### Task 4: IconButtons (extract from ActionButtons)

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/IconButtons.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/IconButtons.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/IconButtons.test.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css` — add `--ofelia-forgive` token

**Interfaces:**

- Produces: `IconButtons` component with color-coded icons (confirm=purple, debt=gray, forgive=green).
- Consumes: `--ofelia-forgive` token, `--ofelia-ok-soft` token.

- [ ] **Step 1: Add `--ofelia-forgive` token**

```css
/* In ofelia-poop-duty.module.css, .widget block: */
--ofelia-forgive: oklch(0.55 0.13 155);

/* In :root[data-theme='dark'] .widget block: */
--ofelia-forgive: oklch(0.72 0.14 155);
```

- [ ] **Step 2: Write the failing test**

```tsx
// IconButtons.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IconButtons } from './IconButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('IconButtons', () => {
  it('renders three icon buttons with correct tones', () => {
    render(<IconButtons canForgive {...handlers()} />)
    expect(screen.getByLabelText('Подтвердить уборку')).toHaveAttribute('data-tone', 'confirm')
    expect(screen.getByLabelText('В долг')).toHaveAttribute('data-tone', 'debt')
    expect(screen.getByLabelText('Простить')).toHaveAttribute('data-tone', 'forgive')
  })

  it('fires handlers on click', () => {
    const h = handlers()
    render(<IconButtons canForgive {...h} />)
    fireEvent.click(screen.getByLabelText('Подтвердить уборку'))
    fireEvent.click(screen.getByLabelText('В долг'))
    fireEvent.click(screen.getByLabelText('Простить'))
    expect(h.onConfirm).toHaveBeenCalledOnce()
    expect(h.onDebt).toHaveBeenCalledOnce()
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('disables forgive when canForgive is false', () => {
    render(<IconButtons canForgive={false} {...handlers()} />)
    expect(screen.getByLabelText('Простить')).toBeDisabled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/IconButtons.test.tsx`
Expected: FAIL — `IconButtons` not found.

- [ ] **Step 4: Implement IconButtons**

```tsx
// IconButtons.tsx
import { Check, Clock, Minus } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './IconButtons.module.css'

export type IconButtonsProps = {
  canForgive: boolean
  onConfirm: () => void
  onDebt: () => void
  onForgive: () => void
}

export const IconButtons = reatomMemo<IconButtonsProps>(
  ({ canForgive, onConfirm, onDebt, onForgive }) => {
    return (
      <div className={styles.icons}>
        <button
          type="button"
          className={styles.icon}
          data-tone="confirm"
          aria-label="Подтвердить уборку"
          onClick={onConfirm}
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="debt"
          aria-label="В долг"
          onClick={onDebt}
        >
          <Clock size={13} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="forgive"
          aria-label="Простить"
          disabled={!canForgive}
          onClick={onForgive}
        >
          <Minus size={13} aria-hidden />
        </button>
      </div>
    )
  },
  'IconButtons',
)
```

```css
/* IconButtons.module.css */
.icons {
  display: flex;
  gap: 0.3125rem;
}

.icon {
  display: grid;
  place-items: center;
  inline-size: 1.625rem;
  block-size: 1.625rem;
  border: 1px solid var(--border);
  border-radius: 0.4375rem;
  background: var(--surface);
  cursor: pointer;
  transition:
    background 0.12s var(--ease),
    border-color 0.12s var(--ease);
}

.icon[data-tone='confirm'] {
  color: var(--primary);
}
.icon[data-tone='confirm']:hover {
  background: var(--accent-soft);
  border-color: oklch(0.82 0.07 281);
}

.icon[data-tone='debt'] {
  color: var(--text-dim);
}
.icon[data-tone='debt']:hover {
  background: var(--secondary);
}

.icon[data-tone='forgive'] {
  color: var(--ofelia-forgive);
}
.icon[data-tone='forgive']:hover {
  background: var(--ofelia-ok-soft);
  border-color: oklch(0.82 0.07 155);
}

.icon:disabled {
  color: var(--text-3);
  cursor: not-allowed;
  opacity: 0.6;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/IconButtons.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/IconButtons.tsx client/widgets/ofelia-poop-duty/ui/parts/IconButtons.module.css client/widgets/ofelia-poop-duty/ui/parts/IconButtons.test.tsx client/widgets/ofelia-poop-duty/ui/ofelia-poop-duty.module.css
git commit -m "feat(ofelia): extract IconButtons with color-coded tones + --ofelia-forgive token"
```

---

### Task 5: LabeledButtons

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.test.tsx`

**Interfaces:**

- Produces: `LabeledButtons` component with states A/B/C, `primaryLabel`, `showNotes`, `inactive` props.

- [ ] **Step 1: Write the failing test**

```tsx
// LabeledButtons.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LabeledButtons } from './LabeledButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('LabeledButtons — State A (pending)', () => {
  it('shows primary + secondary actions', () => {
    const h = handlers()
    render(<LabeledButtons status="pending" canUndo={false} canForgive {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Какашки убраны' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'В долг' }))
    expect(h.onDebt).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Простить' }))
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('uses custom primaryLabel', () => {
    render(
      <LabeledButtons
        status="pending"
        canUndo={false}
        canForgive
        primaryLabel="Подтвердить уборку"
        {...handlers()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })
})

describe('LabeledButtons — State B (confirmed)', () => {
  it('shows plaque + undo with disabled secondary', () => {
    const h = handlers()
    render(<LabeledButtons status="closed" canUndo canForgive={false} {...h} />)
    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить' }))
    expect(h.onUndo).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
  })

  it('shows "анду" note when showNotes is true', () => {
    render(<LabeledButtons status="closed" canUndo canForgive={false} showNotes {...handlers()} />)
    expect(screen.getByText(/анду/)).toBeInTheDocument()
  })

  it('hides "анду" note when showNotes is false', () => {
    render(<LabeledButtons status="closed" canUndo canForgive={false} {...handlers()} />)
    expect(screen.queryByText(/анду/)).not.toBeInTheDocument()
  })
})

describe('LabeledButtons — State C (inactive)', () => {
  it('disables all buttons', () => {
    render(<LabeledButtons status="pending" canUndo={false} canForgive inactive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/LabeledButtons.test.tsx`
Expected: FAIL — `LabeledButtons` not found.

- [ ] **Step 3: Implement LabeledButtons**

```tsx
// LabeledButtons.tsx
import { Check, Clock, Minus, Undo2 } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './LabeledButtons.module.css'

export type LabeledButtonsProps = {
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

export const LabeledButtons = reatomMemo<LabeledButtonsProps>(
  ({
    status,
    canUndo,
    canForgive,
    inactive = false,
    primaryLabel = 'Какашки убраны',
    showNotes = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    const confirmed = status === 'closed' && !inactive

    return (
      <div className={styles.stack} data-inactive={inactive}>
        {confirmed ? (
          <div className={styles.confirmedRow}>
            <div className={styles.plaque}>
              <Check size={16} aria-hidden />
              Уборка подтверждена
            </div>
            {canUndo ? (
              <button
                type="button"
                className={styles.undo}
                aria-label="Откатить"
                onClick={onUndo}
                disabled={inactive}
              >
                <Undo2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <button type="button" className={styles.primary} onClick={onConfirm} disabled={inactive}>
            <Check size={17} aria-hidden />
            {primaryLabel}
          </button>
        )}

        {showNotes && confirmed && canUndo ? (
          <div className={styles.undoNote}>
            <Undo2 size={10} aria-hidden />
            анду · только сегодня
          </div>
        ) : null}

        <div className={styles.secondary} data-disabled={confirmed || inactive}>
          <button
            type="button"
            className={styles.ghost}
            onClick={onDebt}
            disabled={confirmed || inactive}
          >
            <Clock size={14} aria-hidden />В долг
          </button>
          <button
            type="button"
            className={styles.forgive}
            onClick={onForgive}
            disabled={confirmed || inactive || !canForgive}
          >
            <Minus size={14} aria-hidden />
            Простить
          </button>
        </div>

        {showNotes ? (
          <div className={styles.inactiveNote}>
            <span className={styles.noteDot} aria-hidden />
            неактивны для других дней
          </div>
        ) : null}
      </div>
    )
  },
  'LabeledButtons',
)
```

```css
/* LabeledButtons.module.css */
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.4375rem;
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  block-size: 2.25rem;
  border: none;
  border-radius: 0.5625rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font: inherit;
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
}

.confirmedRow {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  block-size: 2.25rem;
}

.plaque {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  block-size: 2.25rem;
  border-radius: 0.5625rem;
  background: var(--ofelia-ok-soft);
  color: var(--ofelia-ok-fg);
  font-weight: 600;
  font-size: 0.8125rem;
}

.undo {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  border: 1px solid var(--border);
  border-radius: 0.5625rem;
  background: var(--surface);
  color: var(--text-dim);
  cursor: pointer;
}

.undoNote {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--text-3);
}

.secondary {
  display: flex;
  gap: 0.4375rem;
}

.secondary[data-disabled='true'] {
  opacity: 0.35;
}

.ghost {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  block-size: 2.125rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  cursor: pointer;
}

.forgive {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  block-size: 2.125rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--surface);
  color: var(--ofelia-forgive);
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  cursor: pointer;
}

.inactiveNote {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--text-3);
}

.noteDot {
  display: inline-block;
  inline-size: 0.4375rem;
  block-size: 0.4375rem;
  border-radius: 0.125rem;
  background: var(--border);
}

.stack[data-inactive='true'] .primary,
.stack[data-inactive='true'] .ghost,
.stack[data-inactive='true'] .forgive {
  opacity: 0.3;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/LabeledButtons.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.tsx client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.module.css client/widgets/ofelia-poop-duty/ui/parts/LabeledButtons.test.tsx
git commit -m "feat(ofelia): add LabeledButtons with A/B/C states, notes, inactive"
```

---

### Task 6: ActionButtons refactor (router)

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx`

**Interfaces:**

- Consumes: `IconButtons`, `LabeledButtons` from Tasks 4-5.
- Produces: `ActionButtons` routes `compact → IconButtons`, else `→ LabeledButtons`. New props: `inactive`, `primaryLabel`, `showNotes`. Removed: `alwaysSecondary`.

- [ ] **Step 1: Write the failing test**

```tsx
// ActionButtons.test.tsx — replace existing tests
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActionButtons } from './ActionButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('ActionButtons (compact)', () => {
  it('routes to IconButtons', () => {
    render(
      <ActionButtons compact status="pending" canUndo={false} canForgive={false} {...handlers()} />,
    )
    expect(screen.getByLabelText('Подтвердить уборку')).toHaveAttribute('data-tone', 'confirm')
  })
})

describe('ActionButtons (full)', () => {
  it('routes to LabeledButtons with default primaryLabel', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('passes primaryLabel to LabeledButtons', () => {
    render(
      <ActionButtons
        status="pending"
        canUndo={false}
        canForgive
        primaryLabel="Подтвердить уборку"
        {...handlers()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })

  it('passes inactive to LabeledButtons', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive inactive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx`
Expected: FAIL — `inactive`, `primaryLabel` props not yet supported.

- [ ] **Step 3: Implement the refactor**

```tsx
// ActionButtons.tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { IconButtons } from './IconButtons'
import type { IconButtonsProps } from './IconButtons'
import { LabeledButtons } from './LabeledButtons'
import type { LabeledButtonsProps } from './LabeledButtons'

export type ActionButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  compact?: boolean
  inactive?: boolean
  primaryLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const ActionButtons = reatomMemo<ActionButtonsProps>(({ compact, ...rest }) => {
  if (compact) {
    const iconProps: IconButtonsProps = {
      canForgive: rest.canForgive,
      onConfirm: rest.onConfirm,
      onDebt: rest.onDebt,
      onForgive: rest.onForgive,
    }
    return <IconButtons {...iconProps} />
  }

  const labeledProps: LabeledButtonsProps = {
    status: rest.status,
    canUndo: rest.canUndo,
    canForgive: rest.canForgive,
    inactive: rest.inactive,
    primaryLabel: rest.primaryLabel,
    showNotes: rest.showNotes,
    onConfirm: rest.onConfirm,
    onUndo: rest.onUndo,
    onDebt: rest.onDebt,
    onForgive: rest.onForgive,
  }
  return <LabeledButtons {...labeledProps} />
}, 'ActionButtons')
```

Delete the old `ActionButtons.module.css` content (no longer needed — styles moved to IconButtons/LabeledButtons). Keep the file but empty or remove it if no other code imports it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx`
Expected: PASS

- [ ] **Step 5: Run typecheck to verify no broken imports**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.tsx client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.test.tsx client/widgets/ofelia-poop-duty/ui/parts/ActionButtons.module.css
git commit -m "refactor(ofelia): ActionButtons as router → IconButtons + LabeledButtons"
```

---

### Task 7: DebtChips — pluralized units + state C

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx`

**Interfaces:**

- Consumes: `pluralizeDays` from `../format`.

- [ ] **Step 1: Write the failing tests**

```tsx
// Append to DebtChips.test.tsx
it('shows pluralized debt units in chips', () => {
  render(<DebtChips balance={balance} />)
  expect(screen.getByText('8 дней')).toBeInTheDocument()
  expect(screen.getByText('0 дней')).toBeInTheDocument()
})

it('shows "баланс ровный · 0 : 0" when all debts are zero', () => {
  const zeroBalance: DebtBalanceEntry[] = [
    { person: 'Карина', debt: 0, over: false },
    { person: 'Леша', debt: 0, over: false },
  ]
  render(<DebtChips balance={zeroBalance} />)
  expect(screen.getByText('баланс ровный · 0 : 0')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx`
Expected: FAIL — chips show raw numbers, no "баланс ровный" text.

- [ ] **Step 3: Implement the changes**

```tsx
// DebtChips.tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { pluralizeDays } from '../format'
import type { DebtBalanceEntry } from '../view-model'
import { Avatar } from './Avatar'

import styles from './DebtChips.module.css'

export type DebtChipsProps = {
  balance: DebtBalanceEntry[]
}

export const DebtChips = reatomMemo<DebtChipsProps>(({ balance }) => {
  const allZero = balance.every((entry) => entry.debt === 0)

  if (allZero) {
    return <span className={styles.even}>баланс ровный · 0 : 0</span>
  }

  return (
    <div className={styles.row}>
      {balance.map((entry) => (
        <span
          key={entry.person}
          className={styles.chip}
          data-over={entry.over}
          data-testid={`debt-chip-${entry.person}`}
        >
          <Avatar person={entry.person} size="sm" />
          <span className={styles.count}>{pluralizeDays(entry.debt)}</span>
        </span>
      ))}
    </div>
  )
}, 'DebtChips')
```

```css
/* Add to DebtChips.module.css */
.even {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-3);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/DebtChips.tsx client/widgets/ofelia-poop-duty/ui/parts/DebtChips.module.css client/widgets/ofelia-poop-duty/ui/parts/DebtChips.test.tsx
git commit -m "feat(ofelia): DebtChips pluralized units + 'баланс ровный' state C"
```

---

### Task 8: CompactTier — remove UserToggle

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.tsx`

**Interfaces:**

- Consumes: `ActionButtons` (now routes to `IconButtons` for compact).

- [ ] **Step 1: Write the failing test**

```tsx
// In Tiers.test.tsx, update the CompactTier describe block:
// 1. Remove the test 'renders the label, the icon actions, and the user toggle'
//    (it asserts UserToggle presence via /Леша/)
// 2. Remove the test 'switches the current user through the toggle'
// 3. Add this test:
it('does not render UserToggle', () => {
  withOfelia(makeOfeliaValue(), <CompactTier />)
  expect(screen.queryByText('Я:')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Леша/ })).not.toBeInTheDocument()
})

// 4. Update the first test to not assert UserToggle:
it('renders the label and the icon actions', () => {
  withOfelia(makeOfeliaValue(), <CompactTier />)
  expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/tiers`
Expected: FAIL — UserToggle still present.

- [ ] **Step 3: Remove UserToggle from CompactTier**

```tsx
// CompactTier.tsx — remove UserToggle import and usage
// Remove: import { UserToggle } from '../parts/UserToggle'
// Remove: <UserToggle value={currentUser()} onChange={actions.onSetUser} />
// Remove: currentUser from useOfelia destructuring (if unused elsewhere)
// Change bottom row to only DebtChips:
<div className={styles.bottom}>
  <DebtChips balance={balance} />
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/tiers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.tsx
git commit -m "feat(ofelia): remove UserToggle from CompactTier"
```

---

### Task 9: StandardTier — remove UserToggle, add hint, LabeledButtons, inactive

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`

**Interfaces:**

- Consumes: `ActionButtons` with `inactive`, `primaryLabel` props. `otherPerson` from `model/ofelia-duty`. `selectedDaySubtitle` from `format`.

- [ ] **Step 1: Write the failing tests**

```tsx
// In StandardTier.test.tsx — these existing tests will break and need updating:
// - 'state A' test: assertion 'гасит долг · осталось 2 дня' → 'гасит долг · 2 дня' (Task 2)
// - 'state B' test: assertion that 'В долг' is NOT in document → now it IS in document (disabled)
// - 'state C' test: assertion that 'Простить' is NOT in document → now it IS in document (disabled)
// - 'state D' test: assertion that buttons are NOT in document → now they ARE (disabled/inactive)

// Add these new tests:
it('does not render UserToggle', () => {
  withOfelia(makeOfeliaValue(), <StandardTier />)
  expect(screen.queryByText('Я:')).not.toBeInTheDocument()
})

it('shows hint text with other person name', () => {
  withOfelia(makeOfeliaValue(), <StandardTier />)
  expect(screen.getByText(/Не успеваешь\? Уберёт Лёша/)).toBeInTheDocument()
})

it('shows disabled buttons for future days instead of hiding them', () => {
  const view = makeOfeliaView({
    selected: {
      iso: '2026-06-18',
      person: 'Леша',
      isDebtDay: false,
      status: 'pending',
      canUndo: false,
      debtRemaining: 0,
      isFuture: true,
    },
  })
  withOfelia(makeOfeliaValue({ view }), <StandardTier />)
  expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
})

// Update state B test:
it('state B — closed day shows plaque, undo, and disabled secondary', () => {
  const view = makeOfeliaView({
    selected: {
      iso: '2026-06-16',
      person: 'Карина',
      isDebtDay: true,
      status: 'closed',
      canUndo: true,
      debtRemaining: 1,
      isFuture: false,
    },
  })
  withOfelia(makeOfeliaValue({ view }), <StandardTier />)
  expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Откатить' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
})

// Update state C test:
it('state C — no debt shows Простить disabled', () => {
  const view = makeOfeliaView({
    selected: {
      iso: '2026-06-16',
      person: 'Леша',
      isDebtDay: false,
      status: 'pending',
      canUndo: false,
      debtRemaining: 0,
      isFuture: false,
    },
    balance: [
      { person: 'Леша', debt: 0, over: false },
      { person: 'Карина', debt: 0, over: false },
    ],
  })
  withOfelia(makeOfeliaValue({ view }), <StandardTier />)
  expect(screen.getByText('по очереди · долгов нет')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`
Expected: FAIL — UserToggle present, no hint, buttons hidden for future.

- [ ] **Step 3: Implement the changes**

```tsx
// StandardTier.tsx
import { Cat } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { useAtomValue } from '@/shared/reatom/use-atom-value'
import { WidgetControls } from '@/widget-host/ui/WidgetControls'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { otherPerson } from '../model/ofelia-duty'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'

import styles from './StandardTier.module.css'

export type StandardTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const StandardTier = reatomMemo<StandardTierProps>(({ onExpand, onDelete }) => {
  const { view, actions } = useOfelia()
  const selected = useAtomValue(view.selected)
  const balance = useAtomValue(view.balance)
  const canForgive = useAtomValue(view.canForgive)
  if (!selected) return null

  return (
    <div className={styles.root}>
      <WidgetControls onExpand={onExpand} onDelete={onDelete} />
      <div className={styles.title}>
        <Cat size={16} aria-hidden />
        Лоток Офелии
      </div>

      <div className={styles.label}>Сегодня убирает</div>
      <div className={styles.who}>
        <Avatar person={selected.person} size="md" />
        <div>
          <div className={styles.name} data-testid="ofelia-duty-person">
            {selected.person}
          </div>
          <div className={styles.sub}>{selectedDaySubtitle(selected, balance)}</div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.debtRow}>
        <span className={styles.debtLabel}>Долг</span>
        <DebtChips balance={balance} />
      </div>

      <div className={styles.spacer} />

      <p className={styles.hint}>
        Не успеваешь? Уберёт {otherPerson(selected.person)}, а тебе +1 день долга.
      </p>

      <ActionButtons
        status={selected.status}
        canUndo={selected.canUndo}
        canForgive={canForgive}
        inactive={selected.isFuture}
        onConfirm={actions.onConfirm}
        onUndo={actions.onUndo}
        onDebt={actions.onDebt}
        onForgive={actions.onForgive}
      />
    </div>
  )
}, 'StandardTier')
```

```css
/* Add to StandardTier.module.css */
.hint {
  margin: 0 0 0.625rem 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-3);
  text-wrap: pretty;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.tsx client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.module.css client/widgets/ofelia-poop-duty/ui/tiers/StandardTier.test.tsx
git commit -m "feat(ofelia): StandardTier — remove UserToggle, add hint, LabeledButtons, inactive"
```

---

### Task 10: HistoryList — compact badges, vertical layout

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`

**Interfaces:**

- Consumes: `Avatar` with `px` prop, `personInitial` from `person.ts`. `HistoryEntryView` from model (has `type`, `actor`, `onBehalfOf`, `date`, `ipTail`).

- [ ] **Step 1: Write the failing tests**

```tsx
// In HistoryList.test.tsx — the existing tests will break:
// - 'renders an entry with name, action label, and IP tail' → no more 'убрал(а)' text,
//   date format changes from '2026-06-16' to the entry.date field directly
// - 'renders an "за X" badge' → badge text changes from 'за Леша' to 'за Л'

// Replace with these tests:
it('renders vertical layout with date header and avatar+name row', () => {
  render(<HistoryList entries={[entry()]} />)
  expect(screen.getByText('2026-06-16')).toBeInTheDocument()
  expect(screen.getByText('Карина')).toBeInTheDocument()
})

it('renders "долг" badge for went_into_debt', () => {
  render(<HistoryList entries={[entry({ type: 'went_into_debt' })]} />)
  expect(screen.getByText('долг')).toBeInTheDocument()
})

it('renders "за {initial}" badge for cleaned with onBehalfOf', () => {
  render(<HistoryList entries={[entry({ onBehalfOf: 'Леша' })]} />)
  expect(screen.getByText('за Л')).toBeInTheDocument()
})

it('renders "−1 день" badge for forgiven', () => {
  render(<HistoryList entries={[entry({ type: 'forgiven' })]} />)
  expect(screen.getByText('−1 день')).toBeInTheDocument()
})

it('renders no badge for cleaned without onBehalfOf', () => {
  render(<HistoryList entries={[entry()]} />)
  expect(screen.queryByText(/^за /)).not.toBeInTheDocument()
  expect(screen.queryByText('долг')).not.toBeInTheDocument()
})

it('renders an empty state when there are no entries', () => {
  render(<HistoryList entries={[]} />)
  expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`
Expected: FAIL — old full-word labels.

- [ ] **Step 3: Implement the changes**

```tsx
// HistoryList.tsx
import type { HistoryEntryView } from '@widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { Avatar } from './Avatar'
import { personInitial } from '../person'

import styles from './HistoryList.module.css'

function badgeLabel(entry: HistoryEntryView): { text: string; tone: 'accent' | 'forgive' } | null {
  if (entry.type === 'went_into_debt') return { text: 'долг', tone: 'accent' }
  if (entry.type === 'forgiven') return { text: '−1 день', tone: 'forgive' }
  if (entry.type === 'cleaned' && entry.onBehalfOf) {
    return { text: `за ${personInitial(entry.onBehalfOf)}`, tone: 'accent' }
  }
  return null
}

export type HistoryListProps = {
  entries: HistoryEntryView[]
}

export const HistoryList = reatomMemo<HistoryListProps>(({ entries }) => {
  if (entries.length === 0) {
    return <div className={styles.empty}>Пока нет событий</div>
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => {
        const badge = badgeLabel(entry)
        return (
          <li key={entry.id} className={styles.item}>
            <span className={styles.date}>{entry.date}</span>
            <div className={styles.row}>
              <Avatar person={entry.actor} px={20} />
              <span className={styles.name}>{entry.actor}</span>
              {badge ? (
                <span className={styles.badge} data-tone={badge.tone}>
                  {badge.text}
                </span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}, 'HistoryList')
```

```css
/* HistoryList.module.css — full rewrite */
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.date {
  font-family: var(--font-mono);
  font-size: 0.69rem;
  color: var(--text-3);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
}

.name {
  font-weight: 500;
  font-size: 0.78rem;
  color: var(--text);
}

.badge {
  font-size: 0.625rem;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 0.25rem;
  padding: 0.0625rem 0.3125rem;
}

.badge[data-tone='accent'] {
  color: var(--primary);
  background: var(--accent-soft);
}

.badge[data-tone='forgive'] {
  color: var(--ofelia-forgive);
  background: var(--ofelia-ok-soft);
}

.empty {
  color: var(--text-dim);
  font-size: 0.8125rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/HistoryList.tsx client/widgets/ofelia-poop-duty/ui/parts/HistoryList.module.css client/widgets/ofelia-poop-duty/ui/parts/HistoryList.test.tsx
git commit -m "feat(ofelia): HistoryList compact badges + vertical layout"
```

---

### Task 11: CommentThread — avatar + name + date + IP, icon send

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`

**Interfaces:**

- Consumes: `CommentView` with `authorName`, `date`, `ipTail` (from Task 3). `Avatar` with `px` prop. `Send` icon from lucide.

- [ ] **Step 1: Write the failing tests**

```tsx
// In CommentThread.test.tsx — the view() factory needs updating to include
// authorName, date, ipTail. The placeholder text changes from
// 'Добавить комментарий…' to 'Написать комментарий…'.
// The send button changes from text 'Отправить' to aria-label 'Отправить'.

// Update the view() factory:
const view = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  author: 'Карина',
  authorName: 'Карина',
  date: '10 июн',
  ipTail: '0.0.7',
  text: 'Привет',
  ...overrides,
})

// Add these tests:
it('renders comment with avatar, author name, date, and ipTail', () => {
  render(
    <CommentThread
      comments={[view({ authorName: 'Карина', date: '10 июн', ipTail: '0.0.7' })]}
      onSend={vi.fn()}
    />,
  )
  expect(screen.getByText('Карина')).toBeInTheDocument()
  expect(screen.getByText('10 июн')).toBeInTheDocument()
  expect(screen.getByText('0.0.7')).toBeInTheDocument()
})

it('renders an icon send button', () => {
  render(<CommentThread comments={[]} onSend={vi.fn()} />)
  expect(screen.getByLabelText('Отправить')).toBeInTheDocument()
})

// Update existing tests to use new placeholder text:
// 'Добавить комментарий…' → 'Написать комментарий…'
// screen.getByRole('button', { name: 'Отправить' }) → screen.getByLabelText('Отправить')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`
Expected: FAIL — old format without name/date/ip, text send button.

- [ ] **Step 3: Implement the changes**

```tsx
// CommentThread.tsx
import { useState } from 'react'
import { Send } from 'lucide-react'
import type { CommentView } from '@widgets/ofelia-poop-duty/model/ofelia-comments'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { Avatar } from './Avatar'

import styles from './CommentThread.module.css'

export type CommentThreadProps = {
  comments: CommentView[]
  onSend: (text: string) => void
}

export const CommentThread = reatomMemo<CommentThreadProps>(({ comments, onSend }) => {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className={styles.root}>
      {comments.length === 0 ? (
        <div className={styles.empty}>Пока нет комментариев</div>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.item}>
              <Avatar person={comment.author} px={22} />
              <div className={styles.body}>
                <div className={styles.meta}>
                  <span className={styles.author}>{comment.authorName}</span>
                  <span className={styles.date}>{comment.date}</span>
                  {comment.ipTail ? <span className={styles.ip}>{comment.ipTail}</span> : null}
                </div>
                <div className={styles.text}>{comment.text}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написать комментарий…"
          aria-label="Комментарий"
        />
        <button className={styles.send} type="submit" aria-label="Отправить">
          <Send size={15} aria-hidden />
        </button>
      </form>
    </div>
  )
}, 'CommentThread')
```

```css
/* CommentThread.module.css — full rewrite */
.root {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.5rem;
}

.list {
  display: flex;
  margin: 0;
  padding: 0;
  list-style: none;
  flex-direction: column;
}

.item {
  display: flex;
  gap: 0.5625rem;
  padding: 0.5625rem 0;
  border-bottom: 1px solid var(--border);
}

.body {
  flex: 1;
  min-width: 0;
}

.meta {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  margin-block-end: 0.1875rem;
}

.author {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--text);
}

.date {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--text-3);
}

.ip {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--text-3);
  opacity: 0.6;
}

.text {
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--text-dim);
  overflow-wrap: break-word;
}

.empty {
  color: var(--text-dim);
  font-size: 0.8125rem;
}

.form {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  padding-top: 0.625rem;
  border-top: 1px solid var(--border);
}

.input {
  flex: 1;
  min-width: 0;
  block-size: 2.25rem;
  border: 1px solid var(--border);
  border-radius: 0.5625rem;
  background: var(--background);
  padding: 0 0.75rem;
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  outline: none;
}

.send {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  border: none;
  border-radius: 0.5625rem;
  background: var(--primary);
  color: var(--primary-foreground);
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/CommentThread.tsx client/widgets/ofelia-poop-duty/ui/parts/CommentThread.module.css client/widgets/ofelia-poop-duty/ui/parts/CommentThread.test.tsx
git commit -m "feat(ofelia): CommentThread with avatar, name, date, IP, icon send"
```

---

### Task 12: WeekStrip — avatar 26px

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx`

**Interfaces:**

- Consumes: `Avatar` with `px={26}`.

- [ ] **Step 1: Write the failing test**

```tsx
// In WeekStrip.test.tsx — add this test:
it('renders 26px avatars in day cards', () => {
  const { container } = render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
  const avatar = container.querySelector('[data-tone]')
  expect(avatar).toHaveStyle({ width: '26px', height: '26px' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx`
Expected: FAIL — avatars are 20px (sm).

- [ ] **Step 3: Change `size="sm"` to `px={26}`**

```tsx
// WeekStrip.tsx — in the day button, change:
<Avatar person={day.person} size="sm" />
// to:
<Avatar person={day.person} px={26} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.tsx client/widgets/ofelia-poop-duty/ui/parts/WeekStrip.test.tsx
git commit -m "feat(ofelia): WeekStrip avatar 26px"
```

---

### Task 13: MobileTabs

**Files:**

- Create: `client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.tsx`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.module.css`
- Create: `client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.test.tsx`

**Interfaces:**

- Produces: `MobileTabs` component with `tab: 'history' | 'comments'` and `onChange` callback.

- [ ] **Step 1: Write the failing test**

```tsx
// MobileTabs.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileTabs } from './MobileTabs'

describe('MobileTabs', () => {
  it('renders two tab buttons', () => {
    render(<MobileTabs tab="history" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'История' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Комментарии' })).toBeInTheDocument()
  })

  it('calls onChange when switching tabs', () => {
    const onChange = vi.fn()
    render(<MobileTabs tab="history" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Комментарии' }))
    expect(onChange).toHaveBeenCalledWith('comments')
  })

  it('marks the active tab with data-active', () => {
    render(<MobileTabs tab="history" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'История' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: 'Комментарии' })).toHaveAttribute(
      'data-active',
      'false',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/MobileTabs.test.tsx`
Expected: FAIL — `MobileTabs` not found.

- [ ] **Step 3: Implement MobileTabs**

```tsx
// MobileTabs.tsx
import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './MobileTabs.module.css'

export type MobileTab = 'history' | 'comments'

export type MobileTabsProps = {
  tab: MobileTab
  onChange: (tab: MobileTab) => void
}

export const MobileTabs = reatomMemo<MobileTabsProps>(({ tab, onChange }) => {
  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.tab}
        data-active={tab === 'history'}
        onClick={() => onChange('history')}
      >
        История
      </button>
      <button
        type="button"
        className={styles.tab}
        data-active={tab === 'comments'}
        onClick={() => onChange('comments')}
      >
        Комментарии
      </button>
    </div>
  )
}, 'MobileTabs')
```

```css
/* MobileTabs.module.css */
.root {
  display: none;
  gap: 0.375rem;
  flex: none;
  margin-block-end: 0.875rem;
  border-bottom: 1px solid var(--border);
}

.tab {
  flex: 1;
  padding: 0.5625rem 0.25rem 0.625rem;
  border: none;
  border-radius: 0.5rem 0.5rem 0 0;
  background: transparent;
  color: var(--text-3);
  border-bottom: 2px solid transparent;
  margin-block-end: -1px;
  font: inherit;
  font-weight: 600;
  font-size: 0.75rem;
  cursor: pointer;
}

.tab[data-active='true'] {
  color: var(--primary);
  border-bottom-color: var(--primary);
  background: var(--accent-soft);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/MobileTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.tsx client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.module.css client/widgets/ofelia-poop-duty/ui/parts/MobileTabs.test.tsx
git commit -m "feat(ofelia): add MobileTabs for history/comments switching"
```

---

### Task 14: RichLayout — container queries, MobileTabs, LabeledButtons, hint, avatar 62px

**Files:**

- Modify: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.module.css`
- Modify: `client/widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx`

**Interfaces:**

- Consumes: `ActionButtons` with `primaryLabel`, `showNotes`, `inactive`. `MobileTabs`. `Avatar` with `px`. `otherPerson` from model. `selectedDaySubtitle` (updated).

- [ ] **Step 1: Write the failing tests**

```tsx
// In RichLayout.test.tsx — existing test 'hides the action controls for a future day'
// will break: buttons are now shown disabled (inactive), not hidden.
// The test asserting 'Какашки убраны' will also break → now 'Подтвердить уборку'.

// Add these tests:
it('uses "Подтвердить уборку" as primary label', () => {
  renderRich(makeOfeliaValue(), <RichLayout />)
  expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
})

it('shows "неактивны для других дней" note', () => {
  renderRich(makeOfeliaValue(), <RichLayout />)
  expect(screen.getByText(/неактивны для других дней/)).toBeInTheDocument()
})

it('shows hint with other person name', () => {
  renderRich(makeOfeliaValue(), <RichLayout />)
  // Default fixture has Карина as selected person → other is Лёша
  expect(screen.getByText(/Не успеваешь — сегодня уберёт Лёша/)).toBeInTheDocument()
})

it('renders MobileTabs', () => {
  renderRich(makeOfeliaValue(), <RichLayout />)
  expect(screen.getByRole('button', { name: 'История' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Комментарии' })).toBeInTheDocument()
})

it('shows disabled buttons for a future day instead of hiding them', () => {
  const view = makeOfeliaView({
    selected: {
      iso: '2026-06-19',
      person: 'Карина',
      isDebtDay: false,
      status: 'pending',
      canUndo: false,
      debtRemaining: 0,
      isFuture: true,
    },
  })
  renderRich(makeOfeliaValue({ view }), <RichLayout />)
  expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
})

// Update existing test that asserts 'Какашки убраны' → change to 'Подтвердить уборку'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx`
Expected: FAIL — old primary text, no notes, no MobileTabs, old hint.

- [ ] **Step 3: Implement the changes**

```tsx
// RichLayout.tsx — key changes:
// 1. Import useState, MobileTabs, otherPerson
// 2. Add tab state: const [tab, setTab] = useState<'history' | 'comments'>('history')
// 3. Today avatar: <Avatar person={selected.person} px={62} />
// 4. ActionButtons: add primaryLabel="Подтвердить уборку" showNotes inactive={selected.isFuture}
// 5. Hint: use otherPerson(selected.person)
// 6. Add MobileTabs before the split
// 7. Add data-tab={tab} to the split div
// 8. Remove alwaysSecondary prop (no longer exists)
// 9. Remove selected.isFuture ? null : conditional — always render ActionButtons

import { useState } from 'react'
import { Cat, ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { formatWeekRange, pluralizeDays, selectedDaySubtitle } from '../format'
import { otherPerson } from '../model/ofelia-duty'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from './ActionButtons'
import { Avatar } from './Avatar'
import { CommentThread } from './CommentThread'
import { HistoryList } from './HistoryList'
import { MobileTabs } from './MobileTabs'
import type { MobileTab } from './MobileTabs'
import { UserToggle } from './UserToggle'
import { WeekStrip } from './WeekStrip'

import styles from './RichLayout.module.css'

// ... (HistoryColumn and CommentsColumn stay the same)

export const RichLayout = reatomMemo<RichLayoutProps>(({ onExpand, onDelete, onClose }) => {
  const { view, currentUser, actions, nav } = useOfelia()
  const [tab, setTab] = useState<MobileTab>('history')
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const days = view.days()
  const selectedDay = days.find((day) => day.isSelected)
  const range = formatWeekRange(days)

  return (
    <div className={styles.root}>
      <header className={styles.header}>{/* ... same header ... */}</header>

      <div className={styles.body}>
        <section className={styles.panel}>
          <div className={styles.panelLabel}>
            {selectedDay?.isToday ? 'Сегодня' : selectedDay?.weekday}
          </div>
          <div className={styles.today}>
            <Avatar person={selected.person} px={62} />
            <div className={styles.todayName}>{selected.person}</div>
            <span className={styles.statusChip}>{selectedDaySubtitle(selected, balance)}</span>
          </div>

          <ActionButtons
            status={selected.status}
            canUndo={selected.canUndo}
            canForgive={canForgive}
            inactive={selected.isFuture}
            primaryLabel="Подтвердить уборку"
            showNotes
            onConfirm={actions.onConfirm}
            onUndo={actions.onUndo}
            onDebt={actions.onDebt}
            onForgive={actions.onForgive}
          />

          <p className={styles.hint}>
            Не успеваешь — сегодня уберёт {otherPerson(selected.person)}, а тебе запишется +1 день.
          </p>

          <div className={styles.balance}>{/* ... same balance section ... */}</div>
        </section>

        <section className={styles.detail}>
          <div className={styles.weekNav}>{/* ... same week nav (with Сегодня button) ... */}</div>

          <WeekStrip days={days} onSelectDay={actions.onSelectDay} />

          <div className={styles.split} data-tab={tab}>
            <MobileTabs tab={tab} onChange={setTab} />
            <div className={styles.historyCol}>
              <div className={styles.colLabel}>История</div>
              <HistoryColumn />
            </div>
            <div className={styles.commentsCol}>
              <div className={styles.colLabel}>Комментарии</div>
              <CommentsColumn />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}, 'RichLayout')
```

```css
/* RichLayout.module.css — add container queries + responsive */
.root {
  container-type: inline-size;
  /* ... existing ... */
}

/* Add at end of file */
@container (max-width: 680px) {
  .body {
    flex-direction: column;
    overflow-y: auto;
    padding: 1rem;
    gap: 1.125rem;
  }
  .panel {
    inline-size: 100%;
    flex: none;
  }
  .detail {
    flex: none;
    overflow: visible;
  }
  .split {
    flex: none;
    flex-direction: column;
    overflow: visible;
    margin-block-start: 1rem;
    border-top: none;
  }
  .split :global(.mobileTabs) {
    display: flex;
  }
  .historyCol {
    inline-size: 100%;
    flex: none;
    max-block-size: 21.25rem;
    border-inline-end: none;
    padding: 0;
  }
  .commentsCol {
    flex: none;
    padding: 0;
  }
  .split[data-tab='history'] .commentsCol {
    display: none;
  }
  .split[data-tab='comments'] .historyCol {
    display: none;
  }
}
```

Note: The MobileTabs component has `display: none` by default in its CSS and needs to be shown only within the container query. The `.root :global(...)` approach may need adjustment — alternatively, add a `.tabs` wrapper in RichLayout's CSS that shows only in the container query.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test -- widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full test suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/widgets/ofelia-poop-duty/ui/parts/RichLayout.tsx client/widgets/ofelia-poop-duty/ui/parts/RichLayout.module.css client/widgets/ofelia-poop-duty/ui/parts/RichLayout.test.tsx
git commit -m "feat(ofelia): RichLayout — container queries, MobileTabs, LabeledButtons, hint, avatar 62px"
```

---

## Post-Implementation Verification

- [ ] **Run full test suite:** `pnpm test`
- [ ] **Run typecheck:** `pnpm typecheck`
- [ ] **Run e2e:** `pnpm test:e2e`
- [ ] **Visual check:** `pnpm dev` — compare each tier against design references
