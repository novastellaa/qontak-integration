import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import messageQueue from "../utils/queue.js";
import redis from "../utils/redis.js";
import Logger from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const allowedNumber = process.env.ALLOWED_NUMBER
const RATE_LIMIT_THRESHOLD = process.env.RATE_LIMIT_THRESHOLD || 10;
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || 60;
let lastBotMessages = {};
let messageBuffers = {};

export const sanitizeInput = (input) => {
    if (!input) return "";
    return input
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .substring(0, 2000);
};


// --- 1. CREATE PREDICTION FROM FLOWISE
export const createPrediction = async(message, roomId, chatId, file = null) => {
    Logger.info("Pesan diterima:", message);

    try {

        let payload;

        if (file && file.url) {
            payload = {
                question: [{
                    role: "user",
                    content: [{
                            type: "text",
                            text: message && message.trim().length > 0 ?
                                message : "Tolong analisa isi gambar ini ya.",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: file.url,
                                detail: "auto",
                            },
                        },
                    ],
                }, ],
                sessionId: roomId,
                chatId,
            };
        } else {
            payload = {
                question: message || "",
                sessionId: roomId,
                chatId,
            };
        }

        const response = await fetch(
            `${process.env.FLOWISE_URL}/api/v1/prediction/${process.env.FLOW_ID}`, {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + process.env.FLOWISE_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                "Flowise API error: " + response.status + " - " + errorText
            );
        }

        // console.log("Payload ke Flowise:", JSON.stringify(payload, null, 2));
        const data = await response.json();
        Logger.info(`Response dari Flowise: ${JSON.stringify(data)}`);

        if (data && data.text && data.text.trim()) {
            return data.text;
        } else {
            return null;
        }
    } catch (error) {
        Logger.error("Error dalam prediksi:", error.message);
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

        Logger.error("Gagal ambil last_message dari Qontak.");
        return null;
    } catch (err) {
        Logger.error("Error ambil last_message:", err.message);
        return null;
    }
};


// --- 3. SEPARATE DETAILED QUESTION
export const isDetailedQuestion = (message, sender) => {
    if (!message || typeof message !== 'string') {
        return false;
    }
    const lowerMessage = message.toLowerCase();

    if (sender && sender.participant_type === 'agent') {
        const agentKeywords = ["Baik kak, akan kami cek terlebih dahulu ya, mohon ditunggu sebentar ^^"];

        if (agentKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
            Logger.info("✅ Detected keyword in AGENT message → escalate to agent");
            return true;
        }

    }

    // --- Check if message from customer
    if (sender && sender.participant_type === 'customer') {
        const customerKeywords = [
            ".."
        ];

        if (customerKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
            Logger.info("✅ Detected keyword in CUSTOMER message → escalate to agent");
            return true;
        }
    }

    return false;
};


