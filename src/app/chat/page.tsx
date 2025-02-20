'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { MicrophoneIcon, NoSymbolIcon } from '@heroicons/react/24/solid';

interface User {
  id: string;
  name: string;
  micEnabled?: boolean;
}

function ChatRoomContent() {
  const searchParams = useSearchParams();
  const name = searchParams.get('name');
  const [users, setUsers] = useState<User[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!name) {
      window.location.href = '/';
      return;
    }

    let newSocket: Socket | null = null;

    const initializeSocket = async () => {
      try {
        console.log('Initializing socket connection...');
        newSocket = io({
          path: '/api/socket/io',
          addTrailingSlash: false,
          transports: ['polling', 'websocket'],
          autoConnect: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000,
          withCredentials: true,
        });

        newSocket.on('connect_error', (err) => {
          console.error('Socket connection error:', err);
          setIsConnecting(false);
          setError(`Connection error: ${err.message}. Retrying...`);
        });

        newSocket.on('connect', () => {
          console.log('Socket connected successfully');
          setSocket(newSocket);
          setIsConnecting(false);
          setError(null);
          newSocket?.emit('join-room', { name, micEnabled });
        });

        newSocket.on('disconnect', (reason) => {
          console.log('Socket disconnected:', reason);
          setIsConnecting(true);
          setError(`Disconnected: ${reason}. Attempting to reconnect...`);
        });

        newSocket.on('users-list', (usersList: User[]) => {
          console.log('Received users list:', usersList);
          setUsers(usersList);
        });

        newSocket.on('user-joined', (user: User) => {
          console.log('User joined:', user);
          setUsers(prev => {
            // Don't add if user already exists
            if (prev.some(u => u.id === user.id)) {
              return prev;
            }
            return [...prev, user];
          });
        });

        newSocket.on('user-left', (userId: string) => {
          console.log('User left:', userId);
          setUsers(prev => prev.filter(user => user.id !== userId));
        });

        newSocket.on('user-mic-toggle', (data: { id: string; micEnabled: boolean }) => {
          console.log('User toggled mic:', data);
          setUsers(prev => prev.map(user => 
            user.id === data.id ? { ...user, micEnabled: data.micEnabled } : user
          ));
        });
      } catch (error) {
        console.error('Failed to initialize socket:', error);
        setIsConnecting(false);
        setError(`Failed to initialize chat: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    initializeSocket();

    return () => {
      if (newSocket) {
        console.log('Cleaning up socket connection...');
        newSocket.disconnect();
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [name]);

  const toggleMicrophone = async () => {
    try {
      if (!micEnabled) {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(audioStream);
      } else if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      
      setMicEnabled(!micEnabled);
      socket?.emit('toggle-mic', !micEnabled);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setError('Failed to access microphone. Please check your permissions.');
    }
  };

  if (isConnecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl">Connecting to chat...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Audio Chat Room</h1>
          <button
            onClick={toggleMicrophone}
            className={`p-2 rounded-full ${
              micEnabled ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}
          >
            {micEnabled ? (
              <MicrophoneIcon className="h-6 w-6" />
            ) : (
              <NoSymbolIcon className="h-6 w-6" />
            )}
          </button>
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Connected Users:</h2>
          <ul className="space-y-2">
            {users.map((user) => (
              <li
                key={user.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <span>{user.name}</span>
                <span className={`${user.micEnabled ? 'text-blue-500' : 'text-gray-400'}`}>
                  {user.micEnabled ? (
                    <MicrophoneIcon className="h-5 w-5" />
                  ) : (
                    <NoSymbolIcon className="h-5 w-5" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function ChatRoom() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ChatRoomContent />
    </Suspense>
  );
}
