# Run `device-invite-webauthn-gate` In This Session

Use this prompt when the user wants to run the Looper-designed loop in the current LLM session.
This is the default/easy execution path. The Python runner is the advanced path for running later or outside the session.

## Operator Instructions

You are executing a Looper-designed loop in this current session.
Follow the resolved spec below, write handoff files into the workspace, and enforce the caps manually.
Do not use `run-loop.py` unless the user explicitly asks for the advanced external runner.

1. Create the workspace directory if it does not exist.
2. Read the context sources before drafting the plan.
3. Draft `plan.md` in the workspace.
4. Run the plan gate. Apply programmatic checks when available. For judge criteria, use the configured judge only after consent for any non-local egress; otherwise ask the user to approve a human/current-session substitute.
5. Revise until the gate passes or `max_revisions` is reached.
6. Produce `delivery-N.md` in the workspace.
7. Run the delivery gate after each delivery.
8. Stop when all delivery criteria pass, a cap is reached, or the user stops the loop.
9. Keep `state.json` current with status, iteration, last gate, consent, and blockers.
10. Append a compact entry to `run-log.md` after every context read, model call, check, gate verdict, revision, blocker, and stop decision.
11. Compare each blocker against the previous blocker. If the same blocker repeats for the configured no-progress window, stop or ask for the configured human checkpoint instead of revising again.
12. Treat token and USD budgets as operator limits in this session: if exact accounting is unavailable, stop and ask before continuing when the loop appears likely to exceed them.

## Files

- Source spec: `loop.yaml`
- Human summary: `LOOP.md`
- Resolved spec: `loop.resolved.json`
- Workspace: `./loop-workspace`
- State file: `state.json`
- Run log: `run-log.md`

## Goal

Implement the device-invite + WebAuthn access-gate spec end-to-end using the Superpowers flow. The spec is already written, so the loop starts at writing-plans: produce an implementation plan organized as three plans (Plan 1 dormant auth backend + activation + account creation, gate OFF; Plan 2 accounts & multi-device: add-device QR/scan + pending-approval + the My-devices panel, gate OFF; Plan 3 enable the nginx auth_request gate + hardening), then implement each plan task via the sonnet-superpowers-implementer subagent while the Opus host orchestrates. Finish as a pull request.

## Definition Of Done

Every plan task is implemented; `pnpm check` is green; the auth end-to-end suite (`pnpm test:e2e:docker`) is green; Codex review finds no blocking correctness issue; `/security-review` reports no High or Critical finding and every control in the spec's Hardening section is present; the branch is finished as a PR; and there are no unresolved TBDs.

## Context Sources

- Read file `./docs/superpowers/specs/2026-07-05-device-invite-webauthn-gate-design.md`
- Read file `./AGENTS.md`
- Read file `./CLAUDE.md`

## Verification Criteria

- `plan-covers-spec` judge rubric: Judge loop-workspace/plan.md against docs/superpowers/specs/2026-07-05-device-invite-webauthn-gate-design.md. Blocking issues only: any spec section (data model, endpoints, WebAuthn params, invite/ops scripts, hardening, testing) with no corresponding task; task ordering that would enable the nginx auth_request gate before the activation page and /api/auth endpoints are implemented and tested (lockout risk); missing tests-first (TDD) steps; or any unresolved TBD. Return the fenced JSON verdict.

- `repo-gate` programmatic: run `["pnpm", "check"]` and expect `exit_zero`
- `codex-correctness` judge rubric: Review the branch diff for this delivery. Blocking issues only: correctness/logic bugs; error handling that does not follow errore (no throwing; Error | T unions; instanceof narrowing); a race in invite consumption; incorrect WebAuthn verification (challenge, expected origin, RP ID, or sign-counter regression); or session/cookie handling bugs. Ignore style. Return the fenced JSON verdict.

- `security-clean` judge rubric: Judge against the /security-review skill output for the current branch plus the spec's Hardening section. Blocking issues: any High or Critical finding; or a missing hardening control - HttpOnly+Secure+SameSite cookies, a CSRF custom-header check on state-changing routes, rate limiting on /api/auth/*, single-use invites (atomic consume, hashed token only), single-use short-TTL WebAuthn challenges, sign-counter regression rejection, and no secrets committed. Return the fenced JSON verdict.

- `e2e-auth` programmatic: run `["pnpm", "test:e2e:docker"]` and expect `exit_zero`
- `publish-signoff` human signoff: Review the /security-review findings and the auth e2e evidence, then confirm the security posture is acceptable to enable the nginx auth_request gate and publish the board publicly.


## Council

- `codex-review` judge via `["codex", "exec", "--model", "gpt-5.5"]` (non-local; timeout 900s)

## Gates

### plan_gate

- When: `after_plan`
- Policy: `revise_until_clean`
- Verdict source: `codex-review`
- Criteria: `plan-covers-spec`
- Max revisions: `3`

### delivery_gate

- When: `after_each_delivery`
- Policy: `revise_until_clean`
- Verdict source: `codex-review`
- Criteria: `repo-gate, codex-correctness, security-clean`
- Max revisions: `3`

## Loop Control

- Max iterations: `24`
- Budget: `{"tokens": 4000000, "usd": 25.0, "wall_clock_min": 600}`
- No-progress: `{"action": "human_checkpoint", "max_stalled_iterations": 2, "signals": ["same blocking issue repeats across iterations", "delivery artifact has no material change", "the same check output is unchanged after a revision"]}`
- Human checkpoints: `Approve loop-workspace/plan.md before any implementation begins, publish-signoff: confirm security posture before enabling the nginx gate and going public`
- Stop conditions:
  - all deliveries pass the delivery gate clean and publish-signoff is granted
  - max_iterations reached
  - the same blocker repeats for 2 iterations
  - any budget cap exceeded

## Execution Boundary

- Mode: `in_session`
- Isolation: `branch`
- Side effects: `{"duplicate_action_check": true, "requires_approval": true}`

If the loop needs scheduled runs, child-agent lifecycle management, concurrency control, or restart-safe step retries, stop and tell the user this Looper spec should be handed to a durable orchestrator.

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

Use `state.json` for the latest resumable status and `run-log.md` for the append-only history of what happened.

## Privacy

- Before sending `plan, deliveries, branch_diff` to `codex-review`, confirm consent and apply redactions `.env, .env.*, secrets/**, **/*.key, **/.env*`.

## Start Now

If the user asked to run now, begin at step 1 under Operator Instructions and keep going until a stop condition is reached.
