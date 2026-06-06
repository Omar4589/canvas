# Theming — light & dark mode and the design tokens

How every screen in the web app (`client/`) gets its color, and how light/dark mode works. The whole UI is built from a small set of **semantic tokens** that flip between light and dark in one place, so individual components never hard-code colors.

Related: [components/ui/Input.jsx](../client/src/components/ui/Input.jsx) (the shared form fields that bake in the right tokens); this underpins every feature in the [docs index](README.md).

## Part 1 — For everyone

The app has a **light** and a **dark** theme.

- **Switching:** use the light/dark toggle in the app. Your choice is saved on that device.
- **First run:** if you've never chosen, the app follows your device/OS setting — a phone or computer already in dark mode opens dark.
- **No flash:** the saved theme is applied before the page paints, so you never see a flash of the wrong theme while loading.
- **The public marketing site stays light** regardless of the app theme — only the signed-in app responds to the toggle.

That's all most people need; the rest is for developers.

## Part 2 — Technical reference

### How the flip works
- Tailwind runs in **class** dark mode (`darkMode: 'class'` in [tailwind.config.js](../client/tailwind.config.js)). Dark is active whenever `<html>` has the `dark` class.
- Colors are **CSS custom properties** in [index.css](../client/src/index.css), written as channel-triplet RGB (e.g. `--card: 255 255 255`) so Tailwind's `rgb(var(--x) / <alpha-value>)` opacity utilities work. Light values live in `:root`; `html.dark` redefines the same variables with dark values. Flipping the one `dark` class restyles the entire app.
- Tailwind color keys map to those variables via the `ch()` helper in `tailwind.config.js`, so `bg-card`, `text-fg`, `border-border`, etc. resolve to the right value automatically.
- A base rule sets the **default border color** to `--border` (`* { border-color: rgb(var(--border)) }`), so even a bare `border` utility themes correctly.
- `:root` / `html.dark` also set **`color-scheme`** (`light` / `dark`). This is what makes the browser's **native controls** (scrollbars, date pickers, the input caret) and CSS **system colors** render in the right scheme — most importantly an input's default `background-color: field`. Without `color-scheme: dark`, any control that has no explicit `bg-*` falls back to the white `field` system color and stays white in dark mode (this is what made the walk-list multi-select inputs render white). So: give controls a token background **and** rely on `color-scheme` for the native bits.
- `.theme-light` re-pins the light values; the public marketing site wraps itself in it to stay light regardless of the global theme.

### Where the `dark` class comes from
- **Before paint:** an inline script in [index.html](../client/index.html) reads `localStorage('theme')` — or, if unset, the OS `prefers-color-scheme` — and adds `dark` to `<html>` synchronously. This is the no-flash step.
- **At runtime:** [useTheme.js](../client/src/lib/useTheme.js) reads that state; its `toggle()` flips the `dark` class on `<html>` and persists the choice back to `localStorage('theme')`.

### Token reference
All values are defined in [index.css](../client/src/index.css). Always use the **Tailwind key** (e.g. `bg-card`), never a raw gray.

Surfaces:

| Key | Light | Dark | Use |
|---|---|---|---|
| `surface` | `#F9FAFB` | `#0B0F19` | page background |
| `card` | `#FFFFFF` | `#111827` | cards, panels, modals, **form inputs** |
| `raised` | `#FFFFFF` | `#1F2937` | popovers, menus (lifted above card) |
| `sunken` | `#F3F4F6` | `#0F1420` | table headers, wells, skeletons, locked/disabled fields |

Text:

| Key | Light | Dark | Use |
|---|---|---|---|
| `fg` | `#111827` | `#E5E7EB` | primary text |
| `fg-muted` | `#6B7280` | `#9CA3AF` | secondary text, labels |
| `fg-subtle` | `#9CA3AF` | `#6B7280` | tertiary text, **placeholders** |
| `fg-inverse` | `#FFFFFF` | `#111827` | text on an inverted background |

Borders:

| Key | Light | Dark | Use |
|---|---|---|---|
| `border` | `#E5E7EB` | `#272E3C` | dividers, card borders (also the default border color) |
| `border-strong` | `#D1D5DB` | `#374151` | input/control borders |

Brand + focus:

