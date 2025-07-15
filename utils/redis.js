import Redis from 'ioredis';

const redis = new Redis({
    retryStrategy(times) {
        return Math.min(times * 50, 2000);
    },
});

export default redis;