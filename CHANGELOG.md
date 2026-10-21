# Changelog

## v0.1.0 (2026-10-21)

First tagged release. Idempotency for Next.js Server Actions: the same key and input replay the stored result, a different input returns a mismatch, and an in-flight duplicate returns a conflict.

- Add once-action so a repeated Server Action key replays its stored result.
- Scope keys per user, bound the memory store, fix lockfile, add ESLint
