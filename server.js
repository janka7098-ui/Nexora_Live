const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = socketIo(server,{ maxHttpBufferSize:1e7 });

app.use(express.static("public"));
app.use(express.json());

/* =========================
   TEST ENDPOINT (LEXORA)
========================= */
app.post("/test",(req,res)=>{
  const { gift, repeatCount, parts } = req.body;

  const total = (parts || 0) * (repeatCount || 1);

  console.log("🧪 TEST:", gift, "x", repeatCount, "=", total);

  res.json({ ok:true, total });
});

/* =========================
   CONFIG
========================= */
const allowedKeys=[
  "nexora01","nexora02","nexora03","nexora04","nexora05",
  "nexora06","nexora07","nexora08","nexora09","nexora10"
];

const activeConnections=new Map();
const userActions=new Map();

/* =========================
   SOCKET
========================= */
io.on("connection",(socket)=>{

  socket.on("startConnection", async ({username,key})=>{

    if(!username || !key) return;

    if(!allowedKeys.includes(key)){
      socket.emit("status","invalid_key");
      return;
    }

    const tiktok = new WebcastPushConnection(username);

    try{
      await tiktok.connect();
      activeConnections.set(socket.id,tiktok);

      socket.emit("status","connected");

      /* =========================
         🎁 GIFTS
      ========================= */
      tiktok.on("gift",(data)=>{

        if(data.repeatEnd){

          const amount = data.repeatCount || 1;

          const actions = userActions.get(username) || [];

          const action = actions.find(a =>
            a.type === "gift" &&
            a.gift.toLowerCase() === data.giftName.toLowerCase()
          );

          if(action){

            const parts = action.parts || 0;
            const total = parts * amount;

            console.log("🎁", data.giftName, "x", amount, "=", total);

            sendToRoblox(action, {
              user:data.nickname,
              type:"gift",
              gift:data.giftName,
              amount,
              total
            });

          }

        }

      });

      /* =========================
         ❤️ LIKES (TAP TAP)
      ========================= */
      tiktok.on("like",(data)=>{

        const actions = userActions.get(username) || [];

        const action = actions.find(a => a.type === "like");

        if(action){

          const amount = data.likeCount || 1;
          const parts = action.parts || 0;

          const total = parts * amount;

          console.log("❤️ LIKE:", amount, "=", total);

          sendToRoblox(action, {
            user:data.nickname,
            type:"like",
            amount,
            total
          });

        }

      });

      /* =========================
         ➕ FOLLOW
      ========================= */
      tiktok.on("follow",(data)=>{

        const actions = userActions.get(username) || [];

        const action = actions.find(a => a.type === "follow");

        if(action){

          const parts = action.parts || 0;

          console.log("➕ FOLLOW =", parts);

          sendToRoblox(action, {
            user:data.nickname,
            type:"follow",
            total:parts
          });

        }

      });

    }catch(err){
      socket.emit("status","error");
    }

  });

  /* =========================
     GUARDAR ACCIÓN
  ========================= */
  socket.on("saveAction",({username,action})=>{

    if(!username) return;

    if(!userActions.has(username))
      userActions.set(username,[]);

    const actions = userActions.get(username);

    actions.push({
      gift: action.gift || null,
      type: action.type, // gift | like | follow
      parts: Number(action.parts || 0),
      file: action.file,
      typeAction: action.typeAction || "link"
    });

    socket.emit("actionsUpdated",actions);

  });

  socket.on("getActions",(username)=>{
    const actions=userActions.get(username) || [];
    socket.emit("actionsUpdated",actions);
  });

  socket.on("deleteAction",({username,index})=>{
    if(!userActions.has(username)) return;
    const actions=userActions.get(username);
    actions.splice(index,1);
    socket.emit("actionsUpdated",actions);
  });

  socket.on("disconnect",()=>{
    if(activeConnections.has(socket.id)){
      try{
        activeConnections.get(socket.id).disconnect();
      }catch{}
      activeConnections.delete(socket.id);
    }
  });

});

/* =========================
   FUNCIÓN ROBLOX
========================= */
function sendToRoblox(action,data){

  if(action.typeAction === "link"){
    axios.post(action.file,data)
      .catch(()=>console.log("❌ Roblox offline"));
  }

}

/* =========================
   START
========================= */
const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
  console.log("🚀 Lexora PRO activo en puerto",PORT);
});
