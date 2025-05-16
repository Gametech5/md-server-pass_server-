require('dotenv').config();
const express = require('express');
const socketIO = require('socket.io');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = socketIO(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e8 // 100MB
});

// Document storage
const documents = new Map();
/*
Structure: {
  text: string,
  version: number,
  operations: Array<Operation>,
  users: Set<userId>,
  createdAt: Date,
  updatedAt: Date
}
*/

// User tracking
const users = new Map();
/*
Structure: {
  socketId: string,
  color: string,
  docId: string,
  position: number,
  selection: {start, end},
  lastActive: Date
}
*/

// Helper functions
const getRandomColor = () => {
  const colors = ['#FF5252', '#4CAF50', '#2196F3', '#FF9800', '#9C27B0'];
  return colors[Math.floor(Math.random() * colors.length)];
};

const updateUserCount = (docId) => {
  const doc = documents.get(docId);
  if (doc) {
    io.to(docId).emit('user-count', doc.users.size);
  }
};

// Operational Transformation functions
const OT = {
  applyOperation(text, operation) {
    switch (operation.type) {
      case 'insert':
        return text.slice(0, operation.position) + 
               operation.text + 
               text.slice(operation.position);
      case 'delete':
        return text.slice(0, operation.position) + 
               text.slice(operation.position + operation.length);
      default:
        return text;
    }
  },

  transformOperation(op1, op2) {
    if (op1.position < op2.position) return op1;
    if (op1.position > op2.position) {
      return {
        ...op1,
        position: op1.position + (op2.type === 'insert' ? op2.text.length : -op2.length)
      };
    }
    return op1;
  },

  // For more complex OT scenarios
  transformCursorPosition(pos, operation) {
    if (operation.type === 'insert') {
      return pos <= operation.position ? pos : pos + operation.text.length;
    } else {
      return pos <= operation.position ? pos : Math.max(operation.position, pos - operation.length);
    }
  }
};

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  const userId = socket.handshake.query.userId || uuidv4().substring(0, 8);
  const userColor = socket.handshake.query.userColor || getRandomColor();

  // Initialize user
  users.set(userId, {
    socketId: socket.id,
    color: userColor,
    docId: null,
    lastActive: new Date()
  });

