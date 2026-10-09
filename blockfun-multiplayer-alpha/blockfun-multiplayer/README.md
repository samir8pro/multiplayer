# BLOCKFUN Multiplayer Alpha 0.2

**What works after server setup**: shared room for up to 80 guests, realtime players as colored block characters, player counters, keyboard walking and drag-to-look fallback inside X. Crafting is still DEMO and saved only in each browser. Block edits are local, not shared yet. No Solana transactions.

## A. Host the multiplayer server (Render)
1. Create a GitHub repository and upload the contents of this folder (`site/`, `server/`, and README). GitHub is only for deployment, players don't need accounts.
2. On https://dashboard.render.com/ choose **New > Web Service**, connect the repo.
3. Choose **Node**, set **Root Directory: server**, **Build Command: npm install**, **Start Command: npm start**. Choose an available plan. Alternatively use the repository's Render Blueprint from `server/render.yaml` and ensure root directory config matches.
4. Add environment variable `ALLOWED_ORIGINS=https://zippy-piroshki-e7d3fc.netlify.app`.
5. Render supplies a URL like `https://blockfun-multiplayer-abc.onrender.com`. Visit it: it should show JSON with `"ok":true`. On a free instance initial requests may be delayed while it wakes up.

## B. Connect the existing Netlify site
1. Open `site/config.js` and set `window.BLOCKFUN_WS_URL='wss://blockfun-multiplayer-abc.onrender.com';` using **your actual Render host**.
2. Re-deploy the `site/` folder to the existing Netlify site **zippy-piroshki-e7d3fc**, preserving its URL. Do not upload the server directory to Netlify.
3. Open the site in two different browsers or two private browser windows. After joining, both should display `2 ONLINE` and see each other's colorful block avatars.
4. Check your existing X post or share the same Netlify URL in a post. X may cache the old player card; interactive display depends on X permissions and restrictions.

## Security and product notes
- **No X account, wallet, or account connection for players.** Random connection identifiers are ephemeral; refreshing creates a new guest.
- Server checks origin, max payload, coordinates, basic speed, and max 80 clients. This is a prototype, not hardened for public traffic.
- **3 daily crafts are still per browser, not globally enforced**. No real tokens created. Do not promise real tokens until backend controls, rate limits, budget, and Solana signing are ready.
- Netlify is static hosting; it does not provide a persistent WebSocket room by itself.
- Player cards or game embeds may be restricted by X. The current screenshot suggests the embed runs in the user's X session but future availability is not guaranteed.
