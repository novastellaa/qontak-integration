import Tesseract from "tesseract.js";

export const extractTextFromImage = async(filePath) => {
    try {
        const result = await Tesseract.recognize(
            filePath,
            "eng", {
                logger: m => console.log("[OCR Progress]", m)
            }
        );
        let ocrText = result.data.text || "";

        ocrText = ocrText
            .replace(/\n+/g, " ")
            .replace(/[^\w\s.,:;!?()%@/-]/g, "")
            .trim();

        return ocrText;
    } catch (error) {
        console.error("Error saat OCR:", error);
        return "";
    }
};