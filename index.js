import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors"; // Import CORS
import * as dotenv from "dotenv";
dotenv.config();

import { createPrediction } from "./controllers/flowise.js";
import { handleQontakWebhook } from "./controllers/flowise.js";


const app = express();
const URL = process.env.URL


const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


app.post("/api/flowise", upload.single("file"), createPrediction);
app.post("/webhook/qontak", handleQontakWebhook);


app.listen(5000, () => {
    console.log(`Server is running on URL ${URL}`);
});