const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

// IMPORTANTE: Aumentamos el buffer para permitir archivos de audio (10MB)
const io = socketIo(server, {
    maxHttpBufferSize: 1e7 
});

app.use(express.static("public"));

/* =========================
   LISTA DE REGALOS (Lee PNGs)
========================= */
app.get("/gift-list", (req, res) => {
    const giftsPath = path.join(__dirname, "public", "regalos");
    if (!fs.existsSync(giftsPath)) return res.json([]);

    fs.readdir(giftsPath, (err, files) => {
        if (err) return res.json([]);
        const giftList = files
            .filter(file => file.toLowerCase().endsWith(".png"))
            .map(file => ({
                name: file.replace(".png", ""),
                image: "/regalos/" + file
            }));
        res.json(giftList);
    });
});

/* =========================
   PROXY AVATAR
========================= */
app.get("/avatar-proxy", async (req, res) => {
    try {
        const url = req.query.url;
        const response = await axios.get(url, { responseType: "arraybuffer" });
        res.set("Content-Type", "image/jpeg");
        res.send(response.data);
    } catch (err) {
        res.status(500).send("Error avatar");
    }
});

const allowedKeys = ["nexora01","nexora02","nexora03","nexora04","nexora05","nexora06","nexora07","nexora08","nexora09","nexora10"];
const activeConnections = new Map();
const userActions = new Map();

io.on("connection", (socket) => {

    socket.on("startConnection", async ({ username, key }) => {
        if (!username || !key) return;
        if (!allowedKeys.includes(key)) {
            socket.emit("status", "invalid_key");
            return;
        }

        const tiktok = new WebcastPushConnection(username);
        try {
            await tiktok.connect();
            activeConnections.set(socket.id, tiktok);
            socket.emit("status", "connected");

            // Avatar Logic
            try {
                const roomInfo = await tiktok.getRoomInfo();
                const avatarUrl = roomInfo?.owner?.avatarLarger;
                if (avatarUrl) {
                    socket.emit("connectedUserData", {
                        username,
                        profilePictureUrl: `/avatar-proxy?url=${encodeURIComponent(avatarUrl)}`
                    });
                }
            } catch (err) {}

            tiktok.on("gift", (data) => {
                if (data.repeatEnd) {
                    socket.emit("gift", {
                        user: data.nickname,
                        gift: data.giftName,
                        amount: data.repeatCount
                    });
                    const actions = userActions.get(username) || [];
                    const action = actions.find(a => a.gift.toLowerCase() === data.giftName.toLowerCase());
                    if (action) {
                        // Enviamos la ruta completa del archivo guardado
                        socket.emit("triggerSound", action.file);
                    }
                }
            });

            tiktok.on("chat", (data) => {
                socket.emit("chat", { user: data.nickname, message: data.comment });
            });

        } catch (err) {
            socket.emit("status", "error");
        }
    });

    /* =========================
       NUEVO: SUBIR Y GUARDAR MP3
    ========================= */
    socket.on("uploadAndSave", ({ username, gift, fileName, fileData }) => {
        if (!username || !fileData) return;

        // Crear carpeta del usuario si no existe: public/uploads/usuario
        const userFolder = path.join(__dirname, "public", "uploads", username);
        if (!fs.existsSync(userFolder)) {
            fs.mkdirSync(userFolder, { recursive: true });
        }

        // Limpiar el string base64
        const base64Data = fileData.split(';base64,').pop();
        const finalFileName = `${Date.now()}_${fileName}`; // Evitamos duplicados con un timestamp
        const filePath = path.join(userFolder, finalFileName);

        fs.writeFile(filePath, base64Data, { encoding: 'base64' }, (err) => {
            if (err) {
                console.log("Error guardando archivo:", err);
                return;
            }

            // Guardar la acción con la ruta web del archivo
            if (!userActions.has(username)) userActions.set(username, []);
            const actions = userActions.get(username);
            
            const newAction = {
                gift: gift,
                file: `/uploads/${username}/${finalFileName}` // Ruta que usará el <audio> del cliente
            };
            
            actions.push(newAction);
            socket.emit("actionsUpdated", actions);
            socket.emit("status", "connected"); // Para avisar que terminó la subida
        });
    });

    socket.on("getActions", (username) => {
        const actions = userActions.get(username) || [];
        socket.emit("actionsUpdated", actions);
    });

    socket.on("deleteAction", ({ username, index }) => {
        if (!userActions.has(username)) return;
        const actions = userActions.get(username);
        actions.splice(index, 1);
        socket.emit("actionsUpdated", actions);
    });

    socket.on("disconnect", () => {
        if (activeConnections.has(socket.id)) {
            try { activeConnections.get(socket.id).disconnect(); } catch {}
            activeConnections.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("🚀 Nexora activo en puerto", PORT);
});
