# BLOCKFUN – new multiplayer backend

New Render service for https://dynamic-klepon-d46485.netlify.app

- Node.js + ws (WebSockets).
- Anonymous nicknames, skins, movement, chat and terrain edits.
- Protected 100×100 spawn.
- 1000×1000 continuous world.
- No real token signing. Coins remain demo-only until a separate audited minting service exists.
- State is held in memory; data can reset when Render restarts.
- ALLOWED_ORIGINS controls which websites may open WebSocket connections.

Deploy on Render (Node, free, branch blockfun-new-server-20261009):
Build: npm install
Start: npm start
Environment: ALLOWED_ORIGINS=https://dynamic-klepon-d46485.netlify.app
