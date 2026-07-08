const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ---- matching state ----
let waitingQueue = [];
const partners = new Map();

// ---- lightweight identity (no accounts yet — just a browser-persisted id) ----
const deviceIds = new Map();       // socket.id -> deviceId
const blockedBy = new Map();       // deviceId -> Set(deviceId)
const reportCounts = new Map();    // deviceId -> number
const BAN_THRESHOLD = 5;

// ---- basic chat word filter (starter list — extend for your community) ----
const BAD_WORDS = [
  'stupid', 'idiot', 'shut up',
  'con', 'débile', 'merde', 'putain',
  'حقير', 'غبي', 'زبل', 'خنزير'
];

function filterText(text) {
  let result = String(text || '').slice(0, 300);
  BAD_WORDS.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    result = result.replace(re, m => '*'.repeat(m.length));
  });
  return result;
}

function isBlockedPair(idA, idB) {
  if (!idA || !idB) return false;
  const a = blockedBy.get(idA);
  const b = blockedBy.get(idB);
  return (a && a.has(idB)) || (b && b.has(idA));
}

function isBanned(deviceId) {
  return !!deviceId && (reportCounts.get(deviceId) || 0) >= BAN_THRESHOLD;
}

function endPartnership(sock) {
  const partnerId = partners.get(sock.id);
  if (partnerId) {
    io.to(partnerId).emit('partner-left');
    partners.delete(partnerId);
    partners.delete(sock.id);
  }
}

function removeFromQueue(sock) {
  waitingQueue = waitingQueue.filter(s => s.id !== sock.id);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('identify', (data) => {
    if (data && typeof data.deviceId === 'string') {
      deviceIds.set(socket.id, data.deviceId.slice(0, 64));
    }
  });

  socket.on('find-partner', () => {
    const myDeviceId = deviceIds.get(socket.id);
    if (isBanned(myDeviceId)) {
      socket.emit('banned');
      return;
    }

    for (let i = 0; i < waitingQueue.length; i++) {
      const candidate = waitingQueue[i];
      if (!candidate.connected || candidate.id === socket.id) continue;
      const candidateDeviceId = deviceIds.get(candidate.id);
      if (isBlockedPair(myDeviceId, candidateDeviceId)) continue;

      waitingQueue.splice(i, 1);
      partners.set(socket.id, candidate.id);
      partners.set(candidate.id, socket.id);
      socket.emit('partner-found', { initiator: true });
      candidate.emit('partner-found', { initiator: false });
      return;
    }

    removeFromQueue(socket);
    waitingQueue.push(socket);
    socket.emit('waiting');
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', data);
  });

  socket.on('chat-message', (data) => {
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    const clean = filterText(data && data.text);
    if (!clean.trim()) return;
    socket.emit('chat-message', { text: clean, self: true });
    io.to(partnerId).emit('chat-message', { text: clean, self: false });
  });

  socket.on('report', () => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      const reportedId = deviceIds.get(partnerId);
      if (reportedId) {
        reportCounts.set(reportedId, (reportCounts.get(reportedId) || 0) + 1);
        console.log('[REPORT]', reportedId, 'total:', reportCounts.get(reportedId));
        if (isBanned(reportedId)) {
          io.to(partnerId).emit('banned');
        }
      }
    }
    endPartnership(socket);
  });

  socket.on('block', () => {
    const myDeviceId = deviceIds.get(socket.id);
    const partnerId = partners.get(socket.id);
    if (partnerId && myDeviceId) {
      const partnerDeviceId = deviceIds.get(partnerId);
      if (partnerDeviceId) {
        if (!blockedBy.has(myDeviceId)) blockedBy.set(myDeviceId, new Set());
        blockedBy.get(myDeviceId).add(partnerDeviceId);
      }
    }
    endPartnership(socket);
  });

  socket.on('next', () => {
    endPartnership(socket);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    removeFromQueue(socket);
    endPartnership(socket);
    deviceIds.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
