# CompactTier Redesign

## Goal

Bring `CompactTier` in line with the approved reference card:

- compact header with title and visible expand/delete actions
- dense actor block with avatar, name, and soft subtitle chip
- one full-width primary action
- two secondary actions in a two-column row
- no debt summary row in this tier

## Scope

Only `client/widgets/ofelia-poop-duty/ui/tiers/CompactTier.*` and the minimum shared button styling needed to support the compact card layout.

No changes to:

- `LargeTier`
- `FullscreenTier`
- `StandardTier`
- `TinyTier`
- business logic or action behavior

## Approved Layout

Top to bottom:

1. `OfeliaMiniHeader`
2. actor row:
   - avatar on the left
   - name and subtitle chip on the right
3. full-width primary action button
4. two-column row of secondary actions

The compact card should not reserve empty center space. Content should stay visually grouped in the upper and middle area, matching the reference.

## Content Rules

- Title stays `Лоток Офелии`
- Subtitle under the actor stays based on current state
- `DebtChips` is removed from `CompactTier`
- Secondary label `В долг` is renamed to `Отложить` in this tier only if needed for visual parity with the reference; behavior remains the same

## Styling Rules

- Use a tight vertical stack with deliberate spacing between header, actor block, and actions
- Primary action spans full width
- Secondary actions share the row equally
- Subtitle is rendered as a soft pill, not plain text
- Avoid large empty flex gaps or `margin-block-start: auto` that push actions to the bottom edge

## Implementation Notes

- Prefer local `CompactTier` layout changes over broad shared refactors
- Reuse existing action logic
- If shared action components need styling hooks, keep them additive via `className`
- Do not introduce a new visual pattern for other tiers as part of this work

## Validation

- `CompactTier` visually matches the approved screenshot structure
- expand and delete remain visible
- confirm/debt/forgive actions still trigger the same handlers
- future-day disabled behavior is preserved
