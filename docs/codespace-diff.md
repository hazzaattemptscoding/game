# Codespace copy vs cb28eb1

Status: cannot be produced from this repo.

- This working copy is clean and equal to `cb28eb1` on branch `claude/keen-rubin-ue6z6k`. Nothing to snapshot, so no `snapshot-before-pass-3` branch was made.
- `origin` has one branch (`claude/new-session-aoq8sl`) and it also points at `cb28eb1`. The Codespace edits were never pushed.
- So there is no file list to judge. The beliefs from the pass 3 prompt stay unverified:
  - long final corner split into a double apex: unverified (the report at s=3196 asks for it on `cb28eb1`, so it is likely still a request, not code)
  - surface types renamed to concrete, concrete outer, kerb: unverified
  - new barrier templates: unverified

To close this: push the Codespace copy to a branch (`git push origin HEAD:codespace-copy`) or paste `git diff cb28eb1` from it.

## Reports in reports/ (all say build cb28eb1, so they describe this code, not the Codespace one)

| s (m) | Where | Note | Maps to item |
|---|---|---|---|
| 1909 | Station Corner | "grass on track, see the debug top-down map" | A (3: gravel/grass over road at folds) |
| 1993 | Station Corner exit | "so many pointless barriers" | F |
| 3196 | Boundary Loop | "need more kerbs, turn this corner into a double apex" | I |
| 3814 | Start/finish, left | "blue, no surface on the left" (sky colour showing through, beside the pit lane) | A (5: holes), H |
