# TypingParty

A [Vencord](https://vencord.dev/) plugin that turns Discord typing into a skating-game-style meter — rewarding speed, rhythm, and tricks with confetti, combos, multipliers, and a secret ultimate rank.

## Features

- **Style meter** — gain style points through typing speed and rhythm. Points drain over time; higher ranks drain faster.
- **Combo system** — every keystroke builds your combo. Milestones at 5x/10x/20x/35x/50x/75x/100x give bonus style + popups.
- **Multiplier** — tricks and challenges boost your multiplier (up to 5.0x). All style gains are multiplied. Decays over time.
- **Trick detection** — automatic tricks reward your typing patterns:
  - **Burst** — 6+ rapid-fire keys (< 90ms avg interval). +0.4x multiplier.
  - **Flow** — sustained rhythm consistency for 6+ strokes. +0.3x multiplier.
  - **Speed Demon** — 180+ WPM sustained for 3+ seconds. +0.6x multiplier.
  - **Rank Up** — climbing to B or higher. +0.3x multiplier.
- **Typing challenges** — MonkeyType-style phrases pop up at B rank and above. Type them character-perfect for massive style + 0.8x multiplier. Wrong key = soft fail. No penalty.
- **Rolling WPM** — 4-second sliding window, recalculated 10x/sec. Doesn't hard-reset on send.
- **Confetti** — particles burst from your caret. GPU-composited via a single shared `requestAnimationFrame` loop.
- **Screen shake** — chat area shakes at B rank and above. Intensity scales with rank.
- **Send celebration** — clean sends (no backspaces) trigger confetti bursts and streak popups.
- **Backspace forgiveness** — small penalty instead of full combo break.
- **Session summary** — shows modal rank, peak rank, high combo, and peak WPM after you stop.
- **Bar glow** — message bar glows at S rank and above.

## Ranks

| Rank  | Style Score | Vibe |
|-------|------------|------|
| D     | 0          | Just warming up |
| C     | 18         | Getting there |
| B     | 38         | Respectable — challenges start appearing |
| A     | 58         | Serious |
| S     | 78         | Elite |
| DEVIL | 92         | Brutal drain — you glimpse it, you don't live in it |

There's a secret rank beyond DEVIL. You'll know when you find it.

## Installation

### Vesktop (recommended)

1. Clone [Vencord](https://github.com/Vendicated/Vencord)
2. Copy `index.tsx` and `native.ts` into `src/plugins/typingparty/`
3. Run `pnpm build`
4. Copy the built files from `dist/` to `~/.config/vesktop/sessionData/vencordFiles/`
5. Restart Vesktop

### Files

- `index.tsx` — main plugin (renderer process): HUD, style meter, tricks, challenges, and all effects
- `native.ts` — Electron main process hook for audio autoplay bypass

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Confetti | On | Spawn confetti particles while typing |
| Enable Screen Shake | On | Shake the chat area based on rank |
| Shake Intensity | 1 | Screen shake cap (1 = subtle, 8 = full) |
| Confetti Density | 1 | Particles per keystroke |
| Combo Timeout | 3s | Seconds of inactivity before combo resets |
| Audio URL | SoundCloud link | Audio track for a certain something... |

## Performance

- Single shared `requestAnimationFrame` loop for all particles
- `transform:translate()` / `transform:scale()` for GPU-composited animation (no layout reflow)
- DOM elements cached at creation; Discord elements lazily cached with staleness checks
- Confetti and shake auto-suppress above 400 WPM
- Honored One effects use only opacity/transform animations (no `filter` animation, no `box-shadow` at scale)
- Drain loop runs at 10Hz, not per-keystroke

## License

GPL-3.0-or-later
