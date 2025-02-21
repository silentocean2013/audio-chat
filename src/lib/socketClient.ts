import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = () => {
  if (!socket) {
    console.log('[SocketClient] Creating new socket connection...');
    
    // Determine WebSocket server URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = '3001';
    const wsHost = window.location.hostname === 'localhost' ? 
      `localhost:${wsPort}` : 
      window.location.hostname;
    const wsUrl = `${protocol}//${wsHost}`;
    
    console.log('[SocketClient] Connecting to WebSocket server at:', wsUrl);
    
    socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      withCredentials: true,
    });

    socket.on('connect', () => {
      console.log('[SocketClient] Socket connected successfully:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[SocketClient] Socket disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('[SocketClient] Socket connection error:', error.message);
    });

    socket.on('error', (error) => {
      console.error('[SocketClient] Socket error:', error);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      console.log('[SocketClient] Reconnection attempt:', attempt);
    });

    socket.io.on("reconnect", (attempt) => {
      console.log('[SocketClient] Reconnected after', attempt, 'attempts');
    });

    socket.io.on("reconnect_error", (error) => {
      console.error('[SocketClient] Reconnection error:', error);
    });

    socket.io.on("reconnect_failed", () => {
      console.error('[SocketClient] Failed to reconnect');
    });

    // Force connect
    socket.connect();
  } else {
    console.log('[SocketClient] Using existing socket:', socket.id, 'Connected:', socket.connected);
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    console.log('[SocketClient] Disconnecting socket:', socket.id);
    socket.disconnect();
    socket = null;
  }
};
