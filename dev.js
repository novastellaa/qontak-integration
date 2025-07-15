import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from "dotenv";
import { receiveMessage } from "./middleware/feat-image.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 6666;

const upload = multer({
    dest: "uploads/",
    limits: { fileSize: 5 * 1024 * 1024 }, // Max 5 MB
});

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST"],
}));

app.use(helmet());
app.use(compression());
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/webhook/qontak", upload.single("file"), receiveMessage);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});