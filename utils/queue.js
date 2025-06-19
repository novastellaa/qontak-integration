import Queue from 'bull';

const messageQueue = new Queue('qontak-messages', {
    redis: { host: '127.0.0.1', port: 6379 }
});

export default messageQueue;