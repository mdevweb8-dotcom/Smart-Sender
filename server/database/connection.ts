import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string = config.databasePath;

export function openDatabase(dbPath: string = config.databasePath): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  dbInstance = db;
  currentDbPath = dbPath;
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return openDatabase(currentDbPath);
  }
  return dbInstance;
}

export function getCurrentDbPath(): string {
  return currentDbPath;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
}
