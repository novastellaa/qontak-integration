import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function analyzeImageWithOpenAI(imageUrl, userPrompt = "Deskripsikan isi gambar ini secara detail.") {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [{
                        type: "text",
                        text: userPrompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: imageUrl,
                            detail: "auto"
                        }
                    }
                ]
            }]
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error("❌ OpenAI Vision API error:", error);
        return null;
    }
}