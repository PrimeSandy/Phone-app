const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS configuration
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

// MongoDB Connection
const MONGO_URI = "mongodb+srv://allrounders9666_db_user:sandy20056db@cluster0call.zl23mfk.mongodb.net/echodb?retryWrites=true&w=majority&appName=Cluster0call";
const BASE_URL = "https://phone-app-8i6m.onrender.com";

console.log('🔗 Connecting to MongoDB...');

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
})
.then(() => {
  console.log('✅ Connected to MongoDB Atlas successfully!');
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// MongoDB Schemas
const connectionRequestSchema = new mongoose.Schema({
  requestId: String,
  senderEmail: String,
  receiverEmail: String,
  status: { type: String, default: 'pending' },
  linkType: { type: String, default: '24hours' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }
});

const chatMessageSchema = new mongoose.Schema({
  connectionId: String,
  senderEmail: String,
  message: String,
  messageType: { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now }
});

const userConnectionSchema = new mongoose.Schema({
  userEmail: String,
  connectedUsers: [String],
  connectionHistory: [{
    userEmail: String,
    connectedAt: Date,
    connectionType: String
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const callHistorySchema = new mongoose.Schema({
  connectionId: String,
  participants: [String],
  callType: { type: String, default: 'voice' },
  startedAt: Date,
  endedAt: Date,
  duration: Number,
  status: String
});

const ConnectionRequest = mongoose.model('ConnectionRequest', connectionRequestSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const UserConnection = mongoose.model('UserConnection', userConnectionSchema);
const CallHistory = mongoose.model('CallHistory', callHistorySchema);

// Store active users and connections
const activeUsers = new Map();
const activeConnections = new Map();
const userConnectionsMap = new Map();
const activeCalls = new Map();

// Set expiration date based on link type
function getExpirationDate(linkType) {
  if (linkType === 'permanent') {
    return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

// Clean up expired requests every hour
setInterval(async () => {
  try {
    const result = await ConnectionRequest.deleteMany({
      expiresAt: { $lt: new Date() },
      linkType: '24hours'
    });
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} expired connection requests`);
    }
  } catch (error) {
    console.error('Error cleaning up expired requests:', error);
  }
}, 60 * 60 * 1000);

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  res.status(200).json({ 
    status: 'OK', 
    database: dbStatus,
    activeUsers: activeUsers.size,
    activeConnections: activeConnections.size
  });
});

// Check if users are already connected
app.get('/api/check-connection/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    
    const userConnection1 = await UserConnection.findOne({ userEmail: user1 });
    const userConnection2 = await UserConnection.findOne({ userEmail: user2 });
    
    const isConnected = userConnection1?.connectedUsers.includes(user2) || 
                       userConnection2?.connectedUsers.includes(user1);
    
    res.json({
      success: true,
      isConnected
    });
  } catch (error) {
    console.error('Error checking connection:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Send direct email request
app.post('/api/send-email-request', async (req, res) => {
  try {
    const { senderEmail, receiverEmail, linkType = '24hours' } = req.body;
    
    if (!senderEmail || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Sender and receiver emails are required' 
      });
    }
    
    const connectionCheck = await UserConnection.findOne({ 
      userEmail: senderEmail,
      connectedUsers: receiverEmail 
    });
    
    if (connectionCheck) {
      return res.status(400).json({ 
        success: false, 
        error: 'You are already connected with this user' 
      });
    }
    
    const requestId = uuidv4();
    const expiresAt = getExpirationDate(linkType);
    
    const request = new ConnectionRequest({
      requestId,
      senderEmail,
      receiverEmail,
      linkType,
      expiresAt
    });
    await request.save();
    
    const shareableLink = `${BASE_URL}/?request=${requestId}`;
    
    res.json({
      success: true,
      requestId,
      shareableLink,
      linkType,
      expiresAt,
      message: `Connection request created! This link is ${linkType === 'permanent' ? 'permanent' : 'valid for 24 hours'}`
    });
    
  } catch (error) {
    console.error('Error creating request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create request'
    });
  }
});

// Generate connection request (link only)
app.post('/api/generate-request', async (req, res) => {
  try {
    const { senderEmail, receiverEmail, linkType = '24hours' } = req.body;
    
    if (!senderEmail || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Sender and receiver emails are required' 
      });
    }
    
    const connectionCheck = await UserConnection.findOne({ 
      userEmail: senderEmail,
      connectedUsers: receiverEmail 
    });
    
    if (connectionCheck) {
      return res.status(400).json({ 
        success: false, 
        error: 'You are already connected with this user' 
      });
    }
    
    const requestId = uuidv4();
    const expiresAt = getExpirationDate(linkType);
    
    const request = new ConnectionRequest({
      requestId,
      senderEmail,
      receiverEmail,
      linkType,
      expiresAt
    });
    await request.save();
    
    const shareableLink = `${BASE_URL}/?request=${requestId}`;
    
    res.json({
      success: true,
      requestId,
      shareableLink,
      linkType,
      expiresAt,
      message: 'Connection request generated successfully'
    });
    
  } catch (error) {
    console.error('Error generating request:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Get connection request details
app.get('/api/request/:requestId', async (req, res) => {
  try {
    const requestId = req.params.requestId;
    const request = await ConnectionRequest.findOne({ 
      requestId,
      $or: [
        { linkType: 'permanent' },
        { expiresAt: { $gt: new Date() } }
      ]
    });
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found or expired' 
      });
    }
    
    res.json({ 
      success: true, 
      request 
    });
    
  } catch (error) {
    console.error('Error fetching request:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Accept connection request
app.post('/api/accept-request', async (req, res) => {
  try {
    const { requestId, receiverEmail } = req.body;
    
    if (!requestId || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Request ID and receiver email are required' 
      });
    }
    
    const request = await ConnectionRequest.findOne({ 
      requestId,
      $or: [
        { linkType: 'permanent' },
        { expiresAt: { $gt: new Date() } }
      ]
    });
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found or expired' 
      });
    }
    
    const existingConnection = await UserConnection.findOne({
      userEmail: request.senderEmail,
      connectedUsers: receiverEmail
    });
    
    if (existingConnection) {
      return res.status(400).json({ 
        success: false, 
        error: 'You are already connected with this user' 
      });
    }
    
    request.receiverEmail = receiverEmail;
    request.status = 'accepted';
    await request.save();
    
    const connectionId = generateConnectionId(request.senderEmail, receiverEmail);
    
    activeConnections.set(connectionId, {
      users: [request.senderEmail, receiverEmail],
      createdAt: new Date(),
      requestId: requestId,
      linkType: request.linkType
    });
    
    await updateUserConnections(request.senderEmail, receiverEmail, request.linkType);
    await updateUserConnections(receiverEmail, request.senderEmail, request.linkType);
    
    updateUserConnectionsMap(request.senderEmail, receiverEmail);
    updateUserConnectionsMap(receiverEmail, request.senderEmail);
    
    const senderSocketId = activeUsers.get(request.senderEmail)?.socketId;
    if (senderSocketId) {
      io.to(senderSocketId).emit('request-accepted', {
        connectionId,
        receiverEmail,
        linkType: request.linkType,
        message: `${receiverEmail} accepted your ${request.linkType} connection request!`
      });
      
      const senderContacts = await getUserContacts(request.senderEmail);
      io.to(senderSocketId).emit('contacts-updated', senderContacts);
    }
    
    const receiverSocketId = activeUsers.get(receiverEmail)?.socketId;
    if (receiverSocketId) {
      const receiverContacts = await getUserContacts(receiverEmail);
      io.to(receiverSocketId).emit('contacts-updated', receiverContacts);
      
      io.to(receiverSocketId).emit('connection-established', {
        connectionId,
        senderEmail: request.senderEmail,
        linkType: request.linkType,
        message: `Connected with ${request.senderEmail} (${request.linkType} connection)`
      });
    }
    
    res.json({
      success: true,
      connectionId,
      senderEmail: request.senderEmail,
      linkType: request.linkType,
      message: 'Connection established successfully'
    });
    
  } catch (error) {
    console.error('Error accepting request:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get user connections
app.get('/api/user-connections/:userEmail', async (req, res) => {
  try {
    const connections = [];
    
    for (let [connectionId, connection] of activeConnections) {
      if (connection.users.includes(req.params.userEmail)) {
        const otherUser = connection.users.find(email => email !== req.params.userEmail);
        connections.push({
          connectionId,
          otherUser,
          isOnline: activeUsers.has(otherUser),
          linkType: connection.linkType
        });
      }
    }
    
    res.json({
      success: true,
      connections
    });
  } catch (error) {
    console.error('Error fetching user connections:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get user contacts
app.get('/api/contacts/:userEmail', async (req, res) => {
  try {
    const contacts = await getUserContacts(req.params.userEmail);
    res.json({
      success: true,
      contacts
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get chat history
app.get('/api/chat/:connectionId', async (req, res) => {
  try {
    const messages = await ChatMessage.find({ 
      connectionId: req.params.connectionId 
    }).sort({ timestamp: 1 });
    
    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get call history
app.get('/api/call-history/:userEmail', async (req, res) => {
  try {
    const history = await CallHistory.find({
      participants: req.params.userEmail
    }).sort({ startedAt: -1 }).limit(50);
    
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Helper function to generate consistent connection ID
function generateConnectionId(user1, user2) {
  const emails = [user1, user2].sort();
  return `${emails[0]}_${emails[1]}`;
}

// Helper function to update user connections in memory
function updateUserConnectionsMap(userEmail, connectedUserEmail) {
  if (!userConnectionsMap.has(userEmail)) {
    userConnectionsMap.set(userEmail, []);
  }
  
  const connections = userConnectionsMap.get(userEmail);
  if (!connections.includes(connectedUserEmail)) {
    connections.push(connectedUserEmail);
  }
}

// Helper function to update user connections in database
async function updateUserConnections(userEmail, connectedUserEmail, connectionType) {
  let userConnection = await UserConnection.findOne({ userEmail });
  
  if (!userConnection) {
    userConnection = new UserConnection({
      userEmail,
      connectedUsers: [connectedUserEmail],
      connectionHistory: [{
        userEmail: connectedUserEmail,
        connectedAt: new Date(),
        connectionType: connectionType
      }]
    });
  } else {
    if (!userConnection.connectedUsers.includes(connectedUserEmail)) {
      userConnection.connectedUsers.push(connectedUserEmail);
      userConnection.connectionHistory.push({
        userEmail: connectedUserEmail,
        connectedAt: new Date(),
        connectionType: connectionType
      });
    }
    userConnection.updatedAt = new Date();
  }
  
  await userConnection.save();
}

// Helper function to get user contacts with online status
async function getUserContacts(userEmail) {
  const userConnection = await UserConnection.findOne({ userEmail });
  if (!userConnection) return [];
  
  const contacts = [];
  for (const connectedEmail of userConnection.connectedUsers) {
    const isOnline = activeUsers.has(connectedEmail);
    const lastSeen = activeUsers.get(connectedEmail)?.lastSeen || new Date();
    const connectionInfo = userConnection.connectionHistory.find(
      hist => hist.userEmail === connectedEmail
    );
    
    contacts.push({
      email: connectedEmail,
      isOnline,
      lastSeen: lastSeen.toISOString(),
      connectionType: connectionInfo?.connectionType || '24hours'
    });
  }
  
  return contacts;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Register user
  socket.on('register-user', async (data) => {
    const { userEmail } = data;
    if (userEmail) {
      activeUsers.set(userEmail, {
        socketId: socket.id,
        lastSeen: new Date()
      });
      
      socket.userEmail = userEmail;
      console.log(`👤 User registered: ${userEmail} (${socket.id})`);
      
      const contacts = await getUserContacts(userEmail);
      socket.emit('contacts-updated', contacts);
      
      const callHistory = await CallHistory.find({
        participants: userEmail
      }).sort({ startedAt: -1 }).limit(20);
      socket.emit('call-history-updated', callHistory);
      
      for (const contact of contacts) {
        const contactSocketId = activeUsers.get(contact.email)?.socketId;
        if (contactSocketId) {
          io.to(contactSocketId).emit('user-status-changed', {
            email: userEmail,
            isOnline: true
          });
        }
      }
      
      for (let [connectionId, connection] of activeConnections) {
        if (connection.users.includes(userEmail)) {
          socket.join(connectionId);
          socket.connectionId = connectionId;
          console.log(`✅ ${userEmail} auto-joined connection: ${connectionId}`);
          
          socket.to(connectionId).emit('user-online', {
            userEmail,
            message: `${userEmail} is now online`
          });
        }
      }
    }
  });

  // Join connection room
  socket.on('join-connection', (data) => {
    const { connectionId, userEmail } = data;
    
    if (!connectionId || !userEmail) {
      socket.emit('error', { message: 'Connection ID and user email are required' });
      return;
    }
    
    socket.join(connectionId);
    socket.connectionId = connectionId;
    socket.userEmail = userEmail;
    
    console.log(`👥 ${userEmail} joined connection: ${connectionId}`);
    
    socket.to(connectionId).emit('user-joined', {
      userEmail,
      message: `${userEmail} joined the connection`,
      timestamp: new Date()
    });
  });

  // Handle chat messages
  socket.on('send-message', async (data) => {
    try {
      const { connectionId, message, senderEmail } = data;
      
      if (!connectionId || !message || !senderEmail) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }
      
      const chatMessage = new ChatMessage({
        connectionId,
        senderEmail,
        message
      });
      await chatMessage.save();
      
      const messageData = {
        id: chatMessage._id,
        senderEmail,
        message,
        timestamp: new Date(),
        type: 'text'
      };
      
      socket.emit('message-sent', messageData);
      socket.to(connectionId).emit('receive-message', messageData);
      
      console.log(`💬 Message sent in ${connectionId} from ${senderEmail}: ${message}`);
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle call initiation
  socket.on('start-call', async (data) => {
    const { userEmail, otherUserEmail, connectionId } = data;
    
    console.log(`📞 Call attempt from ${userEmail} to ${otherUserEmail}`);
    
    // Create call record
    const callHistory = new CallHistory({
      connectionId,
      participants: [userEmail, otherUserEmail],
      callType: 'voice',
      startedAt: new Date(),
      status: 'initiated'
    });
    await callHistory.save();
    
    activeCalls.set(connectionId, {
      callId: callHistory._id,
      startedAt: new Date(),
      participants: [userEmail, otherUserEmail],
      callType: 'voice',
      caller: userEmail
    });
    
    // Get the other user's socket ID
    const otherUserSocketId = activeUsers.get(otherUserEmail)?.socketId;
    if (!otherUserSocketId) {
      socket.emit('call-error', { 
        message: 'User is currently offline' 
      });
      return;
    }
    
    console.log(`📞 Sending call to ${otherUserEmail} (${otherUserSocketId})`);
    
    // Send call to the other user
    io.to(otherUserSocketId).emit('incoming-call', {
      from: userEmail,
      callType: 'voice',
      connectionId,
      callId: callHistory._id,
      timestamp: new Date()
    });
    
    // Confirm to caller
    socket.emit('call-initiated', {
      connectionId,
      callId: callHistory._id,
      to: otherUserEmail
    });
  });

  // Handle call answer
  socket.on('answer-call', async (data) => {
    const { connectionId, toUser, callId } = data;
    
    console.log(`📞 Call answered for connection: ${connectionId}`);
    
    // Update call record
    await CallHistory.findByIdAndUpdate(callId, {
      status: 'answered',
      startedAt: new Date()
    });
    
    // Update active call
    const call = activeCalls.get(connectionId);
    if (call) {
      call.status = 'answered';
      call.startedAt = new Date();
    }
    
    // Find the user who initiated the call
    const callerSocketId = activeUsers.get(toUser)?.socketId;
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-answered', { 
        connectionId,
        callId,
        timestamp: new Date()
      });
    }
  });

  // Handle call rejection
  socket.on('reject-call', async (data) => {
    const { callId, toUser } = data;
    
    console.log(`📞 Call rejected: ${callId}`);
    
    // Update call record
    await CallHistory.findByIdAndUpdate(callId, {
      status: 'rejected',
      endedAt: new Date(),
      duration: 0
    });
    
    // Remove from active calls
    for (let [connId, call] of activeCalls) {
      if (call.callId === callId) {
        activeCalls.delete(connId);
        break;
      }
    }
    
    // Notify caller
    const callerSocketId = activeUsers.get(toUser)?.socketId;
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-rejected', {
        callId,
        timestamp: new Date()
      });
    }
  });

  // Handle call end with duration
  socket.on('end-call', async (data) => {
    const { toUser, connectionId, callId } = data;
    
    console.log(`📞 Call ended from ${socket.userEmail} to ${toUser}`);
    
    const call = activeCalls.get(connectionId);
    if (call && callId) {
      const endedAt = new Date();
      const duration = Math.floor((endedAt - call.startedAt) / 1000);
      
      // Update call record
      await CallHistory.findByIdAndUpdate(callId, {
        status: 'ended',
        endedAt: endedAt,
        duration: duration
      });
      
      activeCalls.delete(connectionId);
      
      // Notify ALL participants
      if (call.participants && call.participants.length > 0) {
        call.participants.forEach(participant => {
          const participantSocketId = activeUsers.get(participant)?.socketId;
          if (participantSocketId) {
            io.to(participantSocketId).emit('call-ended', {
              from: socket.userEmail,
              callId,
              duration,
              timestamp: endedAt,
              endedBy: socket.userEmail
            });
            
            // Send updated call history
            CallHistory.find({
              participants: participant
            }).sort({ startedAt: -1 }).limit(20).then(history => {
              io.to(participantSocketId).emit('call-history-updated', history);
            });
          }
        });
      } else {
        // Fallback: notify specific user
        const targetSocketId = activeUsers.get(toUser)?.socketId;
        if (targetSocketId) {
          io.to(targetSocketId).emit('call-ended', {
            from: socket.userEmail,
            callId,
            duration,
            timestamp: endedAt,
            endedBy: socket.userEmail
          });
        }
      }
    }
  });

  // Handle WebRTC offer
  socket.on('webrtc-offer', (data) => {
    const { offer, toUser } = data;
    const targetSocketId = activeUsers.get(toUser)?.socketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-offer', {
        offer,
        from: socket.userEmail
      });
      console.log(`📞 WebRTC offer sent to ${toUser}`);
    }
  });

  // Handle WebRTC answer
  socket.on('webrtc-answer', (data) => {
    const { answer, toUser } = data;
    const targetSocketId = activeUsers.get(toUser)?.socketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-answer', {
        answer,
        from: socket.userEmail
      });
      console.log(`📞 WebRTC answer sent to ${toUser}`);
    }
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    const { candidate, toUser } = data;
    
    const targetSocketId = activeUsers.get(toUser)?.socketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { 
        candidate,
        from: socket.userEmail
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log('❌ User disconnected:', socket.id);
    
    // End any active calls for this user
    for (let [connectionId, call] of activeCalls) {
      if (call.participants.includes(socket.userEmail)) {
        const endedAt = new Date();
        const duration = Math.floor((endedAt - call.startedAt) / 1000);
        
        await CallHistory.findByIdAndUpdate(call.callId, {
          status: 'ended',
          endedAt: endedAt,
          duration: duration
        });
        
        // Notify other participants
        call.participants.forEach(participant => {
          if (participant !== socket.userEmail) {
            const participantSocketId = activeUsers.get(participant)?.socketId;
            if (participantSocketId) {
              io.to(participantSocketId).emit('call-ended', {
                from: socket.userEmail,
                callId: call.callId,
                duration,
                timestamp: endedAt,
                endedBy: 'system'
              });
            }
          }
        });
        
        activeCalls.delete(connectionId);
      }
    }
    
    // Update last seen and remove from active users
    if (socket.userEmail) {
      const userData = activeUsers.get(socket.userEmail);
      if (userData) {
        userData.lastSeen = new Date();
        setTimeout(() => {
          if (activeUsers.get(socket.userEmail)?.socketId === socket.id) {
            activeUsers.delete(socket.userEmail);
            console.log(`👤 User removed: ${socket.userEmail}`);
            
            getUserContacts(socket.userEmail).then(contacts => {
              for (const contact of contacts) {
                const contactSocketId = activeUsers.get(contact.email)?.socketId;
                if (contactSocketId) {
                  io.to(contactSocketId).emit('user-status-changed', {
                    email: socket.userEmail,
                    isOnline: false,
                    lastSeen: new Date().toISOString()
                  });
                }
              }
            });
          }
        }, 5000);
      }
    }
    
    if (socket.connectionId) {
      socket.to(socket.connectionId).emit('user-left', {
        userEmail: socket.userEmail,
        message: `${socket.userEmail} left the connection`,
        timestamp: new Date()
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`✅ Health check: ${BASE_URL}/health`);
});
