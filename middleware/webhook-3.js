import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware untuk parsing JSON
app.use(bodyParser.json());

const createPrediction = async(req, res) => {
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

        // Modifikasi pengecekan error untuk menghindari error saat mengakses status
        if (data && data.text) {
            return data.text
        } else {
            throw new Error("Unexpected response from Flowise: Missing 'text' field");
        }
    } catch (error) {
        console.error("Prediction Error:", error.message);
        res.status(500).json({ message: "Terjadi kesalahan: " + error.message });
    } finally {
        if (file) fs.unlinkSync(file.path);
    }
};



// Received message from qontak
export const receiveMessage = async(req, res) => {
    const message = req.body.message; // Pesan dari Qontak

    try {
        // Kirim pesan ke Flowise untuk diproses
        const flowiseReply = await createPrediction({ body: { message } });

        // Kirim balasan ke Qontak
        await sendToQontak(flowiseReply);

        res.status(200).send("OK");
    } catch (error) {
        console.error("Error in processing message:", error);
        res.status(500).send("Error processing request");
    }
};


// send message
export const sendToQontak = async(message) => {
    const payload = {
        to: 'recipient_phone_number',
        message: message
    };

    try {
        const response = await fetch('https://api.qontak.com/v1/send_message', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.QONTAK_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Qontak API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log("Qontak Response:", data);
    } catch (error) {
        console.error("Error sending to Qontak:", error);
    }
};