// --- 4. MAIN MESSAGE RECEIVER - JOIN MESSAGE
export const receiveMessage = async(req, res) => {
    let message = "";
    let file = null;

    try {
        const body = req.body;

        let room = null;
        if (body && body.room) {
            room = body.room;
        }

        let room_id = "";
        if (body && body.room_id) {
            room_id = body.room_id;
        } else if (room && room.id) {
            room_id = room.id;
        }

        let sender = null;
        if (body && body.sender) {
            sender = body.sender;
        }

        let chatId = "";
        if (room && room.account_uniq_id) {
            chatId = room.account_uniq_id;
        }

        let channelName = "";
        if (room && room.channel_account) {
            channelName = room.channel_account;
        }

        if (!chatId) {
            return res.status(400).send("chatId missing.");
        }

        if (allowedNumber.indexOf(chatId) === -1) {
            Logger.warn("❌ Nomor " + chatId + " tidak diizinkan.");
            return res.status(200).send("Nomor tidak diizinkan untuk testing.");
        }

        if (channelName !== channelName) {
            Logger.warn("Pesan datang dari channel " + channelName + ", diabaikan.");
            return res.status(200).send("Channel tidak diizinkan.");
        }

        if (body && body.type === "text") {
            message = body.text || "";
        } else if (body && (body.type === "image" || body.type === "file" || body.type === "video")) {
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
                    Logger.warn("Tipe file tidak dikenali: " + filename);
                    return res.status(200).send("Tipe file tidak dikenali.");
                }

                file = {
                    url: body.file.url,
                    mimetype: mimetype,
                    name: filename
                };
            } else {
                Logger.warn("File payload tidak ditemukan.");
                return res.status(200).send("File payload tidak ditemukan.");
            }
        } else {
            Logger.warn("Tipe pesan tidak didukung: " + (body && body.type));
            return res.status(200).send("Tipe pesan tidak didukung.");
        }

        message = sanitizeInput(message);

        const rateLimitKey = "rate_limit:" + chatId;
        const currentCount = await redis.incr(rateLimitKey);
        if (currentCount === 1) {
            await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);
        }
        if (currentCount > RATE_LIMIT_THRESHOLD) {
            Logger.warn("User " + chatId + " melewati batas rate limit.");
            return res.status(429).send("Terlalu banyak pesan. Silakan tunggu sebentar.");
        }

        const tags = await getRoomTags(room_id);
        if (tags.indexOf("agen") !== -1) {
            Logger.info("Room sudah ditangani agen, bot tidak akan merespons.");
            return res.status(200).send("Room sudah dialihkan ke agen.");
        }

        const lastBotMessage = await redis.get("lastBotMessage:" + room_id);
        if (lastBotMessage && message.trim() === lastBotMessage) {
            Logger.info("Detected bot message loop. Ignoring.");
            return res.status(200).send("Bot message detected, skipping.");
        }

        if (isDetailedQuestion(message, sender)) {
            await updateRoomTag(room_id, ["agen"]);
            Logger.info("Room diambil alih oleh agen karena pertanyaan mendetail.");
            return res.status(200).send("Pertanyaan mendetail, agen mengambil alih.");
        }

        if (sender && sender.participant_type === 'agent') {
            Logger.info("Pesan ini datang dari agent, tidak diproses.");
            return res.status(200).send("Pesan berasal dari agent, tidak diproses.");
        }

        if (file) {
            await messageQueue.add("handleMessage", {
                message: message || "[image_only_message]",
                roomId: room_id,
                sender: sender,
                sessionId: room_id,
                chatId: chatId,
                file: JSON.stringify(file)
            }, {
                attempts: 3,
                backoff: 3000
            });

            return res.status(200).send("Pesan diterima dan dikirim ke worker karena ada file.");
        }

        // TEXT ONLY — with buffer
        if (!messageBuffers[room_id]) {
            messageBuffers[room_id] = {
                messages: [],
                timeout: null,
                file: null
            };
        }

        messageBuffers[room_id].messages.push(message);

        if (messageBuffers[room_id].timeout) {
            clearTimeout(messageBuffers[room_id].timeout);
        }

        messageBuffers[room_id].timeout = setTimeout(async function() {
            const fullMessage = messageBuffers[room_id].messages.join(". ");
            delete messageBuffers[room_id];

            Logger.info("⏳ Menggabungkan dan mengirim pesan: " + fullMessage);

            await messageQueue.add("handleMessage", {
                message: fullMessage,
                roomId: room_id,
                sender: sender,
                sessionId: room_id,
                chatId: chatId,
                file: null
            });
        }, 8000);

        return res.status(200).send("Pesan diterima & menunggu penggabungan.");
    } catch (error) {
        Logger.error("Error dalam receiveMessage: " + error.message);
        return res.status(500).send("Terjadi kesalahan saat memproses permintaan.");
    }
};


// --- 5. SEND MESSAGE TO QONTAK
export const sendToQontak = async(message, sender_id, room_id) => {
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
        Logger.info("Response dari Qontak:", data);

        lastBotMessages[room_id] = message.trim();

    } catch (error) {
        Logger.error("Error dalam sendToQontak: " + error.message);
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
        Logger.info(`Tag '${tag}' berhasil ditambahkan ke room ${room_id}`);
    } catch (error) {
        Logger.error("Error dalam memperbarui tag:", error);
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
        Logger.error("Error mendapatkan tag room:", error);
        return [];
    }
};