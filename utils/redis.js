import Redis from 'ioredis';

const redis = new Redis({
    host: 'localhost',
    port: 6379,
    retryStrategy(times) {
        return Math.min(times * 50, 2000);
    }
});

redis.on("connect", () => {
    console.log("Redis connected successfully.");
});

redis.on("error", (err) => {
    console.error("Redis error:", err);
});

redis.set('myKey', 'Hello Redis!', 'EX', 3600); // Set data dengan waktu kadaluarsa 1 jam

redis.ping((err, result) => {
    if (err) {
        console.error("Redis ping error:", err);
    } else {
        console.log("Redis connected:", result); // PONG
    }
});

export default redis;