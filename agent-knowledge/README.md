# Agent Knowledge Base

Architecture documentation for future Claude Code sessions working in this repo. Read the
relevant part(s) before making non-trivial changes — this exists so a fresh session doesn't have
to re-derive the whole codebase from scratch, and so it doesn't trust the stale top-level
[README.md](../README.md), which predates most current features.

These docs describe **behavior as observed in the code**, not aspirations — where something looks
unfinished, duplicated, or dead, that's called out explicitly rather than smoothed over. When you
change code that a doc describes, update the doc in the same session.

| Part | File | Status | Covers |
|---|---|---|---|
| 1 | [01-client.md](01-client.md) | Done (2026-09-11) | Three.js scene/game loop, input handling, UI panel layer, level editor |
| 2 | [02-server.md](02-server.md) | Done (2026-09-11) | Express/Socket.io server, ECS World/Entities/Systems, auth, persistence, admin/room/asset management |
| 3 | [03-communication.md](03-communication.md) | Done (2026-09-11) | Socket.io wire protocol end-to-end: every event name, payload shape, and client↔server pairing |

## Conventions for these docs

- Written for an agent that has *not* read the source yet — file paths, class names, and line
  counts are given so claims can be spot-checked quickly.
- Call out duplication, dead code, and stale/misleading naming explicitly — that's exactly the
  kind of thing that wastes a fresh session's time if left undocumented.
- Don't restate what's obvious from good naming; do explain non-obvious cross-file coupling,
  ownership handoffs (e.g. two systems that both think they own the same state), and anything a
  reasonable reader would get wrong on first guess.
