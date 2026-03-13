import mysql from 'mysql2/promise';
import config from '../config';

const poolConfig = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  maxIdle: 50,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

declare global {
  var mysqlPool: mysql.Pool | undefined;
}

export const pool = global.mysqlPool || mysql.createPool(poolConfig);

if (process.env.NODE_ENV !== 'production') {
  global.mysqlPool = pool;
}

export default pool;
