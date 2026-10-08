# Design skills

Added for the end-of-project review of the new HUD, menus and screens. Use them to critique and polish, not while the layout is still moving.

| Skill | Source | Use it for |
|---|---|---|
| impeccable | github.com/pbakaus/impeccable (Apache 2.0) | Design direction, critique, audit, polish, typography, colour, layout, UX copy |
| emil-design-eng, animate, animation-vocabulary, apple-design, review-animations, improve-animations, find-animation-opportunities, break-ui, prototype, pick-ui-library | github.com/emilkowalski/skills (MIT) | Motion, interaction feel, small details |
| taste-skill, redesign-skill, minimalist-skill, soft-skill, brutalist-skill, output-skill | github.com/Leonxlnx/taste-skill (MIT) | Visual direction and anti-generic checks, with variance, motion and density dials |
| interface-design | github.com/Dammyjay93/interface-design (MIT) | Product UI craft; saves decisions to `.interface-design/system.md` |

Licences are in `_licenses/`. The two commands in `.claude/commands/` (`design-review`, `design-deslop`) come from interface-design.

## Left out on purpose

- impeccable's `scripts/` launcher, its hooks and its sub-agents. The launcher downloads and runs a binary on first use and the hooks run on every edit. Its SKILL.md handles a missing launcher ("Launcher unavailable") by reading PRODUCT.md and DESIGN.md directly.
- emilkowalski: `write-swift`, `animate-expo`, `mobile-native`, `ask-sonner` (native and React Native, not this project).
- taste-skill: image-generation, stitch, brandkit and v1/GPT variants.

These are third-party prompts that steer what Claude writes. Read a skill before trusting it, and re-check after updating from upstream.
