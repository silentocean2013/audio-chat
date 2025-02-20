'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import io, { Socket } from 'socket.io-client';
import { MicrophoneIcon, NoSymbolIcon } from '@heroicons/react/24/solid';

interface User {
  id: string;
  name: string;
  micEnabled?: boolean;
}

interface PeerConnection {
  connection: RTCPeerConnection;
  stream: MediaStream;
  pendingCandidates?: RTCIceCandidate[];
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
  const peerConnections = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  // Function to add ICE candidate with queue support
  const addIceCandidate = async (userId: string, candidate: RTCIceCandidate) => {
    const peer = peerConnections.current.get(userId);
    if (!peer) return;

    const { connection } = peer;
    
    try {
      if (connection.remoteDescription && connection.remoteDescription.type) {
        await connection.addIceCandidate(candidate);
      } else {
        // Queue the candidate if remote description is not set
        if (!peer.pendingCandidates) {
          peer.pendingCandidates = [];
        }
        peer.pendingCandidates.push(candidate);
      }
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  };

  // Function to process pending ICE candidates
  const processPendingCandidates = async (userId: string) => {
    const peer = peerConnections.current.get(userId);
    if (!peer || !peer.pendingCandidates) return;

    const { connection, pendingCandidates } = peer;
    
    try {
      for (const candidate of pendingCandidates) {
        await connection.addIceCandidate(candidate);
      }
      peer.pendingCandidates = [];
    } catch (err) {
      console.error('Error processing pending candidates:', err);
    }
  };

  // Function to create and send an offer
  const createOffer = async (userId: string, stream: MediaStream) => {
    try {
      console.log('Creating offer for user:', userId);
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      // Add local stream tracks to peer connection
      stream.getTracks().forEach(track => {
        console.log('Adding track to peer connection:', track.kind, track.id);
        peerConnection.addTrack(track, stream);
      });

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('Generated ICE candidate for:', userId);
          socket?.emit('ice-candidate', {
            candidate: event.candidate,
            to: userId,
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state for ${userId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          console.log('WebRTC connection established with:', userId);
        }
      };

      // Handle ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${userId}:`, peerConnection.iceConnectionState);
      };

      // Handle signaling state
      peerConnection.onsignalingstatechange = () => {
        console.log(`Signaling state for ${userId}:`, peerConnection.signalingState);
      };

      // Create and send the offer
      console.log('Creating offer...');
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      console.log('Setting local description...');
      await peerConnection.setLocalDescription(offer);
      console.log('Sending offer to:', userId);
      socket?.emit('offer', {
        offer,
        to: userId,
      });

      peerConnections.current.set(userId, { 
        connection: peerConnection, 
        stream,
        pendingCandidates: [] 
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  };

  // Function to handle received offers
  const handleOffer = async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
    try {
      console.log('Received offer from:', data.from);
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      // Add local stream if it exists
      if (localStreamRef.current) {
        console.log('Adding local stream tracks to answer...');
        localStreamRef.current.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind, track.id);
          peerConnection.addTrack(track, localStreamRef.current!);
        });
      }

      // Handle incoming streams
      peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind, event.track.id);
        const [remoteStream] = event.streams;
        console.log('Remote stream tracks:', remoteStream.getTracks().map(t => t.kind));
        
        // Create a new audio element for this stream
        const audioElement = new Audio();
        audioElement.autoplay = true;
        audioElement.playsInline = true;
        audioElement.muted = false;
        audioElement.srcObject = remoteStream;
        
        // Add error handling for audio playback
        audioElement.onerror = (e) => {
          console.error('Audio element error:', e);
        };
        
        // Add event listener for when the audio starts playing
        audioElement.onplay = () => {
          console.log('Audio started playing');
        };
        
        // Try playing the audio
        audioElement.play().then(() => {
          console.log('Audio playback started successfully');
        }).catch(err => {
          console.error('Error playing audio:', err);
        });
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('Generated ICE candidate for:', data.from);
          socket?.emit('ice-candidate', {
            candidate: event.candidate,
            to: data.from,
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state for ${data.from}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          console.log('WebRTC connection established with:', data.from);
        }
      };

      // Handle ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${data.from}:`, peerConnection.iceConnectionState);
      };

      // Handle signaling state
      peerConnection.onsignalingstatechange = () => {
        console.log(`Signaling state for ${data.from}:`, peerConnection.signalingState);
      };

