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
    methods: ["GET", "POST", "DELETE"],
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
const BASE_URL = process.env.BASE_URL || "https://phone-app-8i6m.onrender.com";

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

// Email transporter setup
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

// Test email configuration
emailTransporter.verify(function(error, success) {
  if (error) {
    console.log('❌ Email configuration error:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
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
  timestamp: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false }
});

const userConnectionSchema = new mongoose.Schema({
  userEmail: String,
  connectedUsers: [String],
  connectionHistory: [{
    userEmail: String,
    connectedAt: Date,
    connectionType: String,
    status: { type: String, default: 'active' }
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
    activeConnections: activeConnections.size,
    emailConfigured: !!process.env.EMAIL_USER
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

// Send professional email request
app.post('/api/send-email-request', async (req, res) => {
  try {
    const { senderEmail, receiverEmail, linkType = '24hours' } = req.body;
    
    if (!senderEmail || !receiverEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Sender and receiver emails are required' 
      });
    }
    
    // Check if users are already connected
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
    
    // Save request to database
    const request = new ConnectionRequest({
      requestId,
      senderEmail,
      receiverEmail,
      linkType,
      expiresAt
    });
    await request.save();
    
    const shareableLink = `${BASE_URL}/?request=${requestId}`;
    
    // Send professional email if email is configured
    if (process.env.EMAIL_USER) {
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: receiverEmail,
          subject: `🔗 Connection Request from ${senderEmail} - Echo Pro`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                .features { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .feature-item { margin: 10px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🔗 Echo Pro Connection Request</h1>
                  <p>Professional Communication Platform</p>
                </div>
                <div class="content">
                  <h2>Hello!</h2>
                  <p><strong>${senderEmail}</strong> wants to connect with you on <strong>Echo Pro</strong> - the professional communication platform.</p>
                  
                  <div class="features">
                    <h3>🚀 What you can do with Echo Pro:</h3>
                    <div class="feature-item">✅ <strong>Real-time Chat</strong> - Instant messaging</div>
                    <div class="feature-item">📞 <strong>Voice Calls</strong> - Crystal clear audio calls</div>
                    <div class="feature-item">👥 <strong>Secure Connections</strong> - End-to-end encrypted</div>
                    <div class="feature-item">💼 <strong>Professional Interface</strong> - Clean and modern design</div>
                  </div>
                  
                  <p><strong>Connection Type:</strong> ${linkType === 'permanent' ? 'Permanent Connection 🔄' : '24-Hour Connection ⏰'}</p>
                  <p><strong>Expires:</strong> ${expiresAt.toLocaleString()}</p>
                  
                  <div style="text-align: center;">
                    <a href="${shareableLink}" class="button">Accept Connection Request</a>
                  </div>
                  
                  <p style="font-size: 14px; color: #666;">
                    Or copy this link: <br>
                    <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; word-break: break-all;">${shareableLink}</code>
                  </p>
                  
                  <div class="footer">
                    <p>This is an automated message from Echo Pro. Please do not reply to this email.</p>
                    <p>If you didn't expect this request, you can safely ignore this email.</p>
                  </div>
                </div>
              </div>
            </body>
            </html>
          `
        };
        
        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Professional email sent to ${receiverEmail}`);
        
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Continue even if email fails
      }
    } else {
      console.log('📧 Email not configured - skipping email send');
    }
    
    res.json({
      success: true,
      requestId,
      shareableLink,
      linkType,
      expiresAt,
      message: process.env.EMAIL_USER ? 
        `Professional connection request sent to ${receiverEmail}! They will receive an email with your invitation.` :
        `Connection request created! Share this link: ${shareableLink}`
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

// Delete connection
app.delete('/api/connection/:userEmail/:contactEmail', async (req, res) => {
  try {
    const { userEmail, contactEmail } = req.params;
    
    // Remove from user connections
    await UserConnection.updateOne(
      { userEmail },
      { 
        $pull: { 
          connectedUsers: contactEmail,
          connectionHistory: { userEmail: contactEmail }
        } 
      }
    );
    
    // Remove connection from active connections
    const connectionId = generateConnectionId(userEmail, contactEmail);
    activeConnections.delete(connectionId);
    
    // Notify both users
    const userSocketId = activeUsers.get(userEmail)?.socketId;
    const contactSocketId = activeUsers.get(contactEmail)?.socketId;
    
    if (userSocketId) {
      const userContacts = await getUserContacts(userEmail);
      io.to(userSocketId).emit('contacts-updated', userContacts);
      io.to(userSocketId).emit('notification', {
        type: 'success',
        message: `Connection with ${contactEmail} has been removed`
      });
    }
    
    if (contactSocketId) {
      const contactContacts = await getUserContacts(contactEmail);
      io.to(contactSocketId).emit('contacts-updated', contactContacts);
      io.to(contactSocketId).emit('notification', {
        type: 'info',
        message: `${userEmail} removed your connection`
      });
    }
    
    res.json({
      success: true,
      message: 'Connection deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting connection:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete message
app.delete('/api/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const message = await ChatMessage.findByIdAndUpdate(
      messageId,
      { isDeleted: true },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }
    
    // Notify all users in the connection
    io.to(message.connectionId).emit('message-deleted', {
      messageId: message._id,
      connectionId: message.connectionId
    });
    
    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting message:', error);
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
      connectionId: req.params.connectionId,
      isDeleted: false
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
        connectionType: connectionType,
        status: 'active'
      }]
    });
  } else {
    if (!userConnection.connectedUsers.includes(connectedUserEmail)) {
      userConnection.connectedUsers.push(connectedUserEmail);
      userConnection.connectionHistory.push({
        userEmail: connectedUserEmail,
        connectedAt: new Date(),
        connectionType: connectionType,
        status: 'active'
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
      hist => hist.userEmail === connectedEmail && hist.status === 'active'
    );
    
    if (connectionInfo) {
      contacts.push({
        email: connectedEmail,
        isOnline,
        lastSeen: lastSeen.toISOString(),
        connectionType: connectionInfo.connectionType
      });
    }
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
      
      // Send notification
      socket.emit('notification', {
        type: 'success',
        message: 'Successfully connected to Echo Pro'
      });
      
      for (const contact of contacts) {
        const contactSocketId = activeUsers.get(contact.email)?.socketId;
        if (contactSocketId) {
          io.to(contactSocketId).emit('user-status-changed', {
            email: userEmail,
            isOnline: true
          });
          
          io.to(contactSocketId).emit('notification', {
            type: 'info',
            message: `${userEmail} is now online`
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
    
    socket.emit('notification', {
      type: 'success',
      message: `Joined connection successfully`
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
      
      // Send notification to other users
      socket.to(connectionId).emit('notification', {
        type: 'info',
        message: `New message from ${senderEmail}`
      });
      
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
      socket.emit('notification', {
        type: 'warning',
        message: `${otherUserEmail} is currently offline`
      });
      return;
    }
    
    console.log(`📞 Sending call to ${otherUserEmail} (${otherUserSocketId})`);
    
    // Send call to the other user - MANUAL ANSWERING ONLY
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
    
    socket.emit('notification', {
      type: 'info',
      message: `Calling ${otherUserEmail}...`
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
      
      io.to(callerSocketId).emit('notification', {
        type: 'success',
        message: 'Call answered!'
      });
    }
    
    socket.emit('notification', {
      type: 'success',
      message: 'Call connected successfully!'
    });
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
      
      io.to(callerSocketId).emit('notification', {
        type: 'warning',
        message: 'Call was rejected'
      });
    }
    
    socket.emit('notification', {
      type: 'info',
      message: 'Call rejected'
    });
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
            
            io.to(participantSocketId).emit('notification', {
              type: 'info',
              message: `Call ended. Duration: ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
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
              
              io.to(participantSocketId).emit('notification', {
                type: 'warning',
                message: `${socket.userEmail} disconnected from the call`
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
                  
                  io.to(contactSocketId).emit('notification', {
                    type: 'info',
                    message: `${socket.userEmail} is now offline`
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
  console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured - set EMAIL_USER and EMAIL_PASS env variables'}`);
});
