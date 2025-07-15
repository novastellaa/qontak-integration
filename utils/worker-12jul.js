import dotenv from "dotenv";
import fs from "fs";
import messageQueue from "./queue.js";
import redis from "../utils/redis.js";
import Logger from "../utils/logger.js";

import { createPrediction, sendToQontak } from "../middleware/feat-image.js";
import { analyzeImageWithOpenAI } from "./vision-openai.js";


dotenv.config();

const lastBotMessages = {};

messageQueue.process("handleMessage", 10, async(job) => {
    Logger.info("🚚 DATA DITERIMA DI WORKER:", JSON.stringify(job.data, null, 2));

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    let tempFile = null;

    try {
        const { message, roomId, sender, sessionId, chatId, file: fileString } = job.data;
        let file = null;

        if (fileString) {
            try {
                file = JSON.parse(fileString);
                Logger.info("📄 File JSON berhasil di-parse:", file);
            } catch (e) {
                Logger.warn("⚠️ Gagal parse file JSON:", e);
                file = null;
            }
        }

        if (file) {
            Logger.info("🖼️ Worker menerima file:", file);
        } else {
            Logger.info("⚠️ Worker TIDAK menerima file.");
        }

        Logger.info("<3 Processing job:", {
            message,
            roomId,
            chatId,
            sessionId,
            file,
        });

        if (!roomId || typeof roomId !== "string" || roomId.trim() === "") {
            Logger.warn("⚠️ Invalid roomId:", roomId);
            return;
        }

        if (!chatId) {
            Logger.warn("⚠️ Missing chatId in job:", job.data);
            return;
        }

        if (!message && !file) {
            Logger.warn("⚠️ No message and no file provided in job:", job.data);
            return;
        }

        if (sender && sender.participant_type === "agent") {
            Logger.info("🛑 Message is from agent, skipping.");
            return;
        }

        let finalMessage = message || "";

        if (file && file.url) {
            Logger.info("🕒 Delay sebelum kirim ke Vision API (3 detik)...");
            await sleep(3000);

            Logger.info("🖼️ Mengirim gambar ke OpenAI Vision:", file.url);
            try {
                const visionDescription = await analyzeImageWithOpenAI(
                    file.url,
                    "Deskripsikan isi gambar ini secara detail."
                );

                Logger.info("🎯 Hasil Vision:", visionDescription);

                finalMessage = [
                        message,
                        visionDescription ?
                        `🎯 Vision Description:\n${visionDescription}` :
                        ""
                    ]
                    .filter(Boolean)
                    .join("\n\n")
                    .trim();

                tempFile = null;

            } catch (error) {
                Logger.error("❌ Vision API error:", error.message);
                finalMessage =
                    message ||
                    "[Image received but vision analysis failed.]";

                tempFile = null;
            }
        }


        if (
            lastBotMessages[roomId] &&
            lastBotMessages[roomId] === finalMessage.trim()
        ) {
            Logger.info("🔁 Detected bot reply being reprocessed. Skipping.");
            return;
        }

        // Kirim ke Flowise
        const reply = await createPrediction(
            finalMessage,
            sessionId,
            chatId,
            null
        );

        if (!sessionId) {
            Logger.warn(
                "❗Warning: sessionId kosong. Memory mungkin tidak akan aktif."
            );
        }

        if (!reply) {
            Logger.warn("❗No reply from Flowise.");
            return;
        }

        await sendToQontak(reply, chatId, roomId);

        await redis.set(`lastBotMessage:${roomId}`, reply.trim());

        Logger.info("✅ Reply sent & tracked:", reply);
    } catch (err) {
        Logger.error("💥 Error while processing job:", err);
    } finally {
        if (tempFile && tempFile.path) {
            fs.unlink(tempFile.path, (err) => {
                if (err) {
                    Logger.error("❌ Gagal hapus file:", err.message);
                } else {
                    Logger.info("🗑️ File deleted:", tempFile.path);
                }
            });
        }
    }
});


export default messageQueue;