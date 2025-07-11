import path from "path";
import fs from "fs";
import https from "https";

export const downloadFileToTemp = (url, filename, mimetype) => {
    return new Promise((resolve, reject) => {
        const allowedHost = "cdn.qontak.com";
        const urlHost = new URL(url).hostname;

        if (urlHost !== allowedHost) {
            return reject(new Error("Blocked download from untrusted domain!"));
        }

        if (!["image/jpeg", "image/png", "application/pdf"].includes(mimetype)) {
            return reject(new Error("Tipe file tidak diizinkan."));
        }

        const UPLOAD_DIR = "./uploads";
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR);
        }

        const filePath = path.join(UPLOAD_DIR, filename);
        const fileStream = fs.createWriteStream(filePath);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        };

        const makeRequest = (downloadUrl) => {
            https
                .get(downloadUrl, { headers }, (res) => {
                    console.log("Status code download:", res.statusCode);

                    if (
                        res.statusCode >= 300 &&
                        res.statusCode < 400 &&
                        res.headers.location
                    ) {
                        console.log("Redirecting to:", res.headers.location);
                        makeRequest(res.headers.location);
                        return;
                    }

                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(
                            new Error(`Download error: ${res.statusCode}`)
                        );
                    }

                    const size = parseInt(res.headers["content-length"] || "0", 10);
                    if (size > 5 * 1024 * 1024) {
                        res.destroy();
                        return reject(
                            new Error("File terlalu besar (>5MB).")
                        );
                    }

                    res.pipe(fileStream);
                    fileStream.on("finish", () => {
                        fileStream.close(() => {
                            resolve({
                                path: filePath,
                                mimetype,
                                originalname: filename,
                                cleanup: () => {
                                    fs.unlink(filePath, (err) => {
                                        if (err) {
                                            console.error("❌ Gagal hapus file:", err.message);
                                        } else {
                                            console.log("🗑️ File deleted:", filePath);
                                        }
                                    });
                                },
                            });
                        });
                    });
                })
                .on("error", (err) => {
                    reject(err);
                });
        };

        makeRequest(url);
    });
};