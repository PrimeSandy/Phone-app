const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS configuration for online deployment
const io = socketIo(server, {
  cors: {
    origin: ["https://phone-app-8i6m.onrender.com", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ["https://phone-app-8i6m.onrender.com", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

// MongoDB Connection - Using your online MongoDB
const MONGO_URI = "mongodb+srv://allrounders9666_db_user:sandy20056db@cluster0call.zl23mfk.mongodb.net/echodb?retryWrites=true&w=majority&appName=Cluster0call";
const BASE_URL = "https://phone-app-8i6m.onrender.com";

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  email: String,
  firebaseUID: String,
  displayName: String,
  createdAt: { type: Date, default: Date.now }
});

const connectionRequestSchema = new mongoose.Schema({
  requestId: String,
  senderEmail: String,
  receiverEmail: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const chatMessageSchema = new mongoose.Schema({
  connectionId: String,
  senderEmail: String,
  message: String,
  messageType: { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const ConnectionRequest = mongoose.model('ConnectionRequest', connectionRequestSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

// Store active connections and calls
const activeConnections = new Map();
const activeCalls = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL
  });
});

// Generate connection request
app.post('/api/generate-request', async (req, res) => {
  try {
    const { senderEmail, receiverEmail } = req.body;
    
    if (!senderEmail || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Sender and receiver emails are required' 
      });
    }
    
    const requestId = uuidv4();
    
    const request = new ConnectionRequest({
      requestId,
      senderEmail,
      receiverEmail
    });
    
    await request.save();
    
    const shareableLink = `${BASE_URL}/?request=${requestId}`;
    
    res.json({
      success: true,
      requestId,
      shareableLink,
      message: 'Connection request generated successfully'
    });
  } catch (error) {
    console.error('Error generating request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Get connection request details
app.get('/api/request/:requestId', async (req, res) => {
  try {
    const request = await ConnectionRequest.findOne({ 
      requestId: req.params.requestId 
    });
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
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
      error: 'Internal server error' 
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
    
    const request = await ConnectionRequest.findOne({ requestId });
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: 'Request already processed' 
      });
    }
    
    request.receiverEmail = receiverEmail;
    request.status = 'accepted';
    await request.save();
    
    // Create connection ID
    const connectionId = uuidv4();
    activeConnections.set(connectionId, {
      users: [request.senderEmail, receiverEmail],
      createdAt: new Date(),
      requestId: requestId
    });
    
    res.json({
      success: true,
      connectionId,
      senderEmail: request.senderEmail,
      message: 'Connection established successfully'
    });
  } catch (error) {
    console.error('Error accepting request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
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
      error: 'Internal server error' 
    });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

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
    
    // Notify other users in the connection
    socket.to(connectionId).emit('user-joined', {
      userEmail,
      message: `${userEmail} joined the connection`,
      timestamp: new Date()
    });
    
    // Send connection info to the user
    socket.emit('connection-joined', {
      connectionId,
      message: 'Successfully joined connection'
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
      
      // Save message to database
      const chatMessage = new ChatMessage({
        connectionId,
        senderEmail,
        message
      });
      await chatMessage.save();
      
      // Broadcast message to all users in the connection
      io.to(connectionId).emit('receive-message', {
        id: chatMessage._id,
        senderEmail,
        message,
        timestamp: new Date(),
        type: 'text'
      });
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle call initiation
  socket.on('start-call', (data) => {
    const { connectionId, userEmail, offer, callType } = data;
    
    activeCalls.set(connectionId, { 
      offer, 
      initiator: userEmail,
      callType: callType || 'video',
      startedAt: new Date()
    });
    
    socket.to(connectionId).emit('incoming-call', {
      offer,
      from: userEmail,
      callType: callType || 'video',
      timestamp: new Date()
    });
    
    console.log(`📞 Call started by ${userEmail} in ${connectionId}`);
  });

  // Handle call answer
  socket.on('answer-call', (data) => {
    const { connectionId, answer } = data;
    socket.to(connectionId).emit('call-answered', { 
      answer,
      timestamp: new Date()
    });
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    const { connectionId, candidate } = data;
    socket.to(connectionId).emit('ice-candidate', { 
      candidate,
      timestamp: new Date()
    });
  });

  // Handle call end
  socket.on('end-call', (data) => {
    const { connectionId } = data;
    activeCalls.delete(connectionId);
    socket.to(connectionId).emit('call-ended', {
      timestamp: new Date()
    });
    console.log(`📞 Call ended in ${connectionId}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
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
  console.log(`🔗 MongoDB: Connected to Atlas`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`✅ Health check: ${BASE_URL}/health`);
});
