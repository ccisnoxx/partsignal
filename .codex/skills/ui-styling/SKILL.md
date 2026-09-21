---
name: ui-styling
description: Maintain PartSignal's canonical frontend visual system, responsive layouts, themes, Base UI/shadcn components, and accessibility. Use only for UI work under this repository's `frontend/`; do not use for generic React work, image generation, or initializing a new component stack.
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# PartSignal UI Styling

Use this entry for PartSignal's existing canonical frontend. Read `frontend/AGENTS.md` first, then load only the specification relevant to the change:

- visual roles, tokens, theme, responsive layout or accessibility: `.trellis/spec/frontend/visual-system.md`
- component composition, tables and interaction patterns: `.trellis/spec/frontend/component-guidelines.md`
- browser and quality acceptance: `.trellis/spec/frontend/quality-guidelines.md`
- architecture or task-specific design: route from `docs/frontend-v2/README.md`

## Current stack and boundaries

- The maintained stack is React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui components backed by Base UI, and the repository's own Design System.
- Inspect `frontend/package.json`, `frontend/components.json`, existing primitives and tokens before changing dependencies or component structure.
- Do not assume Radix APIs, initialize shadcn/Tailwind, switch primitive libraries, or run generic component installers as setup. Add or update a component only when the task requires it and the current registry/configuration has been verified.
- Reuse existing `design-system` tokens and patterns. Domain state, permissions and action eligibility stay outside the Design System; the server's typed action projection remains authoritative.
- Preserve semantic HTML, keyboard operation, focus lifecycle, accessible names, reduced-motion behavior, contrast and responsive content priority according to the actual Base UI/component API in use.
- Visual verification should cover only affected breakpoints, themes and interactions. Canvas or image generation is a separate deliverable and is not part of this skill unless the user requests it.

## Optional background references

The bundled references are generic background, not PartSignal contracts. Read one only when the current repository specs and implementation do not answer the question:

- `references/tailwind-utilities.md` and `references/tailwind-responsive.md` for Tailwind syntax
- `references/tailwind-customization.md` for Tailwind configuration
- `references/shadcn-components.md` and `references/shadcn-theming.md` for shadcn concepts
- `references/shadcn-accessibility.md` for general accessibility concepts; verify primitive-specific behavior against Base UI
- `references/canvas-design-system.md` only for an explicitly requested canvas deliverable

The legacy scripts remain available for compatibility but are not the default workflow. Before running them, inspect their behavior against the current `components.json`, installed versions and requested scope.
