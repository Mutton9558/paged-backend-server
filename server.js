const express = require('express');
const http = require("http");
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
require("dotenv").config();
import admin from 'firebase-admin';
import fs from 'fs';

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // change before prod
    origin: "*",
  }
});
const port = 3000;

const SECRET = process.env.JWT_SECRET;

const serviceAccount = JSON.parse(
    fs.readFileSync('./secret.json', 'utf8')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function authenticateToken(req, res, next) {

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, SECRET, (err, user) => {

        if (err) return res.sendStatus(403);

        req.user = user;
        next();
    });
}

async function getAllChats(userId){
    const chatList = await db.collection("Chats").where("chatMembers", "array-contains", userId).get()
    return chatList;
}

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    const { userId, deviceId } = socket.handshake.auth;
    const key = userId + deviceId;
    socket.pagedAuthKey = key;

    const chatList = getAllChats(userId);
    chatList.forEach(chat => {
        socket.join(`room-${chat.id}`);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// when offline users come online, sync chats with other users
// app.get('/sync', authenticateToken, (req, res) => {
//     const user = req.user;
//     const queueId = user.userID + user.deviceID;

//     // get the message from the unread message queue
//     const unreadMessageList = unreadMessageQueue.get(queueId);
//     unreadMessageQueue.delete(queueId);
//     res.json({ user: user.userID, device: user.deviceID, unreadMessages: unreadMessageList });
// })

app.get('/get_session', authenticateToken, (req, res) => {
    if(req.user){
        res.status(200).json({ status: "Success" });
    }
})

app.post('/send_message', authenticateToken, (req, res) => {
    const recipientId = req.body.RecipientId;
    io.to(`room-${recipientId}`).emit("new_message", req);
})

async function getUser(username, password){
    const user = await db.collection("Users").where("username", username).where("password", password).get();
    if(!user.empty){
        return user.id;
    }
    return null;
}

app.post('/login', (req, res) => {
    try{
        const { username, password, deviceID } = req.body;

        const userId = getUser(username, password);
        if(userId == null){
            res.status(400).json({status: "Failed"});
        }
        const payload = {
            userID: userId,
            deviceID: deviceID
        };

        const token = jwt.sign(payload, SECRET, {
            expiresIn: '7 days'
        })

        res.status(200).json({status: "Success", userID: userId, jwt: token});
    } catch (e) {
        res.status(500).json({status: "Failed"});
    }
    
})

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
})