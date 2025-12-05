import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";

// ==========================
// FIX FOR ES MODULE PATH
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================
// BASIC SERVER SETUP
// ==========================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// REDIS SETUP (DISTRIBUTED SYNC)
// ==========================
const REDIS_HOST = "localhost"; // change to ElastiCache host on AWS

const publisher = createClient({
  url: `redis://${REDIS_HOST}:6379`,
});

const subscriber = publisher.duplicate();

await publisher.connect();
await subscriber.connect();

console.log("✅ Connected to Redis");

// ==========================
// REDIS → SOCKET BROADCAST
// ==========================
subscriber.subscribe("whiteboard-events", (message) => {
  const msg = JSON.parse(message);

  if (msg.type === "draw") {
    io.emit("draw", msg.data);
  }

  if (msg.type === "clear") {
    io.emit("clear");
  }
});

// ==========================
// SOCKET.IO USER HANDLING
// ==========================
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // ✅ DRAW EVENT
  socket.on("draw", (data) => {
    publisher.publish(
      "whiteboard-events",
      JSON.stringify({ type: "draw", data })
    );
  });

  // ✅ CLEAR ALL EVENT
  socket.on("clear", () => {
    publisher.publish("whiteboard-events", JSON.stringify({ type: "clear" }));
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

// ==========================
// START SERVER
// ==========================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ Whiteboard running at http://localhost:${PORT}`);
});
