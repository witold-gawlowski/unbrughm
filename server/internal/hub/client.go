package hub

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	sendBufferSize = 64 // frames buffered per client before it counts as too slow
)

var upgrader = websocket.Upgrader{
	// Prototype: accept any origin so a second machine on the LAN can join.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Client is one connected player. The hub goroutine owns id/x/z and the account
// identity; the read and write pumps only touch the connection and the send
// channel.
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	id        int
	accountID int64
	username  string
	x, z      float64
}

// ServeWs authenticates the request's session token, upgrades it to a
// WebSocket, and hands the connection to the hub. It is the handler for /ws.
// The token lookup (blocking DB I/O) happens here, before the client reaches
// the hub's single tick goroutine.
func (h *Hub) ServeWs(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	accountID, username, err := h.sessions.SessionAccount(r.Context(), token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already replied with an HTTP error
	}
	c := &Client{
		hub:       h,
		conn:      conn,
		send:      make(chan []byte, sendBufferSize),
		accountID: accountID,
		username:  username,
	}
	h.register <- c
	go c.writePump()
	go c.readPump()
}

// readPump decodes incoming JSON frames into the hub's inbound channel until
// the connection dies, then unregisters.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var m clientMsg
		if json.Unmarshal(raw, &m) != nil {
			continue // ignore malformed frames
		}
		c.hub.inbound <- inbound{client: c, msg: m}
	}
}

// writePump drains the send channel to the socket. The hub closing the send
// channel (drop or normal leave) ends the pump, which closes the connection
// and thereby also ends the read pump.
func (c *Client) writePump() {
	defer c.conn.Close()
	for raw := range c.send {
		c.conn.SetWriteDeadline(time.Now().Add(writeWait))
		if err := c.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
			return
		}
	}
	c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}
