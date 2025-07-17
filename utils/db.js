import dotenv from 'dotenv';
import postgres from 'postgres';
import Logger from './logger.js';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

const db = postgres(connectionString)

async function testDbConnection() {
    try {
        const result = await db `SELECT NOW()`;
        // Logger.info("Database connection test SUCCES");
        // Logger.info('Current time from DB:', result[0].now);
    } catch (error) {
        Logger.error('Database connection test failed:', error);
    }
}

testDbConnection();

export default db;