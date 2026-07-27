---
name: myboard-deploy
description: Use when deploying myboard to the Raspberry Pi, running rpi deploy or rpi secrets push, editing rpi.toml / rpi.dev.toml / rpi.branch.toml, using the shared branch stand at board-branch.iiskelo.com, releasing dev into main, or when a deploy fails on a missing or empty secret group, a stale environment, or "Permission denied (publickey)" while cloning.
---

# Deploying myboard

Read `docs/agent/deployment.md` in this repository and follow it. It covers the three deploy
targets, the release flow after a PR merges, the shared branch stand, and how the secret groups are
layered.

Generic `rpi` CLI and `rpi.toml` semantics are not repeated there — use the `rpi:rpi-cli` and
`rpi:rpi-toml` skills for those.
