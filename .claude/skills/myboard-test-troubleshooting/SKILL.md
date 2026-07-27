---
name: myboard-test-troubleshooting
description: Use when a myboard test run or tooling invocation misbehaves on this machine — pnpm or node reported as not found or "Access is denied", `pnpm --filter client test` hangs or prints nothing useful, a Vitest path filter matches no files, "Temporal is not defined", ERR_REQUIRE_ESM from html-encoding-sniffer or @exodus/bytes, a Reatom effect that never fires after context.reset(), or typecheck failing in an untouched file.
---

# Test and tooling troubleshooting

Read `docs/agent/test-troubleshooting.md` in this repository. It is indexed by symptom — find the
error you actually saw and apply that entry.

These are environment problems. Do not start debugging the code under test until the entry for your
symptom has been ruled out.
