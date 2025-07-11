import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors";
import * as dotenv from "dotenv";

dotenv.config();

import { receiveMessage } from "./middleware/webhook-8jul.js";

const app = express();
const PORT = process.env.PORT || 6666;

const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/webhook/qontak", upload.single("file"), receiveMessage);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});