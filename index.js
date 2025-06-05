import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors"; // Import CORS
import * as dotenv from "dotenv";
dotenv.config();

import { createPrediction } from "./controllers/flowise.js";

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS
app.use(cors({
    origin: "http://localhost:5000", // Ganti dengan origin frontend Anda
}));


// Set up multer for file upload
const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// POST endpoint to handle form-data (file + message)
app.post("/api/flowise", upload.single("file"), createPrediction);

// Listen to the specified port
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});