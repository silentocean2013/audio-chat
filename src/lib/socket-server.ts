import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { NextApiRequest } from 'next';
import { NextApiResponse } from 'next';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
let io: SocketIOServer;

export const connectedUsers = new Map();

export const initSocketServer = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!io) {
    console.log('Initializing socket server...');
    
    const httpServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/socket/io')) {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
      } else {
        handle(req, res);
      }
    });

    io = new SocketIOServer(httpServer, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['polling', 'websocket'],
    });

    io.on('connection', (socket) => {
      console.log('Socket connected:', socket.id);

      socket.on('validate-name', (name) => {
        console.log('Validating name:', name);
        const isNameTaken = Array.from(connectedUsers.values()).some(user => user.name.toLowerCase() === name.toLowerCase());
        socket.emit('name-validation-result', { isValid: !isNameTaken });
      });

      socket.on('join-room', ({ name, micEnabled }) => {
        console.log('Join room request:', { name, micEnabled });
        const isNameTaken = Array.from(connectedUsers.values()).some(user => user.name.toLowerCase() === name.toLowerCase());
        
        if (isNameTaken) {
          console.log('Name already taken:', name);
          socket.emit('join-error', { message: 'This name is already taken. Please choose a different name.' });
          return;
        }

        const user = { id: socket.id, name, micEnabled };
        connectedUsers.set(socket.id, user);
        io.emit('user-joined', user);
        socket.emit('users-list', Array.from(connectedUsers.values()));
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
        connectedUsers.delete(socket.id);
        io.emit('user-left', socket.id);
      });

      socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
          offer: data.offer,
          from: socket.id,
        });
      });

      socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
          answer: data.answer,
          from: socket.id,
        });
      });

      socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
          candidate: data.candidate,
          from: socket.id,
        });
      });

      socket.on('mic-toggle', ({ micEnabled }) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
          user.micEnabled = micEnabled;
          io.emit('user-updated', user);
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(3001, () => {
        console.log('Socket.IO server running on port 3001');
        resolve();
      });
    });
  }

  res.end();
};
