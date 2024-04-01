require("dotenv").config();

const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const redis = require("redis");

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});
const SECRET = process.env.JWT_SECRET;

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

redisClient
  .connect()
  .then(() => {
    console.log("Connected to Redis");
    init();
  })
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
  });

const init = () => {
  const server = new WebSocket.Server({
    port: 8080,
    verifyClient: (info, done) => {
      const token = info.req.headers.authorization?.split(" ")[1];
      if (!token) {
        done(false, 401, "Unauthorized");
      } else {
        jwt.verify(token, SECRET, (err, decoded) => {
          if (err) {
            done(false, 401, "Unauthorized");
          } else {
            info.req.user = decoded;
            done(true);
          }
        });
      }
    },
  });

  const channels = new Map();

  server.on("connection", (ws, req) => {
    const user = req.user;
    console.log(`New client connected: ${user.username}`);

    ws.on("message", (message) => {
      const data = JSON.parse(message);
      const channel = data.channel;

      if (!channels.has(channel)) {
        channels.set(channel, new Set());
      }

      const clients = channels.get(channel);
      clients.add(ws);

      redisClient.get(`notifications:${channel}`, (err, notifications) => {
        if (err) throw err;

        if (notifications) {
          ws.send(
            JSON.stringify({
              channel,
              notifications: JSON.parse(notifications),
            })
          );
        }
      });
    });

    ws.on("close", () => {
      channels.forEach((clients, channel) => {
        clients.delete(ws);
      });
    });
  });

  const publishNotification = (channel, message) => {
    if (channels.has(channel)) {
      const clients = channels.get(channel);
      clients.forEach((client) => {
        client.send(JSON.stringify(message));
      });
    }

    redisClient.get(`notifications:${channel}`, (err, notifications) => {
      if (err) throw err;

      const notificationList = notifications ? JSON.parse(notifications) : [];
      notificationList.push(message);

      redisClient.set(
        `notifications:${channel}`,
        JSON.stringify(notificationList)
      );
    });
  };
  // Example: publish a notification to the 'general' channel
  publishNotification("general", {
    recipient: "all",
    message: "This is a notification for the general channel",
  });

  console.log("WebSocket server started on port 8080");
};

init();
