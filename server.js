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

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/crypto-js", express.static(path.join(__dirname, "node_modules/crypto-js")));

/* ===================== ROOM STORE ===================== */
const rooms = new Map(); // passcode -> { roomId, expireAt }
const roomIds = new Map(); // roomId -> passcode (for reverse lookup)

function generateUniquePasscode() {
  let passcode;
  do {
    passcode = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(passcode));
  return passcode;
}

/* ===================== SOCKET ===================== */
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  /* ---------- CREATE ROOM ---------- */
  socket.on("createRoom", () => {
    const passcode = generateUniquePasscode();
    const roomId = crypto.randomBytes(16).toString("hex");
    const expiresIn = 40 * 60 * 1000; // Increased to 40 mins for stability
    const expireAt = Date.now() + expiresIn;

    rooms.set(passcode, { roomId, expireAt });
    roomIds.set(roomId, passcode); // Reverse mapping

    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("roomCreated", { passcode, roomId, expireAt });

    setTimeout(() => {
      if (rooms.has(passcode)) {
        rooms.delete(passcode);
        roomIds.delete(roomId);
        io.to(roomId).emit("systemMessage", "⚠️ Room expired.");
        io.socketsLeave(roomId);
      }
    }, expiresIn);
  });

 /* ---------- JOIN ROOM ---------- */
socket.on("joinRoom", ({ passcode, roomId, name }) => {
  let roomData = null;

  if (passcode) {
    roomData = rooms.get(String(passcode).trim());
  } else if (roomId) {
    const pCode = roomIds.get(roomId);
    if (pCode) roomData = rooms.get(pCode);
  }
  
  if (!roomData) {
    socket.emit("systemMessage", "Invalid or expired passcode.");
    return;
  }

  const members = io.sockets.adapter.rooms.get(roomData.roomId);
  
  // Check if this is a "Reconnection" or a "Fresh Join"
  // If the user is already technically in the room (from a previous socket), we stay silent
  const isReconnecting = members && members.size > 0;

  if (members && members.size >= 2 && !socket.rooms.has(roomData.roomId)) {
    socket.emit("systemMessage", "Room is full.");
    return;
  }

  socket.join(roomData.roomId);
  socket.roomId = roomData.roomId;
  socket.userName = name || "Anonymous";

  socket.emit("joinSuccess", { 
      roomId: roomData.roomId, 
      passcode: roomIds.get(roomData.roomId),
      expireAt: roomData.expireAt 
  });

  // ONLY show the message if it's the first time joining or after a long absence
  if (!isReconnecting) {
    io.to(roomData.roomId).emit("systemMessage", `${socket.userName} joined the chat.`);
  }
});

/* ---------- MESSAGE & TYPING ---------- */
socket.on("sendMessage", ({ message }) => {
  if (!socket.roomId) return; 
  socket.to(socket.roomId).emit("newMessage", { message, from: socket.userName });
});

socket.on("typing", () => {
  if (socket.roomId) socket.to(socket.roomId).emit("showTyping");
});

socket.on("stopTyping", () => {
  if (socket.roomId) socket.to(socket.roomId).emit("hideTyping");
});

socket.on("quitRoom", () => {
  if (!socket.roomId) return;
  socket.to(socket.roomId).emit("systemMessage", `${socket.userName} left.`);
  socket.leave(socket.roomId);
  socket.roomId = null;
});

/* ---------- IMPROVED DISCONNECT (Silent Grace Period) ---------- */
socket.on("disconnect", () => {
  const rId = socket.roomId;
  const uName = socket.userName || "User";

  if (rId) {
    // 5-second grace period for app switching
    setTimeout(() => {
      const currentRoom = io.sockets.adapter.rooms.get(rId);
      
      // We only alert the other user if the person is TRULY gone (room size < 2)
      // and hasn't reconnected with a new socket ID in those 5 seconds.
      if (!currentRoom || currentRoom.size < 2) {
        io.to(rId).emit("systemMessage", `${uName} went offline.`);
      }
    }, 5000); 
  }
});
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
