# Design prompt — Ofelia widget: history & comments

> Historical record: this is the brief that was sent to Claude Design, kept for provenance. The
> result is `design/Офелия - история и комментарии.dc.html` and `design/OfeliaPanels.dc.html`, and
> the authoritative requirements are
> `docs/superpowers/specs/2026-07-26-ofelia-authored-ledger-design.md`. Where they differ, the spec
> wins — notably the "signed in as" circle in the panel header, which this brief asks for and the
> spec drops.

Redesign two panels of an existing React widget: the **history (ledger) list** and the **comment
thread**. Everything else about the widget stays as it is — this is a redesign of two columns, not
of the widget.

All user-facing copy is **Russian** and is quoted verbatim below. Keep it exactly as written.

## What the widget is

"Лоток Офелии" — a shared household board widget that tracks whose turn it is to clean the cat
litter box. Two people alternate on a fixed daily rotation (Леша, Карина). If someone skips their
day, the other one cleans and the skipper goes one day into debt; debt is repaid by cleaning on a
future day that was not yours, or it can be forgiven.

The widget appears as a card on a board. Only its two largest sizes render these panels:

- **large** — a board card. Two columns side by side: history left, comments right. Each column is
  narrow, roughly 240–320 px.
- **fullscreen** — a dialog. Same two columns, much wider, roughly 420–560 px each, and much taller.
- **mobile** — inside either of the above, below ~640 px the two columns collapse into a tab switch
  ("История" / "Комментарии") and the active one takes the full width.

The same row markup must survive all three widths. There is no separate mobile design — it is the
same component reflowing.

## What is being fixed

The current history row is `2026-06-16` · IP tail · avatar · name · small badge. Three concrete
problems:

1. **The date is a raw ISO string.**
2. **The IP tail is shown and is useless.** It is being removed entirely.
3. **A superseded entry looks identical to a live one.** The ledger is append-only: reopening a day
   and closing it again leaves three entries for that day, and only the newest counts. Today all
   three render the same, so the list cannot be read.

On top of that, the widget now knows **who is signed in**. Until now every record was signed with a
per-device toggle ("Я: Леша / Карина"), which meant two people sharing a tablet signed as the same
person. That toggle is gone. Records now carry the real account that created them, which is a
separate axis from the duty rotation and must be shown alongside it.

## The two kinds of circle

Names are not spelled out in rows — people are represented by circles.

- **Duty circle** — a person in the rotation (Леша / Карина). Initial + a per-slot colour. This is a
  schedule role, not a login.
- **Account circle** — the signed-in account that recorded the entry or wrote the comment. Today it
  renders an initial; **an uploaded avatar image will replace that initial later**, so design it as
  an image slot that currently falls back to an initial. Its colour derives from a hash of the
  account id, not from the rotation — there may eventually be more than two accounts, and they are
  not required to correspond to duty people.

**These two kinds regularly sit in the same row and must not read as the same thing.** Distinguish
them by shape or treatment, not by colour alone — colour is already carrying other meaning.

## Data available per history row

```ts
type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: 'Леша' | 'Карина' }   // legacy record, pre-accounts
  | { kind: 'unknown' }                             // no session (dev/e2e)

type HistoryEntryView = {
  id: string
  type: 'cleaned' | 'went_into_debt' | 'reset' | 'forgiven'
  actor: 'Леша' | 'Карина'          // the duty person the entry is about
  onBehalfOf?: 'Леша' | 'Карина'    // the person whose debt moves
  dutyDate: string                  // ISO date of the duty day
  recordedAt: number                // epoch ms when the entry was written
  recordedBy: EntryAuthor
  isViewerRecord: boolean           // recorded by whoever is currently looking
  superseded: boolean               // a later entry for the same day overrides this one
  debtDelta: { person: 'Леша' | 'Карина'; amount: 1 | -1 } | null
}
```

Rows are grouped by `dutyDate`. Groups descend by date; rows inside a group descend by
`recordedAt`.

### Phrase per type

| `type` | phrase | debt effect |
|---|---|---|
| `cleaned`, no `onBehalfOf` | `[Л] убрал` | none |
| `cleaned` with `onBehalfOf` | `[Л] убрал за [К]` | −1 for `actor` |
| `went_into_debt` | `[К] ушла в долг → убирает [Л]` | +1 for `onBehalfOf` |
| `forgiven` | `[Л] простил день [К]` | −1 for `onBehalfOf` |
| `reset` | `день переоткрыт` | none |

