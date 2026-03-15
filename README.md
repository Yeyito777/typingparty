# TypingParty

A [Vencord](https://vencord.dev/) plugin that turns Discord's typing indicator into a live WPM-based rank system — with screen shake, confetti, rhythm bars, and dynamic rank badges right in the message bar.

## Features

- **Live WPM tracking** — calculates words per minute as you type
- **Rank system** — D → C → B → A → S → SS → SSS (maxes at ~200 WPM)
- **Rhythm bar** — shows how close you are to dropping a rank, not just the max
- **Screen shake** — intensity scales with your current rank
- **Confetti particles** — fire when you rank up
- **Oswald font** — clean, weighted display typography
- **Dynamic sizing** — indicator grows as rank increases

## Ranks

| Rank | WPM Threshold |
|------|--------------|
| D    | < 20         |
| C    | 20–39        |
| B    | 40–59        |
| A    | 60–79        |
| S    | 80–119       |
| SS   | 120–179      |
| SSS  | 200+         |

## Installation

1. Install [Vencord](https://vencord.dev/)
2. Go to `Settings → Vencord → Open Plugins Folder`
3. Copy `index.tsx` into a `typingparty/` folder there
4. Rebuild Vencord or restart Vesktop

## Settings

- **Enable Confetti** — toggle confetti particles on rank-up
- **Enable Screen Shake** — toggle shake effect (GPU-accelerated, minimal perf impact)

## License

GPL-3.0-or-later
