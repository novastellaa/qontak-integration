import fs from "fs";
import fetch from "node-fetch";

// Endpoint: /api/flowise (manual form + file)
export const createPrediction = async(req, res) => {
    const { message } = req.body;
    const file = req.file;

    console.log("Manual Input - Message:", message);
    if (file) console.log("Manual Input - Uploaded File:", file.originalname);

    try {
        const payload = { question: message };

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const fileBase64 = fileBuffer.toString("base64");

            payload.uploads = [{
                data: `data:${file.mimetype};base64,${fileBase64}`,
                type: "file",
                name: file.originalname,
            }];
        }

        const response = await fetch(`${process.env.FLOWISE_URL}/api/v1/prediction/${process.env.FLOW_ID}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.FLOWISE_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Flowise API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log("Flowise Response:", data);

        res.status(200).json(data);
    } catch (error) {
        console.error("Prediction Error:", error.message);
        res.status(500).json({ message: "Terjadi kesalahan: " + error.message });
    } finally {
        if (file) fs.unlinkSync(file.path);
    }
};


// Endpoint: /webhook/qontak (automated chatbot)
export const handleQontakWebhook = async(req, res) => {
    const { message, sender_id } = req.body;

    // Cek apakah payload lengkap
    if (!message || !sender_id) {
        return res.status(400).json({ error: "Payload tidak lengkap." });
    }

    console.log("Pesan masuk dari Qontak:", message);

    try {
        // Mengirimkan pertanyaan ke Flowise untuk mendapatkan balasan
        const flowiseRes = await fetch(`${process.env.FLOWISE_URL}/api/v1/prediction/${process.env.FLOW_ID}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.FLOWISE_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ question: message }),
        });

        if (!flowiseRes.ok) {
            const errorText = await flowiseRes.text();
            throw new Error(`Flowise error: ${flowiseRes.status} - ${errorText}`);
        }

        const flowiseData = await flowiseRes.json();
        const botReply = flowiseData.text || "maaf";

        // Menyusun payload untuk Qontak
        const qontakPayload = {
            "to_number": "628117661000", // The recipient's phone number
            "to_name": "Burhanudin Hakim", // The recipient's name
            "message_template_id": "2c546373-323b-481e-8cf5-c1b9b7e99a2f", // The message template ID
            "channel_integration_id": "58d68cb0-fcdc-4d95-a48b-a94d9bb145e8", // The channel integration ID (WhatsApp)
            "language": {
                "code": "id" // Language code (Indonesian in this case)
            },
            "parameters": {
                "body": []
            }
        };

        // debugging
        console.log("Payload yang dikirim ke Qontak:", JSON.stringify(qontakPayload));

        // Mengirimkan balasan ke Qontak
        const qontakRes = await fetch("https://service-chat.qontak.com/api/open/v1/broadcasts/whatsapp/direct", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.QONTAK_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(qontakPayload),
        });

        if (!qontakRes.ok) {
            const errText = await qontakRes.text();
            throw new Error(`Qontak send error: ${qontakRes.status} - ${errText}`);
        }

        // Menyampaikan bahwa balasan berhasil dikirim
        res.status(200).json({ message: "Balasan berhasil dikirim ke Qontak" });

    } catch (error) {
        // Menangani error yang terjadi selama proses
        console.error("Webhook Error:", error.message);
        res.status(500).json({ error: "Terjadi kesalahan: " + error.message });
    }
};