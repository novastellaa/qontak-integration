import Queue from "bull";
import dotenv from "dotenv";
import fs from "fs";
import { createPrediction, sendToQontak } from "../middleware/webhook-image.js";
import { analyzeImageWithOpenAI } from "../utils/openai-vision.js";

dotenv.config();

const messageQueue = new Queue("qontak-messages", {
    redis: { host: "127.0.0.1", port: 6379 }
});

const lastBotMessages = {};

messageQueue.process("handleMessage", 10, async(job) => {
    let tempFile = null;

    try {
        const { message, roomId, sender, sessionId, chatId, file } = job.data;

        console.log("📦 Processing job:", {
            message,
            roomId,
            chatId,
            sessionId,
            file
        });

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

        if (sender && sender.participant_type === "agent") {
            console.log("🛑 Message is from agent, skipping.");
            return;
        }

        let finalMessage = message || "";

        if (file && file.url) {
            console.log("🖼️ Mengirim gambar ke OpenAI Vision:", file.url);
            try {
                // Kirim ke GPT-4 Vision
                const visionDescription = await analyzeImageWithOpenAI(
                    file.url,
                    "Deskripsikan isi gambar ini secara detail."
                );

                console.log("🎯 Hasil Vision:", visionDescription);

                // Gabungkan message user + deskripsi Vision
                const combinedText = [
                        message || "",
                        visionDescription ?
                        `\n\n🎯 Vision Description:\n${visionDescription}` :
                        ""
                    ]
                    .filter(Boolean)
                    .join("\n");

                finalMessage = combinedText.trim();
            } catch (error) {
                console.error("❌ Vision API error:", error.message);
                finalMessage =
                    message || "[Image received but vision analysis failed.]";
            }

            tempFile = file;
        }

        // Cek loop prevention
        if (
            lastBotMessages[roomId] &&
            lastBotMessages[roomId] === finalMessage.trim()
        ) {
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
            console.warn(
                "❗Warning: sessionId kosong. Memory mungkin tidak akan aktif."
            );
        }

        if (!reply) {
            console.warn("❗No reply from Flowise.");
            return;
        }

        // Kirim balasan ke Qontak
        await sendToQontak(reply, chatId, roomId);

        lastBotMessages[roomId] = reply.trim();
        console.log("✅ Reply sent & tracked:", reply);
    } catch (err) {
        console.error("💥 Error while processing job:", err);
    } finally {
        // Kalau kamu masih download file lokal → hapus file di sini
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

export default messageQueue;