`[Л]` / `[К]` are duty circles inline in the phrase.

**Trap:** on a `reset` entry, `actor` is *whose closure was undone*, not who undid it. Never label a
`reset` row as "Леша переоткрыл".

### The recording signature

Every row also carries "who marked it and when": account circle + name + time, e.g.
`отметила Карина · 23:50`.

When the calendar date of `recordedAt` differs from `dutyDate`, that must be visible — a day closed
three days late is currently invisible and it matters. Example: `отметила Карина 18 июня · 23:50`
on a row whose duty day is 16 июня.

## Data available per comment

```ts
type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}
```

Comment rows: account circle, name, time, text. Newest first. Below the list sits an existing
single-line composer — a text input with placeholder `Написать комментарий…` and a send icon button
(`aria-label="Отправить"`). Restyle it to match, keep it one line.

## States to design

- **superseded row** — visibly does not count, without becoming unreadable.
- **viewer's own row / own comment** — marked on the account circle, not with the word "вы".
- **late recording** — recorded on a different calendar day than the duty day.
- **legacy author** (`kind: 'person'`) — records written before accounts existed. There is no
  account circle for them; a duty circle stands in.
- **unknown author** (`kind: 'unknown'`) — placeholder circle. The rest of the row stays fully
  readable: the phrase, the date and the time do not depend on identity.
- **identity still loading** — the member directory is fetched asynchronously; circles resolve a
  moment after the rows do. Rows must not reflow when they arrive.
- **empty** — `Пока нет событий` / `Пока нет комментариев`.
- **header slot** — removing the old "Я:" toggle frees a slot in the panel header. It now shows the
  current account's circle ("signed in as"), no text.

## Visual system

The widget inherits board tokens. Use them; do not introduce new raw colours except for the account
circle palette.

```css
--background --foreground --card --card-foreground --primary --primary-foreground
--muted --muted-foreground --accent --accent-soft --destructive --border --border-strong
--text /* = --foreground */  --text-dim /* = --muted-foreground */  --text-3 /* tertiary */
--success --radius: 0.625rem  --ease: cubic-bezier(0.22, 1, 0.36, 1)
--font-ui: 'Hanken Grotesk Variable', system-ui, sans-serif
--font-mono: 'JetBrains Mono Variable', ui-monospace, monospace
```

Widget-local tokens, defined for both themes:

```css
--ofelia-k-bg  --ofelia-k-fg    /* Карина — warm red */
--ofelia-l-bg  --ofelia-l-fg    /* Леша — cool blue */
--ofelia-ok-soft --ofelia-ok-fg --ofelia-forgive   /* greens */
```

Light values, for reference:

```css
--ofelia-k-bg: oklch(0.86 0.07 25);   --ofelia-k-fg: oklch(0.42 0.13 27);
--ofelia-l-bg: oklch(0.87 0.06 215);  --ofelia-l-fg: oklch(0.42 0.1 225);
--ofelia-ok-soft: oklch(0.95 0.05 155); --ofelia-forgive: oklch(0.55 0.13 155);
```

**Both light and dark themes are required.** The board switches via `:root[data-theme='dark']`.

Current type scale in these panels runs small — 0.625–0.8125 rem — with mono used for timestamps.
Keep that density: the large tier shows roughly 6–10 history rows at once, and that should not get
worse.

## Constraints

- Static markup and CSS only. No JavaScript behaviour, no animation libraries. Transitions are fine.
- The implementation uses CSS Modules with plain class names — no utility-class framework, no
  inline style objects.
- Icons come from `lucide-react`. Name any icon you use.
- Both columns scroll independently and can be long; the composer stays pinned below the comment
  list.
- Do not redesign: the week strip, the selected-day panel, the debt balance block, the action
  buttons, or the widget header chrome. They are shown only as context.

## Deliverable

A single self-contained HTML mockup, in the same form as the earlier mockups for this widget
(`docs/superpowers/specs/assets/2026-06-23-ofelia-large.html`), showing:

1. The **large** tier — both columns side by side, populated with a realistic mixed ledger: a plain
   cleaned day, a cleaned-on-behalf-of day, a day that went into debt, a forgiven day, and one day
   that carries three entries where two are superseded. Include one legacy-author row and one
   late-recorded row.
2. The **fullscreen** tier at full width.
3. The **mobile** width with the tab switch, both tabs.
4. Both themes.

Annotate which state each variant demonstrates.
