const { createServer } = require('http');
const { Server } = require('socket.io');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (userData) => {
    console.log('User joining room:', userData);
    socket.data = userData;
    socket.join('audio-room');
    
    socket.broadcast.to('audio-room').emit('user-joined', {
      ...userData,
      id: socket.id,
    });
    
    const sockets = io.sockets.adapter.rooms.get('audio-room');
    const users = Array.from(sockets || []).map(socketId => {
      const userSocket = io.sockets.sockets.get(socketId);
      return {
        id: socketId,
        name: userSocket?.data?.name,
        micEnabled: userSocket?.data?.micEnabled,
      };
    });
    
    console.log('Sending users list:', users);
    socket.emit('users-list', users);
  });

  socket.on('toggle-mic', (status) => {
    console.log('User toggled mic:', socket.id, status);
    socket.data.micEnabled = status;
    socket.broadcast.to('audio-room').emit('user-mic-toggle', {
      id: socket.id,
      micEnabled: status,
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    socket.broadcast.to('audio-room').emit('user-left', socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
