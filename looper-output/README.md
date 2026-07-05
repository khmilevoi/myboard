# Looper: `device-invite-webauthn-gate`

A Looper-designed agent loop that drives the **Superpowers workflow** to
implement the approved device-invite + WebAuthn access-gate spec
(`docs/superpowers/specs/2026-07-05-device-invite-webauthn-gate-design.md`).

## What it does

The spec is already written (brainstorming done), so the loop maps the
Superpowers flow onto Looper's plan → delivery structure:

| Looper stage | Superpowers step |
|--------------|------------------|
| Draft `plan.md` | `writing-plans` on the spec (two phases: dormant backend + activation, then gate + hardening) |
| Plan gate | Codex judge checks the plan covers the spec and cannot lock us out |
| Delivery-N | `sonnet-superpowers-implementer` subagent implements a task (TDD); Opus stays orchestrator |
| Delivery gate | `pnpm check` + Codex correctness review + Claude `/security-review` |
| Finish | `finishing-a-development-branch` → PR after the human `publish-signoff` |

## Gates

- **plan_gate** (`after_plan`): judge `codex-review`, `revise_until_clean`,
  criteria `plan-covers-spec`, max 3 revisions.
- **delivery_gate** (`after_each_delivery`): judge `codex-review`,
  `revise_until_clean`, criteria `repo-gate` (`pnpm check`),
  `codex-correctness`, `security-clean` (`/security-review`), max 3 revisions.
- **Human checkpoints:** approve `plan.md` before coding; `publish-signoff`
  (plus `pnpm test:e2e:docker`) before enabling the nginx gate / going public.
- **Stops:** all gates clean + publish-signoff · max 16 iterations ·
  no-progress ×2 · budget (wall-clock 600 min).

## Files

- `loop.yaml` — editable source spec.
- `loop.resolved.json` — compiled spec read by the runner.
- `LOOP.md` — human-readable rendering + ASCII flow preview.
- `RUN_IN_SESSION.md` — **the default handoff**: ask the current session to follow it.
- `run-loop.py` — advanced external executor.
- `loop-workspace/` — runtime handoff files (`plan.md`, `delivery-{n}.md`,
  `review-{n}.md`, `security-{n}.md`, `state.json`, `run-log.md`).

## Run now (recommended)

Ask the current Claude Code session to follow `RUN_IN_SESSION.md`. This keeps
design and execution in one conversation and lets Opus dispatch the
`sonnet-superpowers-implementer` subagent for each delivery.

## Run outside the session (advanced)

```bash
# Windows: `python3` may not resolve — use `python`, run from this folder.
python run-loop.py
```

The runner invokes only the argv arrays in `loop.resolved.json`. It is not a
durable orchestrator; use one for scheduled runs, step-level retry, or
concurrency.

## Privacy / egress

`codex-review` is **cross-vendor**: it sends the plan, delivery notes, and
branch diff to the local `codex` CLI → your OpenAI account. Redaction globs:
`.env`, `.env.*`, `secrets/**`, `**/*.key`, `**/.env*`. Consent was granted by
the user on 2026-07-05. `/security-review` and the host run on Claude (same
vendor, no new egress).

## Isolation

`in_session` on branch `feat/device-invite-webauthn-gate` (the spec is already
committed there). Side-effecting actions (push, PR, dockerized e2e, Codex
sends) require approval.