      // Set remote description and create answer
      console.log('Setting remote description...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      console.log('Creating answer...');
      const answer = await peerConnection.createAnswer();
      console.log('Setting local description...');
      await peerConnection.setLocalDescription(answer);

      console.log('Sending answer to:', data.from);
      socket?.emit('answer', {
        answer,
        to: data.from,
      });

      const newStream = new MediaStream();
      peerConnections.current.set(data.from, { 
        connection: peerConnection, 
        stream: newStream,
        pendingCandidates: [] 
      });

      // Process any pending candidates
      await processPendingCandidates(data.from);
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  // Function to handle received answers
  const handleAnswer = async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
    console.log('Received answer from:', data.from);
    const peer = peerConnections.current.get(data.from);
    if (peer?.connection) {
      try {
        console.log('Setting remote description from answer...');
        await peer.connection.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Remote description set successfully');
        // Process any pending candidates after setting remote description
        await processPendingCandidates(data.from);
      } catch (err) {
        console.error('Error setting remote description:', err);
      }
    }
  };

  // Function to handle ICE candidates
  const handleIceCandidate = async (data: { from: string; candidate: RTCIceCandidate }) => {
    console.log('Received ICE candidate from:', data.from);
    await addIceCandidate(data.from, data.candidate);
  };

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
          
          // Clean up peer connections
          peerConnections.current.forEach((peer) => {
            peer.connection.close();
          });
          peerConnections.current.clear();
        });

        newSocket.on('users-list', (usersList: User[]) => {
          console.log('Received users list:', usersList);
          setUsers(usersList);
          
          // Initialize peer connections with existing users
          if (localStreamRef.current) {
            usersList.forEach((user) => {
              if (user.id !== newSocket?.id && user.micEnabled) {
                createOffer(user.id, localStreamRef.current!);
              }
            });
          }
        });

        newSocket.on('user-joined', (user: User) => {
          console.log('User joined:', user);
          setUsers(prev => {
            if (prev.some(u => u.id === user.id)) {
              return prev;
            }
            return [...prev, user];
          });
          
          // Create offer for new user if we have a stream
          if (localStreamRef.current && user.micEnabled) {
            createOffer(user.id, localStreamRef.current);
          }
        });

        newSocket.on('user-left', (userId: string) => {
          console.log('User left:', userId);
          setUsers(prev => prev.filter(user => user.id !== userId));
          
          // Clean up peer connection
          const peer = peerConnections.current.get(userId);
          if (peer) {
            peer.connection.close();
            peerConnections.current.delete(userId);
          }
        });

        newSocket.on('user-mic-toggle', (data: { id: string; micEnabled: boolean }) => {
          console.log('User toggled mic:', data);
          setUsers(prev => prev.map(user => 
            user.id === data.id ? { ...user, micEnabled: data.micEnabled } : user
          ));
          
          // Handle peer connection based on mic state
          if (data.micEnabled && localStreamRef.current) {
            createOffer(data.id, localStreamRef.current);
          } else {
            const peer = peerConnections.current.get(data.id);
            if (peer) {
              peer.connection.close();
              peerConnections.current.delete(data.id);
            }
          }
        });

        // WebRTC signaling events
        newSocket.on('offer', handleOffer);
        newSocket.on('answer', handleAnswer);
        newSocket.on('ice-candidate', handleIceCandidate);

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
      // Clean up all peer connections
      peerConnections.current.forEach((peer) => {
        peer.connection.close();
      });
      peerConnections.current.clear();
    };
  }, [name]);

  const toggleMicrophone = async () => {
    try {
      if (!micEnabled) {
        console.log('Requesting microphone access...');
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        console.log('Microphone access granted');
        console.log('Audio tracks:', audioStream.getAudioTracks().map(t => ({ 
          id: t.id, 
          label: t.label,
          enabled: t.enabled,
          muted: t.muted
        })));
        
        setStream(audioStream);
        localStreamRef.current = audioStream;
        
        // Create peer connections with all users who have their mics enabled
        users.forEach((user) => {
          if (user.id !== socket?.id && user.micEnabled) {
            console.log('Creating peer connection with:', user.id);
            createOffer(user.id, audioStream);
          }
        });
      } else {
        if (stream) {
          console.log('Stopping all audio tracks...');
          stream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped track:', track.kind, track.id);
          });
          setStream(null);
          localStreamRef.current = null;
          
          // Close all peer connections
          console.log('Closing all peer connections...');
          peerConnections.current.forEach((peer, userId) => {
            console.log('Closing connection with:', userId);
            peer.connection.close();
          });
          peerConnections.current.clear();
        }
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
