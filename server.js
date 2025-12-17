const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

/* ===================== SECURITY ===================== */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100
  })
);

/* ===================== STATIC ===================== */
app.use(express.static(path.join(__dirname, "public")));
app.use("/crypto-js", express.static(path.join(__dirname, "node_modules/crypto-js")));

/* ===================== ROOM STORE ===================== */
const rooms = new Map();

/* Helper to generate a unique 6-digit passcode */
function generateUniquePasscode() {
  let passcode;
  do {
    passcode = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(passcode)); // Ensure we don't overwrite an existing room
  return passcode;
}

/* ===================== SOCKET ===================== */
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  /* ---------- CREATE ROOM ---------- */
  socket.on("createRoom", () => {
    const passcode = generateUniquePasscode();
    const roomId = crypto.randomBytes(16).toString("hex"); // Stronger internal ID
    const expiresIn = 10 * 60 * 1000; // 10 minutes
    const expireAt = Date.now() + expiresIn;

    // Store internal roomId and expiry against the user-facing passcode
    rooms.set(passcode, { roomId, expireAt });

    // Join the creator to the internal room immediately
    socket.join(roomId);
    socket.roomId = roomId;

    // Send passcode back to creator
    socket.emit("roomCreated", { passcode, roomId, expireAt });

    // Auto-cleanup
    setTimeout(() => {
      if (rooms.has(passcode)) {
        rooms.delete(passcode);
        io.to(roomId).emit("systemMessage", "⚠️ Room expired.");
        io.socketsLeave(roomId);
      }
    }, expiresIn);
  });

  /* ---------- JOIN ROOM ---------- */
  socket.on("joinRoom", ({ passcode, name }) => {
    const roomData = rooms.get(passcode);
    
    if (!roomData) {
      socket.emit("systemMessage", "Invalid or expired passcode.");
      return;
    }

    const members = io.sockets.adapter.rooms.get(roomData.roomId);
    if (members && members.size >= 2) {
      socket.emit("systemMessage", "Room is full.");
      return;
    }

    socket.join(roomData.roomId);
    socket.roomId = roomData.roomId;
    socket.userName = name || "Anonymous";

    // Notify others in the room
    io.to(roomData.roomId).emit("systemMessage", `${socket.userName} joined.`);
    
    // Crucial: Tell the joining client which internal roomId to use for redirection
    socket.emit("joinSuccess", { 
        roomId: roomData.roomId, 
        expireAt: roomData.expireAt 
    });
  });

  /* ---------- MESSAGE ---------- */
  socket.on("sendMessage", ({ message }) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit("newMessage", {
      message,
      from: socket.userName
    });
  });

  socket.on("typing", () => {
    if (socket.roomId) socket.to(socket.roomId).emit("showTyping");
  });

  socket.on("stopTyping", () => {
    if (socket.roomId) socket.to(socket.roomId).emit("hideTyping");
  });

  socket.on("quitRoom", () => {
    if (!socket.roomId) return;
    socket.leave(socket.roomId);
    socket.to(socket.roomId).emit("systemMessage", `${socket.userName} left.`);
  });

  socket.on("disconnect", () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit("systemMessage", `${socket.userName || "User"} disconnected.`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
