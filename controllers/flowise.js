import fs from "fs";

export const createPrediction = async(req, res) => {
    // Ambil message dari form-data
    const { message } = req.body;
    const file = req.file;

    console.log("Message:", message);
    console.log("File:", req.file);

    if (file) {
        console.log("Uploaded File:", file.originalname);
    }

    try {
        const payload = {
            question: message, // Menggunakan message dari form-data
        };

        // Jika ada file, encode ke base64 dan kirim ke Flowise
        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const fileBase64 = fileBuffer.toString("base64");

            payload.uploads = [{
                data: `data:${file.mimetype};base64,${fileBase64}`,
                type: "file",
                name: file.originalname,
            }, ];
        }

        const response = await fetch(
            `${process.env.FLOWISE_URL}/api/v1/prediction/${process.env.FLOW_ID}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.FLOWISE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }
        );

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