// Document joining handler with robust error handling
socket.on('join-document', ({ docId, name = `User-${userId.substring(0, 4)}` } = {}, acknowledge) => {
    // Validate input parameters
    if (!docId || typeof docId !== 'string') {
        const error = new Error('Invalid document ID');
        console.error('Join document error:', error.message);
        return acknowledge?.({ status: 'error', message: error.message });
    }

    // Generate a default name if not provided
    name = name || `User-${userId.substring(0, 4)}`;
    console.log(`${userId} (${name}) joining ${docId}`);

    try {
        // Leave previous document if any
        const previousDocId = users.get(userId)?.docId;
        if (previousDocId && previousDocId !== docId) {
            socket.leave(previousDocId);
            const prevDoc = documents.get(previousDocId);
            if (prevDoc) {
                prevDoc.users.delete(userId);
                socket.to(previousDocId).emit('user-disconnected', userId);
                updateUserCount(previousDocId);
            }
        }

        // Join new document room
        socket.join(docId);
        const user = users.get(userId);
        user.docId = docId;
        user.name = name;
        user.lastActive = new Date();

        // Initialize document if new
        if (!documents.has(docId)) {
            documents.set(docId, {
                text: 'Start typing here...',
                version: 0,
                operations: [],
                users: new Set(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        const doc = documents.get(docId);
        doc.users.add(userId);
        doc.updatedAt = new Date();

        // Get existing users info (excluding current user)
        const existingUsers = Array.from(doc.users)
            .filter(id => id !== userId)
            .map(id => {
                const u = users.get(id);
                return { 
                    userId: id, 
                    color: u.color, 
                    name: u.name,
                    position: u.position,
                    selection: u.selection
                };
            });

        // Send success response
        const response = {
            status: 'success',
            text: doc.text,
            version: doc.version,
            userId,
            userColor,
            existingUsers,
            documentId: docId
        };

        acknowledge?.(response);

        // Notify others about new user
        socket.to(docId).emit('user-connected', {
            userId,
            userColor,
            name,
            position: user.position,
            selection: user.selection
        });

        updateUserCount(docId);

    } catch (error) {
        console.error('Error joining document:', error);
        acknowledge?.({ 
            status: 'error', 
            message: error.message,
            code: error.code || 'JOIN_ERROR'
        });
    }
});

  // Text operation handler
  socket.on('client-operation', ({ docId, operation, clientVersion }, callback) => {
    try {
      const doc = documents.get(docId);
      if (!doc) {
        throw new Error('Document not found');
      }

      // Validate operation
      if (!operation || !operation.type || operation.position === undefined) {
        throw new Error('Invalid operation format');
      }

      // Transform operation against missed operations
      let transformedOp = operation;
      if (clientVersion < doc.version) {
        for (let i = clientVersion; i < doc.version; i++) {
          transformedOp = OT.transformOperation(transformedOp, doc.operations[i]);
        }
      }

      // Apply operation
      doc.text = OT.applyOperation(doc.text, transformedOp);
      doc.operations.push(transformedOp);
      doc.version++;
      doc.updatedAt = new Date();

      // Broadcast transformed operation
      socket.to(docId).emit('server-operation', {
        operation: transformedOp,
        version: doc.version,
        userId
      });

      // Update user's last active time
      const user = users.get(userId);
      if (user) {
        user.lastActive = new Date();
      }

      callback({ status: 'success', version: doc.version });
    } catch (error) {
      console.error('Error processing operation:', error);
      if (typeof callback === 'function') {
  callback({ status: 'error', message: error.message });
}

    }
  });

  // Cursor position update handler
  socket.on('cursor-position', ({ position, selection }) => {
    const user = users.get(userId);
    if (!user || !user.docId) return;

    user.position = position;
    user.selection = selection;
    user.lastActive = new Date();

    // Broadcast to other users in same document
    socket.to(user.docId).emit('user-position', {
      userId,
      position,
      selection,
      color: user.color,
      name: user.name
    });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log('Disconnected:', userId);
    const user = users.get(userId);
    if (!user) return;

    // Notify document members about disconnection
    if (user.docId) {
      const doc = documents.get(user.docId);
      if (doc) {
        doc.users.delete(userId);
        socket.to(user.docId).emit('user-disconnected', userId);
        updateUserCount(user.docId);
        doc.updatedAt = new Date();
      }
    }

    users.delete(userId);
  });
});

// REST API endpoints
app.get('/api/documents', (req, res) => {
  const docs = Array.from(documents.entries()).map(([id, doc]) => ({
    id,
    userCount: doc.users.size,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    version: doc.version
  }));
  res.json(docs);
});

app.get('/api/documents/:id', (req, res) => {
  const doc = documents.get(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.json({
    id: req.params.id,
    text: doc.text,
    version: doc.version,
    userCount: doc.users.size,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    documents: documents.size,
    users: users.size,
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});


// Cleanup inactive documents periodically
setInterval(() => {
  const now = new Date();
  const inactiveThreshold = 24 * 60 * 60 * 1000; // 24 hours

  for (const [docId, doc] of documents) {
    // Cleanup documents with no users and older than threshold
    if (doc.users.size === 0 && (now - doc.updatedAt) > inactiveThreshold) {
      documents.delete(docId);
      console.log(`Cleaned up inactive document: ${docId}`);
    }
  }

  // Cleanup disconnected users
  for (const [userId, user] of users) {
    if ((now - user.lastActive) > inactiveThreshold) {
      users.delete(userId);
      console.log(`Cleaned up inactive user: ${userId}`);
    }
  }
}, 3600000); // Run every hour

// Start server - REMOVE THE DUPLICATE LISTEN CALL
const PORT = 3002;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  Server running on port ${PORT}
  Mode: ${process.env.NODE_ENV || 'development'}
  CORS Allowed Origins: ${process.env.ALLOWED_ORIGINS || '*'}
  `);
  console.log(`Accessible at: http://192.168.1.250:${PORT}`);
});
