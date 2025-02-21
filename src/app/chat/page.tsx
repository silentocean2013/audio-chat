'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { User, PeerConnection } from '@/types/socket';
import { getSocket, disconnectSocket } from '@/lib/socketClient';

export default function ChatRoom() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const name = searchParams.get('name');
  const [users, setUsers] = useState<User[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [audioLevels, setAudioLevels] = useState<{ [key: string]: number }>({});
  const peerConnections = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // WebRTC configuration
  const configuration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  // Create and manage peer connection
  const createPeerConnection = useCallback((userId: string) => {
    try {
      console.log('[WebRTC] Creating peer connection for user:', userId);
      const peerConnection = new RTCPeerConnection(configuration);

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[WebRTC] Sending ICE candidate to', userId);
          socket?.emit('ice-candidate', {
            to: userId,
            candidate: event.candidate,
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state change:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
          console.log('[WebRTC] Connection failed, cleaning up');
          peerConnections.current.delete(userId);
        }
      };

      // Handle receiving remote stream
      peerConnection.ontrack = (event) => {
        console.log('[WebRTC] Received remote track from', userId);
        const [remoteStream] = event.streams;
        
        // Create audio element for remote stream
        const audioElement = new Audio();
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        
        // Store the audio element
        const peer = peerConnections.current.get(userId);
        if (peer) {
          peer.audioElement = audioElement;
        } else {
          peerConnections.current.set(userId, {
            connection: peerConnection,
            audioElement,
          });
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('[WebRTC] Error creating peer connection:', error);
      return null;
    }
  }, [socket]);

  // Audio analysis functions
  const startAudioAnalysis = useCallback((stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    const audioContext = audioContextRef.current;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    source.connect(analyser);
    audioAnalyserRef.current = analyser;

    const updateAudioLevel = () => {
      if (!audioAnalyserRef.current) return;

      const dataArray = new Uint8Array(audioAnalyserRef.current.frequencyBinCount);
      audioAnalyserRef.current.getByteFrequencyData(dataArray);

      // Calculate average volume level
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const normalizedLevel = average / 255; // Normalize to 0-1 range

      setAudioLevels(prev => ({
        ...prev,
        [name as string]: normalizedLevel
      }));

      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();
  }, [name]);

  const stopAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioAnalyserRef.current = null;
  }, []);

  // WebRTC event handlers
  const handleOffer = useCallback(async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
    try {
      console.log('[WebRTC] Received offer from:', from);
      
      // Clean up existing connection if any
      const existingPeer = peerConnections.current.get(from);
      if (existingPeer) {
        console.log('[WebRTC] Cleaning up existing connection');
        existingPeer.connection.close();
        if (existingPeer.audioElement) {
          existingPeer.audioElement.srcObject = null;
        }
        peerConnections.current.delete(from);
      }

      // Create new peer connection
      const peerConnection = createPeerConnection(from);
      if (!peerConnection || !localStream) return;

      // Add local stream
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Store the connection
      peerConnections.current.set(from, {
        connection: peerConnection,
        audioElement: null,
      });

      // Set remote description (offer)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      // Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log('[WebRTC] Sending answer to:', from);
      socket?.emit('answer', {
        to: from,
        answer,
      });
    } catch (error) {
      console.error('[WebRTC] Error handling offer:', error);
    }
  }, [createPeerConnection, localStream, socket]);

  const handleAnswer = useCallback(async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
    try {
      console.log('[WebRTC] Received answer from:', from);
      const peerConnection = peerConnections.current.get(from)?.connection;
      if (!peerConnection) {
        console.warn('[WebRTC] No peer connection found for:', from);
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('[WebRTC] Error handling answer:', error);
    }
  }, []);

  const handleIceCandidate = useCallback(({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
    try {
      console.log('[WebRTC] Received ICE candidate from:', from);
      const peerConnection = peerConnections.current.get(from)?.connection;
      if (!peerConnection) {
        console.warn('[WebRTC] No peer connection found for:', from);
        return;
      }

      peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('[WebRTC] Error handling ICE candidate:', error);
    }
  }, []);

  // Toggle microphone
  const toggleMicrophone = useCallback(async () => {
    try {
      if (micEnabled) {
        console.log('[ChatRoom] Disabling microphone');
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
          stopAudioAnalysis();
        }
        setLocalStream(null);
        setMicEnabled(false);

        // Close all peer connections when muting
        peerConnections.current.forEach(({ connection, audioElement }) => {
          connection.close();
          if (audioElement) {
            audioElement.srcObject = null;
          }
        });
        peerConnections.current.clear();
      } else {
        console.log('[ChatRoom] Enabling microphone');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
        startAudioAnalysis(stream);
        setMicEnabled(true);

        // Create new connections for all users
        users.forEach(user => {
          if (user.id !== socket?.id) {
            const peerConnection = createPeerConnection(user.id);
            if (peerConnection) {
              stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
              });
              peerConnections.current.set(user.id, {
                connection: peerConnection,
                audioElement: null,
              });
            }
          }
        });
      }

      socket?.emit('mic-toggle', { micEnabled: !micEnabled });
    } catch (error) {
      console.error('[ChatRoom] Error toggling microphone:', error);
      setError('Failed to access microphone. Please check your permissions.');
    }
  }, [micEnabled, localStream, socket, startAudioAnalysis, stopAudioAnalysis, users, createPeerConnection]);

  // Function to add ICE candidate
  const addIceCandidate = async (userId: string, candidate: RTCIceCandidate) => {
    const peer = peerConnections.current.get(userId);
    if (!peer) return;

    try {
      await peer.connection.addIceCandidate(candidate);
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  };

  // Handle incoming WebRTC offer
  const handleOfferWebRTC = useCallback(async ({ offer, from }: { offer: RTCSessionDescription; from: string }) => {
    if (!localStream) return;

    try {
      const peerConnection = new RTCPeerConnection();
      
      // Add local stream
      localStream.getTracks().forEach(track => {
        if (localStream) peerConnection.addTrack(track, localStream);
      });

      // Set remote description (the offer)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Store peer connection
      peerConnections.current.set(from, {
        connection: peerConnection,
        stream: localStream,
      });

      // Send answer back
      socket?.emit('answer', {
        to: from,
        answer: peerConnection.localDescription,
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }, [socket, localStream]);

  // Handle incoming WebRTC answer
  const handleAnswerWebRTC = useCallback(({ answer, from }: { answer: RTCSessionDescription; from: string }) => {
    const peer = peerConnections.current.get(from);
    if (!peer) return;

    try {
      peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }, []);

  // Handle incoming ICE candidate
  const handleIceCandidateWebRTC = useCallback(({ candidate, from }: { candidate: RTCIceCandidate; from: string }) => {
    addIceCandidate(from, candidate);
  }, []);

  // Initialize peer connections when users join
  useEffect(() => {
    users.forEach(async (user) => {
      if (user.id === socket?.id) return; // Skip self

      if (!peerConnections.current.has(user.id) && localStream) {
        console.log('[WebRTC] Initializing connection with user:', user.id);
        const peerConnection = createPeerConnection(user.id);
        if (!peerConnection) return;

        try {
          // Add local stream
          localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
          });

          // Store the connection before creating offer
          peerConnections.current.set(user.id, {
            connection: peerConnection,
            audioElement: null,
          });

          // Create and set local description (offer)
          const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
          });
          await peerConnection.setLocalDescription(offer);

          console.log('[WebRTC] Sending offer to:', user.id);
          socket?.emit('offer', {
            to: user.id,
            offer,
          });
        } catch (error) {
          console.error('[WebRTC] Error creating offer:', error);
          peerConnection.close();
          peerConnections.current.delete(user.id);
        }
      }
    });
  }, [users, socket?.id, createPeerConnection, socket, localStream]);

  // Redirect if no name
  useEffect(() => {
    if (!name) {
      router.replace('/');
    }
  }, [name, router]);

  // Initialize socket connection
  useEffect(() => {
    if (!name) return;

    console.log('[ChatRoom] Setting up socket connection');
    const currentPeerConnections = peerConnections.current;
    const newSocket = getSocket();
    
    if (!newSocket) {
      console.error('[ChatRoom] Failed to create socket');
      setError('Failed to create socket connection');
      setIsConnecting(false);
      return;
    }
    
    setSocket(newSocket);
    setIsConnecting(true);

    const handleConnect = () => {
      console.log('[ChatRoom] Socket connected, joining room');
      setError(null);
      
      // Join room after connection
      if (name) {
        console.log('[ChatRoom] Emitting join-room event:', name);
        newSocket.emit('join-room', { 
          name, 
          micEnabled: false 
        });
      }
    };

    const handleConnectError = (err: Error) => {
      console.error('[ChatRoom] Connection error:', err);
      setIsConnecting(false);
      setError(`Connection error: ${err.message}. Please try again.`);
    };

    const handleJoinError = ({ message }: { message: string }) => {
      console.error('[ChatRoom] Join error:', message);
      setError(message);
      setIsConnecting(false);
      // Redirect back to home after a short delay
      setTimeout(() => {
        router.replace('/');
      }, 2000);
    };

    const handleUsersList = (usersList: User[]) => {
      console.log('[ChatRoom] Received users list:', usersList);
      setUsers(usersList);
      setIsConnecting(false);
    };

    const handleUserJoined = (user: User) => {
      console.log('[ChatRoom] User joined:', user);
      setUsers(prev => {
        if (prev.some(u => u.id === user.id)) {
          return prev;
        }
        return [...prev, user];
      });
    };

    const handleUserLeft = (userId: string) => {
      console.log('[ChatRoom] User left:', userId);
      setUsers(prev => prev.filter(user => user.id !== userId));
      
      // Clean up peer connection
      const peer = peerConnections.current.get(userId);
      if (peer) {
        peer.connection.close();
        peerConnections.current.delete(userId);
      }
    };

    const handleUserUpdated = (user: User) => {
      console.log('[ChatRoom] User updated:', user);
      setUsers(prev => prev.map(u => u.id === user.id ? user : u));
    };

    // Clean up existing listeners before adding new ones
    newSocket.off('connect');
    newSocket.off('connect_error');
    newSocket.off('join-error');
    newSocket.off('users-list');
    newSocket.off('user-joined');
    newSocket.off('user-left');
    newSocket.off('user-updated');
    newSocket.off('offer');
    newSocket.off('answer');
    newSocket.off('ice-candidate');

    // Set up event listeners
    newSocket.on('connect', handleConnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.on('join-error', handleJoinError);
    newSocket.on('users-list', handleUsersList);
    newSocket.on('user-joined', handleUserJoined);
    newSocket.on('user-left', handleUserLeft);
    newSocket.on('user-updated', handleUserUpdated);
    newSocket.on('offer', handleOffer);
    newSocket.on('answer', handleAnswer);
    newSocket.on('ice-candidate', handleIceCandidate);

    // If socket is already connected, join the room immediately
    if (newSocket.connected) {
      console.log('[ChatRoom] Socket already connected, joining room');
      handleConnect();
    }

    return () => {
      console.log('[ChatRoom] Cleaning up socket connection');
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Clean up peer connections
      currentPeerConnections.forEach((peer) => {
        peer.connection.close();
      });
      currentPeerConnections.clear();
      
      // Remove all listeners
      newSocket.off('connect', handleConnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.off('join-error', handleJoinError);
      newSocket.off('users-list', handleUsersList);
      newSocket.off('user-joined', handleUserJoined);
      newSocket.off('user-left', handleUserLeft);
      newSocket.off('user-updated', handleUserUpdated);
      newSocket.off('offer', handleOffer);
      newSocket.off('answer', handleAnswer);
      newSocket.off('ice-candidate', handleIceCandidate);
    };
  }, [name, router, handleOffer, handleAnswer, handleIceCandidate]);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      stopAudioAnalysis();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, [stopAudioAnalysis]);

  // Cleanup peer connections on unmount
  useEffect(() => {
    return () => {
      console.log('[ChatRoom] Cleaning up peer connections');
      peerConnections.current.forEach(({ connection, audioElement }) => {
        if (audioElement) {
          audioElement.srcObject = null;
          audioElement.remove();
        }
        connection.close();
      });
      peerConnections.current.clear();

      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      stopAudioAnalysis();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, [stopAudioAnalysis]);

  if (isConnecting) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-xl">
          <p className="text-sm sm:text-base">Connecting to chat room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed bottom-4 inset-x-4 sm:max-w-sm sm:mx-auto">
        <div className="bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg">
          <p className="text-sm sm:text-base">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">Chat Room</h1>
            <button
              onClick={toggleMicrophone}
              className={`px-4 py-2 rounded-lg transition-colors ${
                micEnabled
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              {micEnabled ? 'Mute' : 'Unmute'} Microphone
            </button>
          </div>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {isConnecting ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
              <p>Connecting to chat room...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Connected Users:</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between bg-gray-50 p-4 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold">
                            {user.name[0].toUpperCase()}
                          </span>
                        </div>
                        {user.micEnabled && (
                          <div 
                            className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full"
                            style={{
                              transform: `scale(${1 + (audioLevels[user.id] || 0)})`,
                              transition: 'transform 0.1s ease-in-out'
                            }}
                          />
                        )}
                      </div>
                      <span className="font-medium">{user.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {user.micEnabled ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M13.359 11.238C13.77 10.572 14 9.811 14 9V4a4 4 0 00-8 0v5c0 .811.229 1.572.64 2.238L4.472 13.406A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07a6.977 6.977 0 003.359-1.692l-2.17-2.17z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
