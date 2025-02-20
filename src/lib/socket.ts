import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { NextApiResponse } from 'next';

export type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: SocketIOServer;
    };
  };
};

export const initSocket = (res: NextApiResponseWithSocket) => {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server);
    res.socket.server.io = io;

    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      socket.on('join-room', (userData) => {
        socket.join('audio-room');
        socket.broadcast.to('audio-room').emit('user-joined', { ...userData, id: socket.id });
        
        // Send current users list to the new user
        const sockets = io.sockets.adapter.rooms.get('audio-room');
        const users = Array.from(sockets || []).map(socketId => ({
          id: socketId,
          ...io.sockets.sockets.get(socketId)?.data
        }));
        socket.emit('users-list', users);
      });

      socket.on('toggle-mic', (status) => {
        socket.data.micEnabled = status;
        socket.broadcast.to('audio-room').emit('user-mic-toggle', {
          id: socket.id,
          micEnabled: status
        });
      });

      socket.on('disconnect', () => {
        socket.broadcast.to('audio-room').emit('user-left', socket.id);
        console.log('User disconnected:', socket.id);
      });
    });
  }
  return res.socket.server.io;
};
