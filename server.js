const express = require('express');
const http = require("http");
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
require("dotenv").config();

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

// this is good for small systems but as the system grow switch to Redis for userDeviceMap & unreadMessageQueue
const userDeviceMap = new Map();
const socketMap = new Map();
const unreadMessageQueue = new Map();

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

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    const { userId, deviceId } = socket.handshake.auth;
    const key = userId + deviceId;
    socketMap.set(key, socket.id);
    socket.pagedAuthKey = key;

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        socketMap.delete(socket.pagedAuthKey);
    });
});

// when offline users come online, sync chats with other users
app.get('/sync', authenticateToken, (req, res) => {
    const user = req.user;
    const queueId = user.userID + user.deviceID;

    // get the message from the unread message queue
    const unreadMessageList = unreadMessageQueue.get(queueId);
    unreadMessageQueue.delete(queueId);
    res.json({ user: user.userID, device: user.deviceID, unreadMessages: unreadMessageList });
})

app.get('/get_session', authenticateToken, (req, res) => {
    if(req.user){
        res.status(200).json({ status: "Success" });
    }
})

const sendMessageToUser = (senderId, targetId, message, isGroup = false, groupId = null) => {
    const deviceList = userDeviceMap.get(targetId);
    deviceList.forEach((device) => {
        const now = new Date();
        const isoString = now.toISOString();
        // client first check if isGroup == true, if it is save the msg under the group if not save it under the dm
        const messageObject = { senderId: senderId, msg: message, datetime: isoString, isGroup: isGroup, groupId: groupId };
        const pagedAuthId = targetId+device;
        const socketId = socketMap.get(pagedAuthId);
        if(!socketMap.has(pagedAuthId)){
            if(unreadMessageQueue.has(pagedAuthId)){
                const msgList = unreadMessageQueue.get(pagedAuthId);
                msgList.push(messageObject);
            } else {
                unreadMessageQueue.set(pagedAuthId, [messageObject]);
            }
        } else {
            io.to(socketId).emit("receive_msg", messageObject)
        }
        
    })
}

app.post('/send_message', authenticateToken, (req, res) => {
    const { recipientId, isGroup = false, message, groupMembers = [] } = req.body;
    const senderId = req.user.userID;
    try{
        if(isGroup){
            groupMembers.forEach((member) => {
                sendMessageToUser(senderId, member, message, isGroup, recipientId);
            })
        } else {
            sendMessageToUser(senderId, recipientId, message);
        }
        res.status(200).json({status: "Success"});
    } catch (e){
        res.status(500).json({status: "Failed"});
    }
})

app.post('/login', (req, res) => {
    try{
        const { username, password, deviceID } = req.body;
        // firebase shit
        const userId = "something";
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