'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket, disconnectSocket } from '@/lib/socketClient';

export default function Home() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isNameValid, setIsNameValid] = useState(false);
  const [socket, setSocket] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const newSocket = getSocket();
    setSocket(newSocket);

    // Connect the socket
    newSocket.connect();

    // Handle connection events
    const handleConnect = () => {
      console.log('Connected to server');
      setError('');
    };

    const handleConnectError = (err: Error) => {
      console.error('Connection error:', err);
      setError('Failed to connect to server. Please try again.');
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.on('name-validation-result', ({ isValid }) => {
      setIsNameValid(isValid);
      setIsValidating(false);
    });

    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.off('name-validation-result');
    };
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }

    setError('');
    setIsValidating(true);

    const socket = getSocket();
    socket.emit('validate-name', name.trim());

    // Handle validation result
    socket.once('name-validation-result', ({ isValid }) => {
      setIsValidating(false);
      if (isValid) {
        router.push(`/chat?name=${encodeURIComponent(name.trim())}`);
      } else {
        setError('This name is already taken. Please choose a different name.');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 sm:px-6">
      <div className="w-full max-w-sm bg-white p-6 sm:p-8 rounded-lg shadow-md">
        <h1 className="text-xl sm:text-2xl font-bold mb-6 text-center">Join Audio Chat</h1>
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Your Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="Enter your name"
              className={`w-full px-3 py-2 text-base border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                error ? 'border-red-500' : 'border-gray-300'
              }`}
              required
              autoComplete="name"
              autoFocus
              disabled={isValidating}
            />
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 px-4 text-base rounded-md hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isValidating}
          >
            {isValidating ? 'Checking...' : 'Join Chat Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
