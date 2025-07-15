import dotenv from "dotenv";
import fs from "fs";
import messageQueue from "./queue.js";
import redis from "../utils/redis.js";

import { createPrediction, sendToQontak } from "../middleware/feat-dataUsage.js";
import { analyzeImageWithOpenAI } from "./vision-openai.js";


dotenv.config();

const lastBotMessages = {};

messageQueue.process("handleMessage", 10, async(job) => {
    console.log("🚚 DATA DITERIMA DI WORKER:", JSON.stringify(job.data, null, 2));

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    let tempFile = null;

    try {
        const { message, roomId, sender, sessionId, chatId, flowiseContext, file: fileString } = job.data;
        let file = null;

        if (fileString) {
            try {
                file = JSON.parse(fileString);
                console.log("📄 File JSON berhasil di-parse:", file);
            } catch (e) {
                console.warn("⚠️ Gagal parse file JSON:", e);
                file = null;
            }
        }

        if (file) {
            console.log("🖼️ Worker menerima file:", file);
        } else {
            console.log("⚠️ Worker TIDAK menerima file.");
        }

        console.log("<3 Processing job:", {
            message,
            roomId,
            chatId,
            sessionId,
            flowiseContext,
            file,
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
            console.log("🕒 Delay sebelum kirim ke Vision API (3 detik)...");
            await sleep(3000);

            console.log("🖼️ Mengirim gambar ke OpenAI Vision:", file.url);
            try {
                const visionDescription = await analyzeImageWithOpenAI(
                    file.url,
                    "Deskripsikan isi gambar ini secara detail."
                );

                console.log("🎯 Hasil Vision:", visionDescription);

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
                console.error("❌ Vision API error:", error.message);
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
            console.log("🔁 Detected bot reply being reprocessed. Skipping.");
            return;
        }

        // Kirim ke Flowise
        const reply = await createPrediction(
            finalMessage,
            roomId,
            chatId,
            flowiseContext || {},
            file
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

        await sendToQontak(reply, chatId, roomId);
        await redis.set(`lastBotMessage:${roomId}`, reply.trim());

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


export default messageQueue;