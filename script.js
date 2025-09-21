// Global variables
let localStream = null;
let roomId = null;
let userName = null;
let socket = null;
const peers = {};
const userMediaConstraints = {
    video: true,
    audio: true
};

// DOM elements
const setupScreen = document.getElementById('setupScreen');
const mainContent = document.getElementById('mainContent');
const roomIdInput = document.getElementById('roomIdInput');
const userNameInput = document.getElementById('userNameInput');
const joinBtn = document.getElementById('joinBtn');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
const participantsContainer = document.getElementById('participants');
const participantList = document.getElementById('participantList');
const participantCount = document.getElementById('participantCount');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const hangupBtn = document.getElementById('hangupBtn');

// Initialize the application
function init() {
    // Event listeners
    joinBtn.addEventListener('click', joinRoom);
    copyRoomIdBtn.addEventListener('click', copyRoomId);
    sendMessageBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Control buttons
    muteBtn.addEventListener('click', toggleAudio);
    videoBtn.addEventListener('click', toggleVideo);
    screenShareBtn.addEventListener('click', toggleScreenShare);
    hangupBtn.addEventListener('click', leaveRoom);
    
    // Initialize Socket.io
  // Initialize Socket.io
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    socket = io(); // Connect to local server in development
} else {
    socket = io(process.env.NEXT_PUBLIC_BACKEND_URL); // Connect to Railway using environment variable
}

    setupSocketListeners();
}

// Set up Socket.io event listeners
function setupSocketListeners() {
    socket.on('user-connected', (userId) => {
        console.log('User connected:', userId);
        addUserToParticipants(userId);
        createPeerConnection(userId, true);
    });
    
    socket.on('user-disconnected', (userId) => {
        console.log('User disconnected:', userId);
        removeUserFromParticipants(userId);
        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }
        removeVideoElement(userId);
    });
    
    socket.on('current-users', (users) => {
        console.log('Current users in room:', users);
        users.forEach(userId => {
            addUserToParticipants(userId);
            createPeerConnection(userId, false);
        });
    });
    
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    
    socket.on('receive-message', (data) => {
        addMessage(data.userId, data.message, data.timestamp, false);
    });
}

// Join a room
async function joinRoom() {
    roomId = roomIdInput.value || generateRoomId();
    userName = userNameInput.value || `User${Math.floor(Math.random() * 1000)}`;
    
    if (!userName.trim()) {
        alert('Please enter your name');
        return;
    }
    
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia(userMediaConstraints);
        
        // Show local video
        createVideoElement(socket.id, localStream, userName, true);
        
        // Join the room via Socket.io
        socket.emit('join-room', roomId, socket.id);
        
        // Update UI
        roomIdDisplay.textContent = roomId;
        addUserToParticipants(socket.id, userName, true);
        updateParticipantCount();
        
        // Switch to main content view
        setupScreen.classList.add('hidden');
        mainContent.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access your camera and microphone. Please check permissions.');
    }
}

// Create a peer connection
function createPeerConnection(userId, isInitiator) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            // Free STUN servers
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            
            // Free TURN servers (critical for cross-network connections)
            { 
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            { 
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            { 
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            // Backup TURN servers
            {
                urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
                username: 'webrtc',
                credential: 'webrtc'
            }
        ],
        iceTransportPolicy: 'all' // Use both UDP and TCP
    });
    // Add this function to monitor WebRTC statistics
    function monitorConnection(peerConnection, userId) {
        setInterval(async () => {
            try {
                const stats = await peerConnection.getStats();
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        console.log(`Connection established for ${userId} using:`, 
                                report.localCandidateId.includes('relay') ? 'TURN relay' : 'direct connection');
                    }
                });
            } catch (error) {
                console.log('Error getting stats for', userId, error);
            }
        }, 5000); // Check every 5 seconds
    }

// Call this after creating each peer connection
// monitorConnection(peerConnection, userId);
    
    // Add connection state monitoring
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${userId}:`, peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.log('ICE connection failed, may need TURN server');
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state for ${userId}:`, peerConnection.connectionState);
    };
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream for:', userId);
        const remoteStream = event.streams[0];
        createVideoElement(userId, remoteStream);
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate,
                sender: socket.id
            });
        } else {
            console.log('ICE gathering complete for:', userId);
        }
    };
    
    // Handle negotiation needed event
    peerConnection.onnegotiationneeded = () => {
        console.log('Negotiation needed for:', userId);
    };
    
    peers[userId] = peerConnection;
    
    // Create offer if initiator
    if (isInitiator) {
        setTimeout(() => {
            createOffer(userId);
        }, 1000); // Small delay to ensure everything is ready
    }
    
    return peerConnection;
}

// Create and send offer
async function createOffer(userId) {
    const peerConnection = peers[userId];
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: userId,
            offer: offer,
            sender: socket.id
        });
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

