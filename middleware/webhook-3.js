import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 6666;

app.use(bodyParser.json());

// Create Prediction
const createPrediction = async(req, res) => {
    const { message } = req.body;
    const file = req.file;

    console.log("Received Message:", message);
    if (file) console.log("Uploaded File:", file.originalname);

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

        if (data && data.text) {
            return data.text;
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
    const { message, sender_id } = req.body;
    console.log("Payload yang diterima:", req.body);

    try {
        const flowiseReply = await createPrediction({ body: { message } });

        await sendToQontak(flowiseReply, sender_id);

        res.status(200).send("OK");
    } catch (error) {
        console.error("Error in processing message:", error);
        res.status(500).send("Error processing request");
    }
};



// Send message to qontak
export const sendToQontak = async(message, sender_id) => {
    const payload = {
        to: sender_id,
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