| Key | Light | Dark | Use |
|---|---|---|---|
| `brand-accent` | `#DC2626` | `#EF4444` | accent text, focus border (`focus:border-brand-accent`) |
| `brand-hover` | `#B91C1C` | `#F87171` | hover accent |
| `brand-tint` | `#FEF2F2` | `#3F1414` | selected / active washes |
| `brand-tint-fg` | `#B91C1C` | `#FCA5A5` | text on `brand-tint` |
| `brand-fg` | `#FFFFFF` | `#FFFFFF` | text on a solid brand fill |
| `ring` | `#DC2626` | `#F87171` | focus ring (`focus-visible:ring-ring`) |

Status colors — `success`, `warning`, `danger`, `info` — each come as the base color plus `-fg` (readable text) and `-tint` (soft background), e.g. `text-danger`, `bg-danger-tint`. Light bases: success `#16A34A`, warning `#D97706`, danger `#DC2626`, info `#2563EB`. The dark variants are lifted for contrast; see [index.css](../client/src/index.css) for exact values.

### The fixed brand ramp (does NOT flip)
`tailwind.config.js` also defines a literal `brand.*` red ramp (`brand-50` … `brand-900`, e.g. `bg-brand-600`, `hover:bg-brand-700`). These are fixed hex values that stay identical in both themes — use them only for solid, fixed-contrast brand buttons (white text on red). For anything that should adapt to the theme, use the semantic tokens above.

### The rule (why this doc exists)
Build every surface and control from the **semantic tokens** — never hard-coded grays or hex. In particular, **every form control** (`<input>`, `<select>`, `<textarea>`, search boxes) must carry a themed background and text:

```
bg-card text-fg placeholder:text-fg-subtle
```

The simplest way is to use the shared components in [components/ui/Input.jsx](../client/src/components/ui/Input.jsx) — `<Input>`, `<Select>`, `<Textarea>` — or its exported `FIELD_CLS` constant, which already bake in the full field treatment.

A control written as a bare `border border-border-strong px-3 py-2 …` with **no `bg-card`** looks fine in light mode (the browser default is white) but renders **white in dark mode** — it never flips. That single omission caused a sweep of ~17 files' worth of fields to be patched; new fields should not reintroduce it.

### Gotcha — conditional backgrounds
When a field swaps its background for a state (locked, invalid, disabled), make sure **only one** `bg-*` utility is ever applied. Stacking `bg-card` from a base string under a conditional `bg-sunken` leaves two background utilities on the element, and which wins is not guaranteed by class-string order. Express the background as a single ternary instead:

```
locked ? 'bg-sunken text-fg-muted' : 'bg-card'
```

### Gotcha — browser autofill
Chrome/Safari paint their own background on autofilled fields (`:-webkit-autofill`) — white/pale — which ignores `bg-card` and stays light in dark mode, so a field you've typed into before can look white even though the control is themed. CSS can't override that background normally; the only reliable fix is a box-shadow inset, applied globally in [index.css](../client/src/index.css):

```css
input:-webkit-autofill, textarea:-webkit-autofill, select:-webkit-autofill {
  -webkit-text-fill-color: rgb(var(--fg));
  -webkit-box-shadow: 0 0 0 1000px rgb(var(--card)) inset;
}
```

For tokenizing/search inputs that shouldn't be autofilled at all (e.g. the walk-list chip filters), also set `autoComplete="off"`.

### Adding a new surface or field — checklist
- Background: `bg-surface` (page), `bg-card` (panel/field), `bg-raised` (popover), `bg-sunken` (well / locked).
- Text: `text-fg`, with `text-fg-muted` / `text-fg-subtle` for secondary / placeholder.
- Border: `border` (default) or `border-border-strong` (controls).
- Focus: `focus:border-brand-accent focus-visible:ring-2 focus-visible:ring-ring/30`.
- Form control? Prefer `<Input>` / `<Select>` / `<Textarea>` (or `FIELD_CLS`). If hand-rolling, include `bg-card text-fg placeholder:text-fg-subtle`.
- Never hard-code a gray/hex. If a token is missing, add it to `index.css` (both `:root` and `html.dark`) and map it in `tailwind.config.js`.

### Source files
- [client/tailwind.config.js](../client/tailwind.config.js) — `darkMode: 'class'`, token → variable mapping, the fixed brand ramp.
- [client/src/index.css](../client/src/index.css) — token values (light `:root` / dark `html.dark`), the default border rule, `.theme-light`.
- [client/index.html](../client/index.html) — the no-flash pre-paint script.
- [client/src/lib/useTheme.js](../client/src/lib/useTheme.js) — the runtime toggle + persistence.
- [client/src/components/ui/Input.jsx](../client/src/components/ui/Input.jsx) — `FIELD` / `FIELD_CLS` and the shared `<Input>` / `<Select>` / `<Textarea>`.
