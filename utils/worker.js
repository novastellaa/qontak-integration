import Queue from "bull";
import dotenv from "dotenv";
import { createPrediction, sendToQontak } from "../middleware/webhook-dev.js";

dotenv.config();

const messageQueue = new Queue("qontak-messages", {
    redis: { host: "127.0.0.1", port: 6379 }
});

const lastBotMessages = {};

messageQueue.process("handleMessage", async(job) => {
    try {
        const { message, roomId, senderNumber, sender } = job.data;

        console.log("📦 Processing job:", { message, roomId, senderNumber });

        if (!roomId || typeof roomId !== "string" || roomId.trim() === "") {
            console.warn("⚠️ Invalid roomId:", roomId);
            return;
        }

        if (!senderNumber || !message) {
            console.warn("⚠️ Missing essential data in job:", job.data);
            return;
        }

        if (sender && sender.participant_type === 'agent') {
            console.log("🛑 Message is from agent, skipping.");
            return;
        }

        if (lastBotMessages[roomId] && lastBotMessages[roomId] === message.trim()) {
            console.log("🔁 Detected bot reply being reprocessed. Skipping.");
            return res.status(200).send("Bot reply detected, not reprocessed.");
        }


        const reply = await createPrediction(message);
        if (!reply) {
            console.warn("❗No reply from Flowise.");
            return;
        }

        await sendToQontak(reply, senderNumber, roomId);

        lastBotMessages[roomId] = reply.trim();
        console.log("✅ Reply sent & tracked:", reply);

    } catch (err) {
        console.error("💥 Error while processing job:", err);
    }
});