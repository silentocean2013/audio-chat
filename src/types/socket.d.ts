import { Server as NetServer, Socket } from 'net';
import { NextApiResponse } from 'next';
import { Server as SocketIOServer } from 'socket.io';

export interface SocketServer extends NetServer {
  io?: SocketIOServer;
}

export interface SocketWithIO extends Socket {
  server: SocketServer;
}

export interface NextApiResponseServerIO extends NextApiResponse {
  socket: SocketWithIO;
}

export interface User {
  id: string;
  name: string;
  micEnabled: boolean;
}

export interface PeerConnection {
  connection: RTCPeerConnection;
  stream: MediaStream;
}
