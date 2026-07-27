---
name: myboard-widget-server
description: Use when writing or changing a widget's server.ts under packages/widgets/* — request handlers, Zod schemas, cron jobs, records that carry an author or accountId, the WidgetServerContext viewer, or a choice between the widget dispatch route and POST /api/storage/:key/append.
---

# Widget server functions

Read `docs/agent/widget-server.md` in this repository and follow it. It covers why authored records
go through the widget's own `server.ts`, what the generic storage route does and does not guarantee,
the cron contract (idempotent handlers, no viewer), and the bundling constraint that keeps shared
logic in `domain/`.
