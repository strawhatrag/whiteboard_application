import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";

// ==========================
// PATH FIX FOR ES MODULES
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================
// BASIC SERVER SETUP
// ==========================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// REDIS SETUP (DISTRIBUTED SYNC)
// ==========================
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";

const publisher = createClient({
  url: `redis://${REDIS_HOST}:6379`,
});

const subscriber = publisher.duplicate();

await publisher.connect();
await subscriber.connect();

console.log("✅ Connected to Redis at", REDIS_HOST);

// ==========================
// BOARD STATE IN MEMORY
// (persists while this process is running)
// ==========================
let strokes = []; // each: { x, y, color, userId }

// ==========================
// REDIS -> SOCKET BROADCAST
// ==========================
await subscriber.subscribe("whiteboard-events", (message) => {
  const msg = JSON.parse(message);

  // DRAW
  if (msg.type === "draw") {
    strokes.push(msg.data);
    io.emit("draw", msg.data);
  }

  // CLEAR ALL
  if (msg.type === "clear-all") {
    strokes = [];
    io.emit("clear-all");
  }

  // CLEAR ONE USER
  if (msg.type === "clear-user") {
    const targetUser = msg.userId;
    strokes = strokes.filter((s) => s.userId !== targetUser);

    // notify clients whose strokes were removed
    io.emit("clear-user", { userId: targetUser });
    // resync full board for everyone
    io.emit("reset-board", strokes);
  }
});

// ==========================
// SOCKET.IO HANDLING
// ==========================
io.on("connection", (socket) => {
  let userId = null;

  console.log("🟢 Socket connected:", socket.id);

  // Client sends its session userId
  socket.on("register", (data) => {
    userId = data?.userId || socket.id.slice(0, 5).toUpperCase();

    console.log("👤 User registered:", socket.id, "userId:", userId);

    // Confirm ID back to client
    socket.emit("user-info", { userId });

    // Send current board state so refresh/new user sees it
    socket.emit("init-board", strokes);
  });

  // DRAW EVENT
  socket.on("draw", (data) => {
    // data: { x, y, color }
    const withUser = { ...data, userId: userId || "UNKNOWN" };

    publisher.publish(
      "whiteboard-events",
      JSON.stringify({ type: "draw", data: withUser })
    );
  });

  // CLEAR ALL (GLOBAL)
  socket.on("clear-all", () => {
    publisher.publish(
      "whiteboard-events",
      JSON.stringify({ type: "clear-all" })
    );
  });

  // CLEAR ONLY MY STROKES
  socket.on("clear-mine", () => {
    if (!userId) return;
    publisher.publish(
      "whiteboard-events",
      JSON.stringify({ type: "clear-user", userId })
    );
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id, "userId:", userId);
  });
});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Whiteboard running at http://localhost:${PORT}`);
});
