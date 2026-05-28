const path = require("path");
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MAX_MESSAGES_PER_ROOM = Number(process.env.MAX_MESSAGES_PER_ROOM || 500);

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(cors({ origin: CLIENT_ORIGIN }));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// In-memory encrypted store.
// Production: replace with PostgreSQL/Redis and keep ONLY encrypted payloads.
const rooms = new Map();

function safeRoomId(roomId) {
  return typeof roomId === "string" && /^[a-zA-Z0-9_-]{3,96}$/.test(roomId);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, []);
  return rooms.get(roomId);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "Korvet manager", privacy: "server stores ciphertext only" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
  maxHttpBufferSize: 8 * 1024 * 1024,
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId }) => {
    if (!safeRoomId(roomId)) {
      socket.emit("error:message", "Некорректный ID комнаты");
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit("room:history", getRoom(roomId));
  });

  socket.on("message:send", ({ roomId, payload }) => {
    if (!safeRoomId(roomId) || !payload || typeof payload !== "object") {
      socket.emit("error:message", "Некорректное сообщение");
      return;
    }

    const message = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      createdAt: Date.now(),
      payload, // ciphertext only
    };

    const room = getRoom(roomId);
    room.push(message);
    while (room.length > MAX_MESSAGES_PER_ROOM) room.shift();

    io.to(roomId).emit("message:new", message);
  });

  socket.on("room:wipe-local-request", ({ roomId }) => {
    if (safeRoomId(roomId)) {
      io.to(roomId).emit("room:wipe-local");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Korvet manager server listening on ${PORT}`);
});
