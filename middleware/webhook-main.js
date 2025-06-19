import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const allowedNumber = ["6285220300055", "628996103676", "6285691263021"] //  pak andy
let lastBotMessages = {};


// --- 1. CREATE PREDICTION FROM FLOWISE
const createPrediction = async(message, file = null) => {
    console.log("🔔 Pesan diterima:", message);

    try {
        const payload = { question: message };

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const fileBase64 = fileBuffer.toString("base64");

            payload.uploads = [{
                data: "data:" + file.mimetype + ";base64," + fileBase64,
                type: "file",
                name: file.originalname,
            }];
        }

        const response = await fetch(process.env.FLOWISE_URL + "/api/v1/prediction/" + process.env.FLOW_ID, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + process.env.FLOWISE_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error("Flowise API error: " + response.status + " - " + errorText);
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
    } finally {
        if (file) fs.unlinkSync(file.path);
    }
};


// --- 2. GET LAST BOT REPLY FROM QONTAK
const getLastBotReplyFromRoom = async(room_id) => {
    try {
        const response = await fetch(`https://service-chat.qontak.com/api/open/v1/rooms/${room_id}`, {
            method: 'GET',
            headers: {
                'Authorization': "Bearer " + process.env.QONTAK_API_KEY,
                'Content-Type': 'application/json',
            }
        });

        const result = await response.json();

        if (result.status === 'success') {
            const lastMessage = result.data && result.data.last_message;

            if (lastMessage && lastMessage.participant_type === 'agent') {
                console.log("💬 Last bot reply:", lastMessage.text);
                return lastMessage.text || "";
            }
            return "";
        }

        console.error("Gagal ambil last_message dari Qontak.");
        return "";
    } catch (err) {
        console.error("Error ambil last_message:", err.message);
        return "";
    }
};


// --- 3. MAIN MESSAGE RECEIVER
export const receiveMessage = async(req, res) => {
    const body = req.body;
    const message = body && body.text ? body.text : "";
    const room = body && body.room ? body.room : null;
    const room_id = body && body.room_id ? body.room_id : "";
    const sender = body && body.sender ? body.sender : null;

    const senderNumber = room && room.account_uniq_id ? room.account_uniq_id : "";
    const roomId = room_id || (room && room.id ? room.id : "");

    if (!allowedNumber.includes(senderNumber)) {
        console.log("❌ Nomor " + senderNumber + " tidak diizinkan.");
        return res.status(200).send("Nomor tidak diizinkan untuk testing.");
    }

    if (sender && sender.participant_type === 'agent') {
        console.log("Pesan ini datang dari agent, tidak diproses.");
        return res.status(200).send("Pesan berasal dari agent, tidak diproses.");
    }

    try {
        const tags = await getRoomTags(roomId);
        if (tags.includes("agen")) {
            console.log("👌 Room sudah ditangani agen, bot tidak akan merespons.");
            return res.status(200).send("Room sudah dialihkan ke agen, bot tidak menangani pesan.");
        }

        if (isDetailedQuestion(message)) {
            await updateRoomTag(roomId, ['agen']);
            // await takeOverRoom(roomId);
            console.log("🙏 Room diambil alih oleh agen karena pertanyaan mendetail.");
            return res.status(200).send("Pertanyaan mendetail, agen mengambil alih.");
        }

        const lastBotReply = await getLastBotReplyFromRoom(roomId);
        if (message.trim() === lastBotReply.trim()) {
            console.log("➰ Loop terdeteksi: user mengirim ulang pesan yang sebelumnya dibalas bot.");
            return res.status(200).send("Loop terdeteksi, dihentikan.");
        }

        if (lastBotMessages[roomId] && message.trim() === lastBotMessages[roomId]) {
            console.log("➰ Loop terdeteksi: user mengirim ulang pesan yang sebelumnya dibalas bot.");
            return res.status(200).send("Loop terdeteksi, dibatalkan.");
        }

        const flowiseReply = await createPrediction(message);
        if (!flowiseReply) {
            // await updateRoomTag(roomId, 'unanswered');
            return res.status(200).send("Tidak dapat menjawab pertanyaan, tag diubah.");
        }

        await sendToQontak(flowiseReply, senderNumber, roomId);
        lastBotMessages[roomId] = flowiseReply.trim();
        console.log("💬 LastBotMessage recorded:", lastBotMessages[roomId]);

        return res.status(200).send("Pesan berhasil diproses.");

    } catch (error) {
        console.error("Error dalam memproses pesan:", error);
        return res.status(500).send("Terjadi kesalahan dalam memproses permintaan");
    }
};


// --- 4. SEPARATE DETAILED QUESTION
const isDetailedQuestion = (message) => {
    const keywords = ["error", "bug", "problem", "tidak bisa", "solusi", "tutorial", "langkah", "asuransi", "kebijakan", "detail", "refund", "penjelasan", "cara kerja", "spesifikasi", "persyaratan", "add on", "benefit"];

    if (keywords.some(keyword => message.toLowerCase().includes(keyword))) {
        return true;
    }
    return false;
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
        console.log("✅ Response dari Qontak:", data);

        lastBotMessages[room_id] = message.trim();

    } catch (error) {
        console.error("Error dalam mengirim pesan ke Qontak:", error);
    }
};


// --- .6 UPDATE TAG ON ROOM
const updateRoomTag = async(room_id, tag) => {
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


// --- .7 TAKE OVER ROOM
// const takeOverRoom = async(room_id) => {
//     try {
//         const response = await fetch(`
//             https: //service-chat.qontak.com/api/open/v1/rooms/${room_id}/takeover`, {
//             method: "POST",
//             headers: {
//                 Authorization: `Bearer ${process.env.QONTAK_API_KEY}`,
//                 "Content-Type": "application/json",
//             }
//         });

//         if (!response.ok) {
//             const errorText = await response.text();
//             throw new Error(`Qontak API error: ${response.status} - ${errorText}`);
//         }

//         console.log(`Room ${room_id} berhasil diambil alih oleh agen.`);
//     } catch (error) {
//         console.error("Error dalam mengambil alih room:", error);
//     }
// };



// --- .8 GET ROOM TAG
const getRoomTags = async(room_id) => {
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
            return data.data.tags; // Daftar tag yang ada di room
        }
        return [];
    } catch (error) {
        console.error("Error mendapatkan tag room:", error);
        return [];
    }
};