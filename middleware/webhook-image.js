import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
// import fs from "fs";
import messageQueue from "../utils/queue.js";
import redis from "../utils/redis.js";
// import { downloadFileToTemp } from "../utils/download-9jul.js";

const app = express();
app.use(bodyParser.json());

const allowedNumber = "6285691263021"

let lastBotMessages = {};
let messageBuffers = {};


// --- 1. CREATE PREDICTION FROM FLOWISE
export const createPrediction = async(message, roomId, chatId, file = null) => {
    console.log("Pesan diterima:", message);

    try {
        const payload = {
            question: message || "[image_only_message]",
            sessionId: roomId,
            chatId
        };

        if (file && file.url) {
            payload.files = [{
                data: file.url,
                type: "image_url",
                name: file.name || "image.jpg"
            }];
        }

        console.log("Payload ke Flowise:", payload);

        const response = await fetch(
            `${process.env.FLOWISE_URL}/api/v1/prediction/${process.env.FLOW_ID}`, {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + process.env.FLOWISE_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                "Flowise API error: " + response.status + " - " + errorText
            );
        }

        const data = await response.json();
        console.log("Response dari Flowise:", data);

        if (data && data.text && data.text.trim()) {
            return data.text;
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error dalam prediksi:", error.message);
        return null;
    }
};



// --- 2. GET LAST BOT REPLY FROM QONTAK
export const getLastBotReplyFromRoom = async(room_id) => {
    try {
        const response = await fetch(
            `https://service-chat.qontak.com/api/open/v1/rooms/${room_id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.QONTAK_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const result = await response.json();

        if (result.status === 'success') {
            const lastMessage = result.data && result.data.last_message;
            if (lastMessage) {
                return lastMessage; // return full object
            }
            return null;
        }

        console.error("Gagal ambil last_message dari Qontak.");
        return null;
    } catch (err) {
        console.error("Error ambil last_message:", err.message);
        return null;
    }
};


// --- 3. SEPARATE DETAILED QUESTION
export const isDetailedQuestion = (message, sender) => {
    const keywords = [
        "error", "bug", "problem", "tidak bisa", "solusi", "tutorial", "langkah",
        "asuransi", "kebijakan", "detail", "refund", "penjelasan", "cara kerja",
        "spesifikasi", "persyaratan", "benefit"
    ];

    if (sender && sender.participant_type === 'customer') {
        const lowerMessage = message.toLowerCase();
        return keywords.some(keyword => lowerMessage.includes(keyword));
    }
    return false;
};


// --- 4. MAIN MESSAGE RECEIVER - JOIN MESSAGE
export const receiveMessage = async(req, res) => {
    const body = req.body;

    let message = "";
    let file = null;

    if (body.type === "text") {
        message = body.text || "";
    } else if (body.type === "image" || body.type === "file" || body.type === "video") {
        message = body.text || "";

        if (body.file && body.file.url) {
            var filename = "file";
            if (body.file.filename) {
                filename = body.file.filename;
            }

            var mimetype = "";
            if (filename.toLowerCase().endsWith(".jpeg") || filename.toLowerCase().endsWith(".jpg")) {
                mimetype = "image/jpeg";
            } else if (filename.toLowerCase().endsWith(".png")) {
                mimetype = "image/png";
            } else if (filename.toLowerCase().endsWith(".pdf")) {
                mimetype = "application/pdf";
            } else {
                console.log("Tipe file tidak dikenali:", filename);
                return res.status(200).send("Tipe file tidak dikenali.");
            }
            file = {
                url: body.file.url,
                mimetype: mimetype,
                name: filename
            };

        } else {
            console.log("File payload tidak ditemukan.");
            return res.status(200).send("File payload tidak ditemukan.");
        }

    } else {
        console.log("Tipe pesan tidak didukung:", body.type);
        return res.status(200).send("Tipe pesan tidak didukung.");
    }

    const room = body && body.room ? body.room : null;
    const room_id = body && body.room_id ? body.room_id : "";
    const roomId = room_id ? room_id : (room && room.id ? room.id : "");
    const sender = body && body.sender ? body.sender : null;
    const chatId = room && room.account_uniq_id ? room.account_uniq_id : "";

    const channelName = room && room.channel_account ? room.channel_account : "";
    const allowedChannelName = "Global Komunika";

    if (channelName !== allowedChannelName) {
        console.log(`Pesan datang dari channel ${channelName}, diabaikan.`);
        return res.status(200).send("Channel tidak diizinkan.");
    }

    if (allowedNumber.indexOf(chatId) === -1) {
        console.log("Nomor " + chatId + " tidak diizinkan.");
        return res.status(200).send("Nomor tidak diizinkan untuk testing.");
    }

    if (sender && sender.participant_type === 'agent') {
        console.log("Pesan ini datang dari agent, tidak diproses.");
        return res.status(200).send("Pesan berasal dari agent, tidak diproses.");
    }

    try {
        // Rate limiting
        const rateLimitKey = `rate_limit:${chatId}`;
        const currentCount = await redis.incr(rateLimitKey);
        if (currentCount === 1) await redis.expire(rateLimitKey, 60);
        if (currentCount > 10) {
            console.log(`❌ User ${chatId} melewati batas rate limit.`);
            return res.status(429).send("Terlalu banyak pesan. Silakan tunggu sebentar.");
        }

        const tags = await getRoomTags(roomId);
        if (tags.includes("agen")) {
            console.log("Room sudah ditangani agen, bot tidak akan merespons.");
            return res.status(200).send("Room sudah dialihkan ke agen, bot tidak menangani pesan.");
        }

        const lastBotReply = await getLastBotReplyFromRoom(roomId);
        if (
            lastBotReply &&
            lastBotReply.participant_type === "agent" &&
            message.trim() === (lastBotReply.text || "").trim()
        ) {
            console.log("Loop terdeteksi: user mengirim ulang pesan yang sebelumnya dibalas bot.");
            return res.status(200).send("Loop terdeteksi, dihentikan.");
        }

        if (lastBotMessages[roomId] && message.trim() === lastBotMessages[roomId]) {
            console.log("Loop terdeteksi: user mengirim ulang pesan yang sebelumnya dibalas bot.");
            return res.status(200).send("Loop terdeteksi, dibatalkan.");
        }

        // === KIRIM LANGSUNG JIKA ADA FILE ===
        if (file) {
            console.log("Langsung kirim ke worker karena ada file:", file);

            await messageQueue.add("handleMessage", {
                message: message || "",
                roomId,
                sender,
                sessionId: roomId,
                chatId,
                file: file
            }, {
                attempts: 3,
                backoff: 3000
            });

            return res.status(200).send("Pesan diterima dan dikirim langsung ke worker karena ada file.");
        }

        // === BUFFER TEXT-ONLY ===
        if (!messageBuffers[roomId]) {
            messageBuffers[roomId] = {
                messages: [],
                timeout: null,
                file: null
            };
        }

        messageBuffers[roomId].messages.push(message);

        if (file) {
            messageBuffers[roomId].file = file;
        }

        if (messageBuffers[roomId].timeout) {
            clearTimeout(messageBuffers[roomId].timeout);
        }

        messageBuffers[roomId].timeout = setTimeout(async() => {
            const fullMessage = messageBuffers[roomId].messages.join(". ");
            let queuedFile = messageBuffers[roomId].file;

            if (!queuedFile && !fullMessage.trim() && file) {
                queuedFile = file;
            }

            delete messageBuffers[roomId];

            console.log("⏳ Menggabungkan dan mengirim pesan:", fullMessage);
            console.log(JSON.stringify(body, null, 2));

            await messageQueue.add("handleMessage", {
                message: fullMessage,
                roomId,
                sender,
                sessionId: roomId,
                chatId,
                file: queuedFile
            }, {
                attempts: 3,
                backoff: 3000
            });
        }, 8000);

        return res.status(200).send("Pesan diterima & menunggu penggabungan.");
    } catch (error) {
        console.error("Error dalam memproses pesan:", error);
        return res.status(500).send("Terjadi kesalahan dalam memproses permintaan");
    }
};


// --- 5. SEND MESSAGE TO QONTAK
export const sendToQontak = async(message, sender_id, room_id, retryCount = 0) => {
    const payload = {
        room_id: room_id,
        sender_id: sender_id,
        type: "text",
        text: message
    };

    try {
        const response = await fetch('https://service-chat.qontak.com/api/open/v1/messages/whatsapp', {
            method: 'POST',
            headers: {
                'Authorization': "Bearer " + process.env.QONTAK_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error("Qontak API error: " + response.status + " - " + errorText);
        }

        const data = await response.json();
        console.log("Response dari Qontak:", data);

        lastBotMessages[room_id] = message.trim();

    } catch (error) {
        console.error("Error dalam mengirim pesan ke Qontak:", error);
    }
};


// --- .6 UPDATE TAG ON ROOM
export const updateRoomTag = async(room_id, tag) => {
    try {
        const formData = new FormData();
        formData.append("tag", tag);

        const response = await fetch(`https://service-chat.qontak.com/api/open/v1/rooms/${room_id}/tags`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.QONTAK_API_KEY}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Qontak API error: ${response.status} - ${errorText}`);
        }
        console.log(`Tag '${tag}' berhasil ditambahkan ke room ${room_id}`);
    } catch (error) {
        console.error("Error dalam memperbarui tag:", error);
    }
};


// --- .7 GET ROOM TAG
export const getRoomTags = async(room_id) => {
    try {
        const response = await fetch(`https://service-chat.qontak.com/api/open/v1/rooms/${room_id}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${process.env.QONTAK_API_KEY}`,
                "Content-Type": "application/json",
            }
        });

        const data = await response.json();
        if (data.status === "success" && data.data.tags) {
            return data.data.tags;
        }
        return [];
    } catch (error) {
        console.error("Error mendapatkan tag room:", error);
        return [];
    }
};