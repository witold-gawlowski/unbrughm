// The WebSocket link to the server. The game is online-only: connect() blocks
// startup until the server's welcome message arrives, because the world (dug
// cells) and our identity (id, spawn) come from it. It is also account-gated —
// the session token from login is passed as a query param so the server can
// authenticate the handshake (see server/internal/hub ServeWs).
//
// All coordinates on the wire are in *cell units* (floats for positions,
// integers for cells) — the server never sees world units or SIZE.

export function connect(token, base = `ws://${location.host}/ws`) {
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let handler = null;   // post-welcome message callback, set via onMessage

    ws.onerror = () => reject(new Error(`can't reach the game server at ${base}`));
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type !== 'welcome') { handler?.(msg); return; }
      ws.onerror = null;
      const send = obj => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
      resolve({
        id: msg.id,
        username: msg.username, // our account name
        spawn: msg.spawn,       // { x, z } cell we start on
        dug: msg.dug,           // [[x, z], ...] every carved-out cell so far
        players: msg.players,   // players already online (excludes us)
        sendPos: (x, z) => send({ type: 'pos', x, z }),
        sendDig: (x, z) => send({ type: 'dig', x, z }),
        onMessage: cb => { handler = cb; },
      });
    };
  });
}
