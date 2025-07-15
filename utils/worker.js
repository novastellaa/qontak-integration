import Queue from "bull";
import dotenv from "dotenv";
import { createPrediction, sendToQontak } from "../middleware/webhook-dev.js";
import { extractTextFromImage } from "./ocr.js";
import fs from "fs";


dotenv.config();

const messageQueue = new Queue("qontak-messages", {
    redis: { host: "127.0.0.1", port: 6379 }
});

const lastBotMessages = {};

messageQueue.process("handleMessage", 10, async(job) => {
    let tempFile = null;

    try {
        const { message, roomId, sender, sessionId, chatId, file } = job.data;

        console.log("📦 Processing job:", { message, roomId, chatId, sessionId });

        if (!roomId || typeof roomId !== "string" || roomId.trim() === "") {
            console.warn("⚠️ Invalid roomId:", roomId);
            return;
        }

        if (!chatId) {
            console.warn("⚠️ Missing chatId in job:", job.data);
            return;
        }

        if (!message && !file) {
            console.warn("⚠️ No message and no file provided in job:", job.data);
            return;
        }

        if (sender && sender.participant_type === 'agent') {
            console.log("🛑 Message is from agent, skipping.");
            return;
        }

        let finalMessage = message;

        if (file && file.path) {
            tempFile = file;
            console.log("📝 Melakukan OCR pada file:", tempFile.path);
            const ocrText = await extractTextFromImage(tempFile.path);
            console.log(ocrText);

            if (!message || message.trim() === "") {
                finalMessage = ocrText;
            } else {
                finalMessage = message + "\n\n" + ocrText;
            }
        }


        if (lastBotMessages[roomId] && lastBotMessages[roomId] === message.trim()) {
            console.log("🔁 Detected bot reply being reprocessed. Skipping.");
            return;
        }

        // Kirim ke Flowise
        const reply = await createPrediction(
            finalMessage,
            sessionId,
            chatId,
            tempFile
        );

        if (!sessionId) {
            console.warn("❗Warning: sessionId kosong. Memory mungkin tidak akan aktif.");
        }

        if (!reply) {
            console.warn("❗No reply from Flowise.");
            return;
        }

        await sendToQontak(reply, chatId, roomId);

        lastBotMessages[roomId] = reply.trim();
        console.log("✅ Reply sent & tracked:", reply);

    } catch (err) {
        console.error("💥 Error while processing job:", err);

    } finally {
        if (tempFile && tempFile.path) {
            fs.unlink(tempFile.path, (err) => {
                if (err) {
                    console.error("❌ Gagal hapus file:", err.message);
                } else {
                    console.log("🗑️ File deleted:", tempFile.path);
                }
            });
        }
    }
});