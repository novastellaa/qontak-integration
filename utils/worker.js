import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createPrediction, sendToQontak, updateRoomTag } from "./middleware/webhook-3.js";
import { getLastBotReplyFromRoom } from "./middleware/webhook-3.js";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

const lastBotMessages = {};

const worker = new Worker("qontakMessageQueue", async job => {
    const { message, room, room_id, senderNumber, roomId } = job.data;

    const lastBotReply = await getLastBotReplyFromRoom(roomId);
    if (message.trim() === lastBotReply.trim()) {
        console.log("Loop terdeteksi di worker.");
        return;
    }

    if (lastBotMessages[roomId] && message.trim() === lastBotMessages[roomId]) {
        console.log("Loop dari cache terdeteksi di worker.");
        return;
    }

    const reply = await createPrediction(message);
    if (!reply) {
        await updateRoomTag(roomId, 'unanswered');
        return;
    }

    await sendToQontak(reply, senderNumber, roomId);
    lastBotMessages[roomId] = reply.trim();
}, { connection });

worker.on("completed", job => {
    console.log(`Job ${job.id} selesai.`);
});

worker.on("failed", (job, err) => {
    console.error(`Job ${job.id} gagal:`, err);
});