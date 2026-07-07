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

let waitingUser = null;
const partners = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('find-partner', () => {
    if (waitingUser && waitingUser.connected && waitingUser.id !== socket.id) {
      const partner = waitingUser;
      waitingUser = null;

      partners.set(socket.id, partner.id);
      partners.set(partner.id, socket.id);

      socket.emit('partner-found', { initiator: true });
      partner.emit('partner-found', { initiator: false });
    } else {
      waitingUser = socket;
      socket.emit('waiting');
    }
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('signal', data);
    }
  });

  socket.on('next', () => {
    endPartnership(socket);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (waitingUser === socket) waitingUser = null;
    endPartnership(socket);
  });

  function endPartnership(sock) {
    const partnerId = partners.get(sock.id);
    if (partnerId) {
      io.to(partnerId).emit('partner-left');
      partners.delete(partnerId);
      partners.delete(sock.id);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
