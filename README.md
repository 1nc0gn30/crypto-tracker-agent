# Crypto Tracker Agent

Production-ready React + Vite dashboard for live crypto market monitoring, relational analytics, and historical chart exploration.

## What This App Does
- Streams live USD prices + 24h change for a curated set of major crypto assets.
- Builds a rolling in-memory market history snapshot every minute.
- Computes market structure metrics: breadth, volatility, divergence pairs, rolling correlations, leaders/laggards, and dominance share.
- Provides per-asset historical deep-dive charts (price, market cap, volume, return pulse) from CoinGecko hourly data.
- Generates a local rule-based market signal (`BUY` / `SELL` / `HOLD`) from breadth/regime conditions.
- Exports a tax/compliance-style JSON snapshot of current market state.

## Stack
- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Lucide React icons
- CoinGecko public API
- Netlify deploy target (`netlify.toml`)

## Project Design

### 1. Runtime Layout
- Entry: `src/main.tsx`
- Core app: `src/App.tsx`
- Styling: `src/index.css`
- Static assets: `public/`
- SEO shell + metadata: `index.html`

### 2. Data Pipeline
1. `fetchData()` loads current prices and 24h changes from CoinGecko `simple/price`.
2. Data is normalized into a `MarketSnapshot`.
3. Snapshot is appended to rolling in-memory history (`HISTORY_CAP`).
4. `buildIntelligence()` derives analytics from current snapshot + history.
5. UI cards and sidebar are rendered from computed intelligence.
6. On asset click, `fetchCoinHistory()` loads 14-day hourly market chart series for deep-dive charts.

### 3. Analytics Model
The app computes:
- **Breadth**: count of assets with non-negative 24h change.
- **Average move** and **cross-asset volatility** from 24h returns.
- **Momentum** per coin from recent rolling history.
- **Divergence pairs** from absolute spread between coin 24h changes.
- **Rolling correlations** from per-interval return series.
- **Dominance share** from normalized aggregate tracked prices.
- **Regime label** (`Risk-On Expansion`, `Risk-Off Compression`, `Mixed Rotation`).

### 4. Rule-Based Signal Engine
`buildMarketSignal()` computes a deterministic signal:
- `BUY` when breadth + average move are strongly positive.
- `SELL` when breadth + average move are strongly negative.
- `HOLD` in mixed/choppy regime.

Each signal includes:
- confidence score
- concise reason
- risk note

No external LLM or API key is used.

### 5. UI Composition
- **Header panel**: app identity, refresh action, status chips.
- **Main grid**: tracked assets with micro-sparklines and quick stats.
- **Insight blocks**: breadth, divergences, correlations.
- **Sidebar**: market signal + export tools.
- **Deep-dive mode**: focused coin view with four interactive charts.

### 6. Visual System
- Dark, high-contrast glass panels.
- Cyan/emerald/amber semantic accent palette.
- Low-overhead micro animation and hover behavior.
- Responsive layout from mobile through desktop.
- Pointer-glow effect disabled automatically for coarse pointers / reduced-motion contexts.

## SEO and Domain Settings
Configured for the production canonical host:
- Canonical URL: `https://crypto.757tech.pro/`
- OG/Twitter URL/image paths aligned to `crypto.757tech.pro`
- Robots sitemap URL aligned to `https://crypto.757tech.pro/sitemap.xml`

## Local Development
### Prerequisites
- Node.js 20+
- npm

### Run
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validation Commands
```bash
npm run lint
npm run build
```

## Deployment (Netlify)
This repo already includes `netlify.toml`:
- build command: `npm run build`
- publish directory: `dist`

Deploy by connecting the repo in Netlify or using CLI.

## File Guide
- `src/App.tsx`: market fetching, analytics, charts, interactions.
- `src/index.css`: global theme + effects.
- `index.html`: page metadata + canonical/OG/Twitter tags.
- `public/robots.txt`: crawler directives + sitemap location.
- `public/sitemap.xml`: sitemap root URL.
- `public/og-cover.svg`: social preview image.

## Notes
- Data uses public CoinGecko endpoints and may be rate-limited under heavy load.
- The app currently keeps analytics history in memory only (no persistent database).
