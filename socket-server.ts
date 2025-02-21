import { Server } from 'socket.io';
import { createServer } from 'http';

const httpServer = createServer();

// Determine allowed origins based on environment
const isDev = process.env.NODE_ENV === 'development';
const allowedOrigins = isDev 
  ? ["http://localhost:3000"] 
  : true; // Allow any origin in production

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true, // Enable compatibility with Socket.IO v2 clients
});

// Track users by name instead of socket ID to prevent duplicates
const connectedUsers = new Map<string, { id: string; name: string; micEnabled: boolean }>();

io.on('connection', (socket) => {
  console.log('[SocketServer] New connection:', socket.id);
  let currentUser: { name: string; micEnabled: boolean } | null = null;

  socket.on('validate-name', (name) => {
    console.log('[SocketServer] Validating name:', name);
    const isNameTaken = Array.from(connectedUsers.values()).some(user => user.name.toLowerCase() === name.toLowerCase());
    socket.emit('name-validation-result', { isValid: !isNameTaken });
  });

  socket.on('join-room', ({ name, micEnabled }) => {
    console.log('[SocketServer] Join room request:', { name, micEnabled, socketId: socket.id });
    
    // Check if name is taken by another socket
    const existingUser = Array.from(connectedUsers.values()).find(
      user => user.name.toLowerCase() === name.toLowerCase() && user.id !== socket.id
    );

    if (existingUser) {
      console.log('[SocketServer] Name already taken:', name);
      socket.emit('join-error', { message: 'This name is already taken. Please choose a different name.' });
      return;
    }

    // Store current user info
    currentUser = { name, micEnabled };

    // Add new user
    const user = { id: socket.id, name, micEnabled };
    connectedUsers.set(socket.id, user);
    
    // Broadcast to all clients
    io.emit('user-joined', user);
    socket.emit('users-list', Array.from(connectedUsers.values()));
    
    console.log('[SocketServer] Current users:', Array.from(connectedUsers.values()));
  });

  socket.on('disconnect', () => {
    console.log('[SocketServer] Socket disconnected:', socket.id);
    
    // Remove user
    if (connectedUsers.has(socket.id)) {
      connectedUsers.delete(socket.id);
      io.emit('user-left', socket.id);
      console.log('[SocketServer] Users after disconnect:', Array.from(connectedUsers.values()));
    }
  });

  socket.on('mic-toggle', ({ micEnabled }) => {
    console.log('[SocketServer] Mic toggle:', { socketId: socket.id, micEnabled });
    
    // Update user's mic status
    const user = connectedUsers.get(socket.id);
    if (user) {
      user.micEnabled = micEnabled;
      io.emit('user-updated', user);
      console.log('[SocketServer] Updated user:', user);
    }
  });

  socket.on('offer', (data) => {
    console.log('[SocketServer] Offer from', socket.id, 'to', data.to);
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id,
    });
  });

  socket.on('answer', (data) => {
    console.log('[SocketServer] Answer from', socket.id, 'to', data.to);
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id,
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log('[SocketServer] ICE candidate from', socket.id, 'to', data.to);
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id,
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`[SocketServer] Server running on port ${PORT}`);
});
