const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

const connections = {};

io.on("connection", (socket) => {
    console.log("🟢 Usuario conectado:", socket.id);

    socket.on("startConnection", async (data) => {
        const { username } = data;

        if (!username) {
            socket.emit("status", "error");
            return;
        }

        // Si ya existe conexión anterior, la cerramos
        if (connections[socket.id]) {
            connections[socket.id].tiktokConnection.disconnect();
            delete connections[socket.id];
        }

        const tiktokConnection = new WebcastPushConnection(username);

        try {
            console.log(`🔥 Intentando conectar a TikTok: ${username}`);

            await tiktokConnection.connect();

            connections[socket.id] = {
                username,
                tiktokConnection
            };

            console.log("✅ Conectado correctamente");

            socket.emit("status", "connected");

            // 🎁 Regalos
            tiktokConnection.on("gift", (giftData) => {
                console.log("🎁 Gift:", giftData.giftName);

                socket.emit("gift", {
                    user: giftData.nickname,
                    gift: giftData.giftName,
                    amount: giftData.repeatCount
                });
            });

            // 💬 Chat
            tiktokConnection.on("chat", (data) => {
                socket.emit("chat", {
                    user: data.nickname,
                    message: data.comment
                });
            });

            // ❤️ Likes
            tiktokConnection.on("like", (data) => {
                socket.emit("like", {
                    user: data.nickname,
                    likes: data.likeCount
                });
            });

            // ⭐ Follow
            tiktokConnection.on("follow", (data) => {
                socket.emit("follow", {
                    user: data.nickname
                });
            });

            // 🔌 Si TikTok se desconecta
            tiktokConnection.on("disconnected", () => {
                console.log("⚠ TikTok desconectado");
                socket.emit("status", "disconnected");
            });

        } catch (err) {
            console.log("❌ Error conectando:", err.message);
            socket.emit("status", "error");
        }
    });

    socket.on("disconnect", () => {
        console.log("🔴 Usuario desconectado:", socket.id);

        if (connections[socket.id]) {
            connections[socket.id].tiktokConnection.disconnect();
            delete connections[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("🚀 Servidor corriendo en puerto", PORT);
});
