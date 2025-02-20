import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';

interface User {
  id: string;
  name: string;
  micEnabled: boolean;
}

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Store connected users
const connectedUsers = new Map<string, User>();

const getUsersList = (io: Server) => {
  return Array.from(connectedUsers.values());
};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(server, {
    path: '/api/socket/io',
    addTrailingSlash: false,
    transports: ['polling', 'websocket'],
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ name, micEnabled }) => {
      console.log('User joined:', { id: socket.id, name, micEnabled });
      
      // Store user data
      const user: User = { id: socket.id, name, micEnabled };
      connectedUsers.set(socket.id, user);
      socket.data.user = user;
      
      // Join the room
      socket.join('audio-room');
      
      // Broadcast to others that a new user joined
      socket.broadcast.to('audio-room').emit('user-joined', user);
      
      // Send the current users list to the new user
      const users = getUsersList(io);
      console.log('Sending users list:', users);
      io.to(socket.id).emit('users-list', users);
    });

    // WebRTC Signaling
    socket.on('offer', ({ offer, to }) => {
      console.log('Relaying offer from', socket.id, 'to', to);
      socket.to(to).emit('offer', {
        offer,
        from: socket.id,
      });
    });

    socket.on('answer', ({ answer, to }) => {
      console.log('Relaying answer from', socket.id, 'to', to);
      socket.to(to).emit('answer', {
        answer,
        from: socket.id,
      });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
      console.log('Relaying ICE candidate from', socket.id, 'to', to);
      socket.to(to).emit('ice-candidate', {
        candidate,
        from: socket.id,
      });
    });

    socket.on('toggle-mic', (enabled) => {
      const user = connectedUsers.get(socket.id);
      if (user) {
        user.micEnabled = enabled;
        connectedUsers.set(socket.id, user);
        socket.data.user = user;
        
        // Broadcast mic toggle to all users in the room
        io.to('audio-room').emit('user-mic-toggle', {
          id: socket.id,
          micEnabled: enabled,
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      connectedUsers.delete(socket.id);
      io.to('audio-room').emit('user-left', socket.id);
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
