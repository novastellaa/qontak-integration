import Queue from "bull";
import dotenv from "dotenv";
import { createPrediction, sendToQontak } from "../middleware/webhook-dev.js";

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

        if (lastBotMessages[roomId] && lastBotMessages[roomId] === message.trim()) {
            console.log("🔁 Detected bot reply being reprocessed. Skipping.");
            return;
        }

        // --- Handle file kalau ada ---
        if (file && file.path) {
            tempFile = file;
        }

        // Kirim ke Flowise
        const reply = await createPrediction(
            message,
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
        // Pastikan temp file dihapus
        if (tempFile && tempFile.cleanup) {
            tempFile.cleanup();
            console.log("🗑️ Temp file deleted:", tempFile.path);
        }
    }
});