// Handle incoming offer
async function handleOffer(data) {
    const peerConnection = createPeerConnection(data.sender, false);
    
    try {
        await peerConnection.setRemoteDescription(data.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer,
            sender: socket.id
        });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

// Handle incoming answer
async function handleAnswer(data) {
    const peerConnection = peers[data.sender];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(data.answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
}

// Handle ICE candidate
async function handleIceCandidate(data) {
    const peerConnection = peers[data.sender];
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
}

// Create video element for a user
function createVideoElement(userId, stream, name = 'User', isLocal = false) {
    // Remove existing video element if any
    removeVideoElement(userId);
    
    const videoCard = document.createElement('div');
    videoCard.className = 'video-card';
    videoCard.id = `video-${userId}`;
    
    const videoElement = document.createElement('video');
    videoElement.className = 'video-element';
    videoElement.srcObject = stream;
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.muted = isLocal;
    
    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';
    
    const userAvatar = document.createElement('div');
    userAvatar.className = 'user-avatar';
    userAvatar.innerHTML = '<i class="fas fa-user"></i>';
    
    const userNameEl = document.createElement('div');
    userNameEl.className = 'user-name';
    userNameEl.textContent = name || `User ${userId.substring(0, 5)}`;
    
    userInfo.appendChild(userAvatar);
    userInfo.appendChild(userNameEl);
    
    videoCard.appendChild(videoElement);
    videoCard.appendChild(userInfo);
    
    participantsContainer.appendChild(videoCard);
}

// Remove video element
function removeVideoElement(userId) {
    const videoElement = document.getElementById(`video-${userId}`);
    if (videoElement) {
        videoElement.remove();
    }
}

// Add user to participants list
function addUserToParticipants(userId, name = null, isLocal = false) {
    // Check if user already exists in the list
    const existingUser = document.getElementById(`participant-${userId}`);
    if (existingUser) return;
    
    const listItem = document.createElement('li');
    listItem.id = `participant-${userId}`;
    
    const userAvatar = document.createElement('div');
    userAvatar.className = 'user-avatar';
    userAvatar.innerHTML = '<i class="fas fa-user"></i>';
    
    const userName = document.createElement('span');
    userName.className = 'participant-name';
    userName.textContent = isLocal ? `${name} (You)` : (name || `User ${userId.substring(0, 5)}`);
    
    listItem.appendChild(userAvatar);
    listItem.appendChild(userName);
    
    participantList.appendChild(listItem);
    updateParticipantCount();
}

// Remove user from participants list
function removeUserFromParticipants(userId) {
    const userElement = document.getElementById(`participant-${userId}`);
    if (userElement) {
        userElement.remove();
        updateParticipantCount();
    }
}

// Update participant count
function updateParticipantCount() {
    const count = participantList.children.length;
    participantCount.textContent = count;
}

// Add message to chat
function addMessage(userId, message, timestamp, isOwn = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isOwn ? 'own' : ''}`;
    
    const senderElement = document.createElement('div');
    senderElement.className = 'message-sender';
    senderElement.textContent = isOwn ? 'You' : `User ${userId.substring(0, 5)}`;
    
    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    textElement.textContent = message;
    
    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    timeElement.textContent = new Date(timestamp).toLocaleTimeString();
    
    messageElement.appendChild(senderElement);
    messageElement.appendChild(textElement);
    messageElement.appendChild(timeElement);
    
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send chat message
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;
    
    socket.emit('send-message', {
        roomId: roomId,
        userId: socket.id,
        message: message
    });
    
    addMessage(socket.id, message, new Date().toISOString(), true);
    messageInput.value = '';
}

// Toggle audio
function toggleAudio() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        const enabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !enabled;
        
        muteBtn.classList.toggle('active', !enabled);
        muteBtn.innerHTML = enabled ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    }
}

// Toggle video
function toggleVideo() {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
        const enabled = videoTracks[0].enabled;
        videoTracks[0].enabled = !enabled;
        
        videoBtn.classList.toggle('active', !enabled);
        videoBtn.innerHTML = enabled ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    }
}

// Toggle screen share
async function toggleScreenShare() {
    try {
        if (!localStream) return;
        
        const videoTrack = localStream.getVideoTracks()[0];
        
        if (!screenShareBtn.classList.contains('active')) {
            // Start screen share
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace the video track in local stream and all peer connections
            localStream.removeTrack(videoTrack);
            localStream.addTrack(screenTrack);
            
            // Replace track in all peer connections
            for (const userId in peers) {
                const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            }
            
            screenShareBtn.classList.add('active');
            
            // When screen sharing stops, revert to camera
            screenTrack.onended = toggleScreenShare;
        } else {
            // Stop screen share and revert to camera
            const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const cameraTrack = cameraStream.getVideoTracks()[0];
            
            localStream.removeTrack(localStream.getVideoTracks()[0]);
            localStream.addTrack(cameraTrack);
            
            // Replace track in all peer connections
            for (const userId in peers) {
                const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(cameraTrack);
                }
            }
            
            screenShareBtn.classList.remove('active');
        }
    } catch (error) {
        console.error('Error toggling screen share:', error);
    }
}

// Leave the room
function leaveRoom() {
    // Close all peer connections
    for (const userId in peers) {
        peers[userId].close();
    }
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Leave the room
    if (socket && roomId) {
        socket.emit('leave-room', roomId, socket.id);
    }
    
    // Reset UI
    setupScreen.classList.remove('hidden');
    mainContent.classList.add('hidden');
    participantsContainer.innerHTML = '';
    participantList.innerHTML = '';
    chatMessages.innerHTML = '';
    
    // Reset state
    localStream = null;
    roomId = null;
    userName = null;
}

// Copy room ID to clipboard
function copyRoomId() {
    navigator.clipboard.writeText(roomId).then(() => {
        const originalHtml = copyRoomIdBtn.innerHTML;
        copyRoomIdBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyRoomIdBtn.innerHTML = originalHtml;
        }, 2000);
    });
}
// Add this function to check connection status
function checkConnectionStatus(peerConnection, userId) {
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${userId}:`, peerConnection.iceConnectionState);
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state for ${userId}:`, peerConnection.connectionState);
    };
    
    peerConnection.onicegatheringstatechange = () => {
        console.log(`ICE gathering state for ${userId}:`, peerConnection.iceGatheringState);
    };
}


// Generate a random room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);