import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),

  db: {
    host: process.env.DB_HOST || process.env.host || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || process.env.user || 'root',
    password: process.env.DB_PASSWORD || process.env.password || '',
    database: process.env.DB_NAME || process.env.database || '2settle',
  },

  coinmarketcap: {
    apiKey: process.env.COINMARKETCAP_API_KEY || '',
  },

  mongoro: {
    token: process.env.MONGORO_TOKEN || '',
    transferPin: process.env.MONGORO_TRANSFERPIN || '',
  },
};

export default config;
