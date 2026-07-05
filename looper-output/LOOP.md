# device-invite-webauthn-gate

Drive the Superpowers workflow (writing-plans -> subagent-driven implementation -> verification -> finishing-a-development-branch) to implement the approved device-invite + WebAuthn access-gate spec, with a Codex correctness gate and a Claude /security-review security gate.

## Goal

Implement the device-invite + WebAuthn access-gate spec end-to-end using the Superpowers flow. The spec is already written, so the loop starts at writing-plans: produce an implementation plan organized as two phases (Phase 1 dormant auth backend + activation page with the gate OFF; Phase 2 enable the nginx auth_request gate + hardening), then implement each plan task via the sonnet-superpowers-implementer subagent while the Opus host orchestrates. Finish as a pull request.

## Definition of Done

Every plan task is implemented; `pnpm check` is green; the auth end-to-end suite (`pnpm test:e2e:docker`) is green; Codex review finds no blocking correctness issue; `/security-review` reports no High or Critical finding and every control in the spec's Hardening section is present; the branch is finished as a PR; and there are no unresolved TBDs.

## Verification

- `plan-covers-spec` (judge)
- `repo-gate` (programmatic)
- `codex-correctness` (judge)
- `security-clean` (judge)
- `e2e-auth` (programmatic)
- `publish-signoff` (human)

## Council

- `codex-review`: judge via codex (gpt-5.5)

## Gates

- Plan gate: revise_until_clean
- Delivery gate: revise_until_clean

## Loop Control

- Max iterations: 16
- Budget: `{"tokens": 4000000, "usd": 25.0, "wall_clock_min": 600}`
- No-progress: `{"action": "human_checkpoint", "max_stalled_iterations": 2, "signals": ["same blocking issue repeats across iterations", "delivery artifact has no material change", "the same check output is unchanged after a revision"]}`

## Execution Boundary

- Mode: `in_session`
- Isolation: `branch`
- Side effects: `{"duplicate_action_check": true, "requires_approval": true}`

## Observability

- State file: `state.json`
- Run log: `run-log.md`
- Checkpoint granularity: `gate`

## Flow Preview

```text
+--------------------------------+
| 1. Goal + context              |
| read sources                   |
+--------------------------------+
               |
               v
+--------------------------------+
| 2. Draft plan.md               |
| state -> state.json            |
+--------------------------------+
               |
               v
+--------------------------------+
| 3. Plan gate                   |
| verdict: codex-review          |
+--------------------------------+
               | needs work -> revise <= 3 -> step 2
               | pass
               v
+--------------------------------+
| 4. Write delivery-N.md         |
| log -> run-log.md              |
+--------------------------------+
               |
               v
+--------------------------------+
| 5. Delivery gate               |
| verdict: codex-review          |
+--------------------------------+
               | needs work -> revise <= 3 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 16 iterations | no progress x2 | budget 600m, $25.0, 4000000 tokens
```
