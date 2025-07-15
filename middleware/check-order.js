import redis from "../utils/redis.js";
import db from "../utils/db.js";
import logger from "../utils/logger.js";
import fetch from "node-fetch";

// export const checkOrderInfo = async(iccid, orderId) => {
//     const cacheKey = `vendor_cache:${iccid}:${orderId}`;

//     try {
//         const lockKey = `lock:${cacheKey}`;
//         const lock = await redis.set(lockKey, "1", "NX", "EX", 30); // lock 30 detik

//         if (!lock) {
//             await sleep(2000); // tunggu proses lain
//             const cached = await redis.get(cacheKey);
//             if (!cached) throw new Error("Cache belum tersedia.");
//             return JSON.parse(cached);
//         }

//         // --- Cek ke DB: apakah sudah pernah disimpan ---
//         const existing = await db `
//             SELECT * FROM vendor_cache
//             WHERE iccid = ${iccid} AND order_id = ${orderId}
//             LIMIT 1
//         `;

//         if (existing.length > 0) {
//             await redis.set(cacheKey, JSON.stringify(existing[0]), "EX", 1800);
//             return existing[0];
//         }

//         // --- Kalau tidak ada di DB → request ke vendor ---
//         const vendorPayload = { iccid, orderId };

//         const vendorResponse = await fetch(process.env.VENDOR_API_URL, {
//             method: "POST",
//             headers: {
//                 Authorization: "Bearer " + process.env.VENDOR_API_KEY,
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify(vendorPayload)
//         });

//         if (!vendorResponse.ok) {
//             const errorText = await vendorResponse.text();
//             throw new Error("Vendor API error: " + errorText);
//         }

//         const vendorRaw = await vendorResponse.json();
//         const subOrder = vendorRaw && vendorRaw.tradeData && vendorRaw.tradeData.subOrderList && vendorRaw.tradeData.subOrderList[0];


//         if (!subOrder) {
//             throw new Error("Data vendor tidak valid atau kosong.");
//         }

//         const vendorData = {
//             skuId: subOrder.skuId,
//             skuName: subOrder.skuName,
//             planStatus: subOrder.planStatus,
//             planStartTime: subOrder.planStartTime,
//             planEndTime: subOrder.planEndTime,
//             totalDays: subOrder.totalDays,
//             remainingDays: subOrder.remainingDays,
//             totalTraffic: subOrder.totalTraffic,
//             remainingTraffic: subOrder.remainingTraffic,
//             usedTraffic: subOrder.usedTraffic
//         };

//         // Simpan ke DB + Redis
//         await saveVendorCacheToDb(iccid, orderId, vendorData, vendorRaw);

//         return vendorData;

//     } catch (err) {
//         logger.error("Error di checkOrderInfo: " + err.message);
//         throw err;
//     }
// };


export const checkOrderInfo = async(iccid, orderId) => {
    const cacheKey = `vendor_cache:${iccid}:${orderId}`;

    try {
        const lockKey = `lock:${cacheKey}`;
        const lock = await redis.set(lockKey, "1", "NX", "EX", 30); // lock 30 detik

        if (!lock) {
            await sleep(2000); // tunggu proses lain
            const cached = await redis.get(cacheKey);
            if (!cached) throw new Error("Cache belum tersedia.");
            return JSON.parse(cached);
        }

        // --- Cek di tabel vendor_cache menggunakan ICCID dan orderId ---
        const existing = await db `
            SELECT * FROM vendor_cache
            WHERE iccid = ${iccid} AND order_id = ${orderId}
            LIMIT 1
        `;

        if (existing.length > 0) {
            // Simpan data ke Redis untuk cache
            await redis.set(cacheKey, JSON.stringify(existing[0]), "EX", 1800);
            return existing[0]; // Kembalikan data dari vendor_cache
        }

        // Jika tidak ada data di vendor_cache, log dan beri respons
        logger.warn(`Data vendor untuk ICCID ${iccid} dan Order ID ${orderId} tidak ditemukan di database.`);

        // Misalnya, kamu bisa mengembalikan error atau informasi lain
        return null;

    } catch (err) {
        logger.error("Error di checkOrderInfo: " + err.message);
        throw err;
    }
};



const saveVendorCacheToDb = async(iccid, orderId, vendorData, rawJson) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const result = await client.query(
            `INSERT INTO vendor_cache (
                iccid, order_id, sku_id, sku_name, plan_status, plan_start_time,
                plan_end_time, total_days, remaining_days, total_traffic,
                remaining_traffic, used_traffic, raw_json
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            ) RETURNING id`, [
                iccid,
                orderId,
                vendorData.skuId,
                vendorData.skuName,
                vendorData.planStatus,
                vendorData.planStartTime,
                vendorData.planEndTime,
                vendorData.totalDays,
                vendorData.remainingDays,
                vendorData.totalTraffic,
                vendorData.remainingTraffic,
                vendorData.usedTraffic,
                JSON.stringify(rawJson)
            ]
        );
        const cacheKey = `vendor_cache:${iccid}:${orderId}`;
        await redis.set(cacheKey, JSON.stringify(vendorData), "EX", 1800);

        await client.query("COMMIT");
        return result.rows[0].id;
    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Gagal menyimpan ke vendor_cache: " + err.message);
        throw err;
    } finally {
        client.release();
    }
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}