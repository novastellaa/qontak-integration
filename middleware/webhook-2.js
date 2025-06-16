import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
const PORT = 5000;

// Middleware untuk parsing JSON
app.use(bodyParser.json());

// Endpoint untuk menerima pesan dari Qontak
app.post('/webhook/qontak', async(req, res) => {
    const { text, sender_id, room_id } = req.body;

    // Cek jika data cukup
    if (!text || !sender_id || !room_id) {
        return res.status(400).json({ error: "Payload tidak lengkap." });
    }

    // Kirim data ke Flowise
    try {
        const response = await axios.post('https://api.flowise.ai/process', {
            input: text,
            sender: sender_id
        });

        const responseData = response.data;

        // Kirim balasan ke Qontak
        await axios.post('https://api.qontak.com/v1/messages/send', {
            room_id,
            text: responseData.reply
        });

        res.status(200).send("Payload diterima dan diproses.");
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send("Terjadi kesalahan.");
    }
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});