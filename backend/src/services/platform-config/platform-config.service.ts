/**
 * Platform Config Service
 *
 * Reads runtime-adjustable config values from the `platform_config` DB table.
 * Values are cached in memory for 60 seconds so changes propagate quickly
 * without hammering the database on every request.
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

class PlatformConfigService {
  private cache = new Map<string, CacheEntry>();

  async get(key: string, defaultValue: string): Promise<string> {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    try {
      const pool = (await import('../../lib/mysql')).default;
      const [rows] = await pool.query(
        'SELECT value FROM platform_config WHERE `key` = ? LIMIT 1',
        [key]
      ) as [any[], any];

      const value = rows.length > 0 ? String(rows[0].value) : defaultValue;
      this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    } catch {
      return defaultValue;
    }
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const raw = await this.get(key, String(defaultValue));
    const parsed = parseFloat(raw);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  async set(key: string, value: string, description?: string): Promise<void> {
    const pool = (await import('../../lib/mysql')).default;
    await pool.query(
      `INSERT INTO platform_config (\`key\`, value, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), description = COALESCE(VALUES(description), description)`,
      [key, value, description ?? null]
    );
    // Invalidate cache immediately so the next read picks up the new value
    this.cache.delete(key);
  }

  async list(): Promise<Array<{ key: string; value: string; description: string | null; updatedAt: Date }>> {
    const pool = (await import('../../lib/mysql')).default;
    const [rows] = await pool.query(
      'SELECT `key`, value, description, updated_at FROM platform_config ORDER BY `key`'
    ) as [any[], any];

    return rows.map((r: any) => ({
      key: r.key,
      value: r.value,
      description: r.description ?? null,
      updatedAt: new Date(r.updated_at),
    }));
  }
}

export const platformConfigService = new PlatformConfigService();
