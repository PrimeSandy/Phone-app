const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const nodemailer = require('nodemailer');

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

// Email transporter (for sending direct email requests)
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com', // Replace with your email
    pass: 'your-app-password' // Replace with your app password
  }
});

// MongoDB Schemas
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

const userConnectionSchema = new mongoose.Schema({
  userEmail: String,
  connectedUsers: [String], // List of connected user emails
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ConnectionRequest = mongoose.model('ConnectionRequest', connectionRequestSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const UserConnection = mongoose.model('UserConnection', userConnectionSchema);

// Store active users and connections
const activeUsers = new Map(); // email -> {socketId, lastSeen}
const activeConnections = new Map(); // connectionId -> {users: [email1, email2], createdAt}

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

// Send direct email request
app.post('/api/send-email-request', async (req, res) => {
  try {
    const { senderEmail, receiverEmail } = req.body;
    
    if (!senderEmail || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Sender and receiver emails are required' 
      });
    }
    
    const requestId = uuidv4();
    const shareableLink = `${BASE_URL}/?request=${requestId}`;
    
    // Save request to database
    const request = new ConnectionRequest({
      requestId,
      senderEmail,
      receiverEmail
    });
    await request.save();
    
    // Send email
    const mailOptions = {
      from: 'your-email@gmail.com',
      to: receiverEmail,
      subject: `Connection Request from ${senderEmail}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Connection Request</h2>
          <p>You have received a connection request from <strong>${senderEmail}</strong></p>
          <p>Click the link below to accept the request and start chatting:</p>
          <a href="${shareableLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
            Accept Connection Request
          </a>
          <p>Or copy this link: ${shareableLink}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 14px;">This is an automated message from Echo Connect.</p>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({
      success: true,
      requestId,
      message: 'Connection request sent via email successfully'
    });
    
  } catch (error) {
    console.error('Error sending email request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send email request'
    });
  }
});

// Generate connection request (link only)
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
      error: error.message
    });
  }
});

// Get connection request details
app.get('/api/request/:requestId', async (req, res) => {
  try {
    const requestId = req.params.requestId;
    const request = await ConnectionRequest.findOne({ requestId });
    
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
    
    // Update in database
    const request = await ConnectionRequest.findOne({ requestId });
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
      });
    }
    
    request.receiverEmail = receiverEmail;
    request.status = 'accepted';
    await request.save();
    
    // Create connection
    const connectionId = uuidv4();
    activeConnections.set(connectionId, {
      users: [request.senderEmail, receiverEmail],
      createdAt: new Date(),
      requestId: requestId
    });
    
    // Update user connections in database
    await updateUserConnections(request.senderEmail, receiverEmail);
    await updateUserConnections(receiverEmail, request.senderEmail);
    
    // Notify sender that request was accepted
    const senderSocketId = activeUsers.get(request.senderEmail)?.socketId;
    if (senderSocketId) {
      io.to(senderSocketId).emit('request-accepted', {
        connectionId,
        receiverEmail,
        message: `${receiverEmail} accepted your connection request`
      });
      
      // Send updated contacts list to sender
      const senderContacts = await getUserContacts(request.senderEmail);
      io.to(senderSocketId).emit('contacts-updated', senderContacts);
    }
    
    // Send updated contacts list to receiver
    const receiverSocketId = activeUsers.get(receiverEmail)?.socketId;
    if (receiverSocketId) {
      const receiverContacts = await getUserContacts(receiverEmail);
      io.to(receiverSocketId).emit('contacts-updated', receiverContacts);
    }
    
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

// Helper function to update user connections
async function updateUserConnections(userEmail, connectedUserEmail) {
  let userConnection = await UserConnection.findOne({ userEmail });
  
  if (!userConnection) {
    userConnection = new UserConnection({
      userEmail,
      connectedUsers: [connectedUserEmail]
    });
  } else {
    if (!userConnection.connectedUsers.includes(connectedUserEmail)) {
      userConnection.connectedUsers.push(connectedUserEmail);
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
    
    contacts.push({
      email: connectedEmail,
      isOnline,
      lastSeen: lastSeen.toISOString()
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
      
      // Send updated contacts list to all connected users
      const contacts = await getUserContacts(userEmail);
      socket.emit('contacts-updated', contacts);
      
      // Notify contacts that this user is online
      for (const contact of contacts) {
        const contactSocketId = activeUsers.get(contact.email)?.socketId;
        if (contactSocketId) {
          io.to(contactSocketId).emit('user-status-changed', {
            email: userEmail,
            isOnline: true
          });
        }
      }
      
      // Auto-join existing connections
      for (let [connectionId, connection] of activeConnections) {
        if (connection.users.includes(userEmail)) {
          socket.join(connectionId);
          socket.connectionId = connectionId;
          console.log(`✅ ${userEmail} auto-joined connection: ${connectionId}`);
          
          // Notify other users
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
    
    // Notify other users in the connection
    socket.to(connectionId).emit('user-joined', {
      userEmail,
      message: `${userEmail} joined the connection`,
      timestamp: new Date()
    });
  });

  // Handle chat messages - FIXED DUPLICATE MESSAGE ISSUE
  socket.on('send-message', async (data) => {
    try {
      const { connectionId, message, senderEmail, messageId } = data;
      
      if (!connectionId || !message || !senderEmail) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }
      
      // Check if message already exists (prevent duplicates)
      const existingMessage = await ChatMessage.findOne({ 
        connectionId, 
        senderEmail, 
        message,
        timestamp: { $gte: new Date(Date.now() - 5000) } // Check last 5 seconds
      });
      
      if (existingMessage) {
        console.log('⚠️ Duplicate message prevented:', message);
        return;
      }
      
      // Save message to database
      const chatMessage = new ChatMessage({
        connectionId,
        senderEmail,
        message
      });
      await chatMessage.save();
      
      // Broadcast message to all users in the connection EXCEPT sender
      socket.to(connectionId).emit('receive-message', {
        id: chatMessage._id,
        senderEmail,
        message,
        timestamp: new Date(),
        type: 'text'
      });
      
      // Send confirmation to sender only
      socket.emit('message-sent', {
        id: chatMessage._id,
        message,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle call initiation
  socket.on('start-call', (data) => {
    const { connectionId, userEmail, offer, callType } = data;
    
    console.log(`📞 Call started by ${userEmail} in ${connectionId}`);
    
    // Get the connection
    const connection = activeConnections.get(connectionId);
    if (!connection) {
      socket.emit('error', { message: 'Connection not found' });
      return;
    }
    
    // Find the other user in the connection
    const otherUser = connection.users.find(email => email !== userEmail);
    if (!otherUser) {
      socket.emit('error', { message: 'Other user not found in connection' });
      return;
    }
    
    // Get the other user's socket ID
    const otherUserSocketId = activeUsers.get(otherUser)?.socketId;
    if (!otherUserSocketId) {
      socket.emit('error', { message: 'Other user is offline' });
      return;
    }
    
    console.log(`📞 Sending call to ${otherUser} (${otherUserSocketId})`);
    
    // Send call to the other user
    io.to(otherUserSocketId).emit('incoming-call', {
      offer,
      from: userEmail,
      callType: callType || 'video',
      connectionId,
      timestamp: new Date()
    });
  });

  // Handle call answer
  socket.on('answer-call', (data) => {
    const { connectionId, answer, toUser } = data;
    
    console.log(`📞 Call answered for connection: ${connectionId}`);
    
    // Find the user who initiated the call
    const callerSocketId = activeUsers.get(toUser)?.socketId;
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-answered', { 
        answer,
        connectionId,
        timestamp: new Date()
      });
    }
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    const { connectionId, candidate, toUser } = data;
    
    const targetSocketId = activeUsers.get(toUser)?.socketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { 
        candidate,
        connectionId,
        timestamp: new Date()
      });
    }
  });

  // Handle call end
  socket.on('end-call', (data) => {
    const { connectionId, toUser } = data;
    
    console.log(`📞 Call ended in ${connectionId}`);
    
    if (toUser) {
      const targetSocketId = activeUsers.get(toUser)?.socketId;
      if (targetSocketId) {
        io.to(targetSocketId).emit('call-ended', {
          connectionId,
          timestamp: new Date()
        });
      }
    } else {
      // Broadcast to all in connection
      io.to(connectionId).emit('call-ended', {
        connectionId,
        timestamp: new Date()
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Update last seen and remove from active users
    if (socket.userEmail) {
      const userData = activeUsers.get(socket.userEmail);
      if (userData) {
        userData.lastSeen = new Date();
        // Don't remove from activeUsers immediately, wait for timeout
        setTimeout(() => {
          if (activeUsers.get(socket.userEmail)?.socketId === socket.id) {
            activeUsers.delete(socket.userEmail);
            console.log(`👤 User removed: ${socket.userEmail}`);
            
            // Notify contacts that this user is offline
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
        }, 5000); // 5 second delay
      }
    }
    
    // Notify connection members
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
