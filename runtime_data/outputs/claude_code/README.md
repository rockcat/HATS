# Tic-Tac-Toe PWA

Single-player tic-tac-toe game with AI opponent. Progressive Web App with full offline support.

## Features

- **Single-player vs AI** — Play against intelligent opponent
- **Three difficulty levels:**
  - Level 1 (Easy): Random moves
  - Level 2 (Medium): Strategic blocking and positioning
  - Level 3 (Hard): Unbeatable minimax algorithm
- **Full PWA support:**
  - Offline playable (Service Worker caching)
  - Installable on mobile devices
  - Standalone app mode
- **Modern responsive UI** — Works on mobile, tablet, and desktop
- **Persistent difficulty selection** — Your choice saved in localStorage
- **Vanilla JavaScript** — No external dependencies (except Vite build tool)

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Build:** Vite
- **Server:** Express.js (local development)
- **PWA:** Service Worker, Web App Manifest

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Development

Run the development server with hot reload:

```bash
npm run dev
```

Server runs on `http://localhost:5173`

## Production Build

Build optimized production bundle:

```bash
npm run build
```

Outputs to `dist/` directory.

## Running Locally

Start the Express server to serve the built app:

```bash
npm run build
npm run server
```

Server runs on `http://localhost:3000`

## Offline Play

1. Build the app: `npm run build`
2. Start the server: `npm run server`
3. Open `http://localhost:3000` in your browser
4. Service Worker registers automatically and caches all assets
5. Close network connection (DevTools → Network → Offline) and play offline

## Install as App

On compatible browsers (Chrome, Edge, Firefox Android):

1. Open the app in browser
2. Click the "Install" button in address bar
3. App installs as standalone app on your device
4. Fully playable offline

## Game Rules

- You are **X**, AI is **O**
- Get three in a row (horizontal, vertical, or diagonal) to win
- Fill the board without a winner = draw
- Click "New Game" to reset anytime

## AI Difficulty

- **Easy (Level 1):** Makes random valid moves
- **Medium (Level 2):** Blocks your winning moves, takes strategic positions (center/corners)
- **Hard (Level 3):** Uses minimax algorithm — plays perfectly, unbeatable

Difficulty selection persists across sessions using localStorage.

## File Structure

```
├── index.html          # Main app structure
├── style.css           # Modern responsive styling
├── game.js             # Game logic and AI implementation
├── sw.js               # Service Worker for offline support
├── manifest.json       # PWA metadata
├── server.js           # Express local server
├── vite.config.js      # Vite build configuration
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 15+
- Mobile browsers (iOS Safari, Chrome Android)

## Notes

- All game logic runs client-side (no backend persistence needed)
- Service Worker caches assets on first load
- Works perfectly offline once assets are cached
- localStorage stores difficulty preference across sessions
- No analytics, ads, or tracking
