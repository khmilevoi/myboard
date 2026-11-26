# Design

The canonical design for myboard is the claude.ai design project
**<https://claude.ai/artifact/QTRV3d6h8heE2xt3kVeXBX>** (private to its owner — share it from its Share
menu before sending the link to anyone else).

This folder is a snapshot of that project's `project/` files, kept in the repository so agents and
reviewers can read the design without access to claude.ai. The artifact is the source of truth: when
the two disagree, the artifact wins.

## What is here

| File | What it owns |
| --- | --- |
| `00 Навигация.dc.html` | Entry point: the map of every page and component, and which file owns which topic |
| `01 Дизайн-система.dc.html` | Tokens (light/dark), typography, radii, shadows, buttons, inputs, avatars, widget shell and tiers |
| `02`–`04` | Sign-in and activation, devices and account, the board |
| `05 Виджет - Лоток Офелии.dc.html` | "Litter" widget flow, one card per litter (component `OpheliaLarge.dc.html`) |
| `06 Виджет - Паспорт-чекер.dc.html` | Passport-checker widget flow |
| `07`, `08` | Explorations not yet folded into their owner files (component `OfeliaPanels.dc.html`) |
| `09 Виджет - Офелия питание.dc.html` | "Ofelia: food" widget flow (component `OfeliaFoodLarge.dc.html`) |
| `10 Виджет - Кошки.dc.html` | "Cats" widget flow: cat passport, profile, weight, daily goal, litter, archive (component `CatsLarge.dc.html`); the cat avatar and switcher live in `01`, section 06а |
| `11 Виджет - Вес.dc.html` | "Weight" widget flow: the owner's latest weight and trend from the `health` module |
| `12 Оборудование.dc.html` | Hardware: the gateway on the Pi, pairing the scale, scale profiles and consent codes |
| `compat.json` | The page list, as the design project holds it |
| `support.js` | The `.dc.html` runtime the pages load |

Pages are `.dc.html` design components: plain HTML plus a small template syntax, rendered by
`support.js`. Read them as markup; they are not built or served by the app.

## Rules

- Build UI from the design system page, not from these files' inline values. Where the code already
  has a convention the design does not show, the code wins and the design is updated to match (for
  example, account avatars are `MemberAvatar`'s rounded squares, not circles).
- One topic, one owner file — see the ownership table in `00 Навигация.dc.html`. New widgets get a
  numbered page plus a card on the navigation page.
- Change the design in the artifact first, then sync it here in a separate commit
  (`chore(design): sync from artifact`). Never edit these files only locally.

## Syncing

Copy every file under the artifact's `project/` into this folder, except editor leftovers
(`screenshots/`, `uploads/`). With Claude, read each path from the artifact with the Artifact tool and
copy the saved files here; `compat.json` lists the pages and components.
