import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cors from "cors";
import * as dotenv from "dotenv";


dotenv.config();

import { createPrediction } from "./middleware/webhook-1.js";
// import { handleQontakWebhook } from "./controllers/flowise.js";
import { receiveMessage } from "./middleware/webhook-3.js";



const app = express();
const PORT = process.env.PORT || 6666;


const upload = multer({ dest: "uploads/" });


app.use(cors());
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


app.post("/api/flowise", upload.single("file"), createPrediction);
app.post("/webhook/qontak", receiveMessage);


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});