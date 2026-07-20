# Skill: Design System

## Philosophy
Design like a senior at a boutique studio — every decision traceable to the product's purpose.
If the same UI could ship in any SaaS product unchanged, it's not distinctive enough.

### Explicitly Avoid
- Generic purple-gradient dashboard hero sections
- Box-shadow on every card (use spatial separation instead)
- Icon spam (icons assist text, never replace it)
- Inter + rounded-xl + teal accent (someone else's brand)
- Glassmorphism and glow effects as decoration
- Borders on every container

---

## Design Tokens

### Spacing
```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-6: 24px;  --space-8: 32px;  --space-12: 48px; --space-16: 64px;
```

### Type Scale
```css
--text-xs: 12px/1.5;  --text-sm: 13px/1.5;  --text-base: 15px/1.6;
--text-lg: 17px/1.5;  --text-xl: 20px/1.3;  --text-2xl: 24px/1.2;
--text-3xl: 30px/1.15; --text-4xl: 36px/1.1;
```
Weights: 400 body / 500 label+caption / 600 subheading / 700 display only.

### Radius
```css
--radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 12px;
--radius-xl: 16px; --radius-full: 9999px;
```

### Motion
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.87, 0, 0.13, 1);
--duration-fast: 120ms;  --duration-base: 200ms;  --duration-slow: 350ms;
```

---

## Color Rules
- Define 4–6 base hex values per project, derive all others as tints/shades.
- Semantic tokens: `--color-primary`, `--color-surface`, `--color-border`, `--color-muted`, `--color-danger`, `--color-success`.
- Never hardcode hex in component files — CSS vars or Tailwind semantic tokens only.
- Every component works in both light and dark mode before it's marked done.
- Color is never the sole information carrier — pair with text, icon, or pattern.

---

## Component Rules
- All 5 interactive states: `default → hover → focus → active → disabled`.
- All 4 state variants: `empty → loading → error → populated` — except a component that renders
  synchronously from data its parent already fetched (no fetch/async of its own) legitimately
  only needs `empty → populated`; see `ui-component`'s state-variants section for the exact test.
- Empty state = invitation to act, not a blank screen.
- Loading = skeleton (preserves layout) over spinner (blocks space).
- Focus: `focus-visible:ring-2 focus-visible:ring-ring` — never `outline-none` alone.
- Hierarchy through scale and weight, not decoration.
- No `margin-top` on first child / `margin-bottom` on last child — parent handles padding.

---

## Accessibility (non-negotiable)
- Semantic HTML: `<article>`, `<nav>`, `<button>` — not `<div onClick>`.
- All interactive elements keyboard-reachable.
- WCAG AA: 4.5:1 contrast for body text, 3:1 for large text.
- `alt` always. Decorative images: `alt="" aria-hidden="true"`.
- Icon-only buttons: `aria-label` required.
- Mobile-first: base → `md:` → `lg:`. Test at 375px.
