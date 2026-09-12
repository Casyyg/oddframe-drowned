import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  updatedAt: text('updated_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  payload: text('payload').notNull(),
}, table => [index('idx_sessions_updated_at').on(table.updatedAt), index('idx_sessions_expires_at').on(table.expiresAt)]);
