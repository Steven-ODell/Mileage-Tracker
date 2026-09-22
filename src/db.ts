import * as SQLite from 'expo-sqlite';
import type { Fix } from './geo';

// One connection per JS runtime. The background location task can run in a
// headless runtime after the UI is gone, so everything goes through here.
let conn: SQLite.SQLiteDatabase | null = null;

export function db(): SQLite.SQLiteDatabase {
  if (conn) return conn;
  conn = SQLite.openDatabaseSync('mileage.db');
  conn.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(conn);
  return conn;
}

function migrate(d: SQLite.SQLiteDatabase) {
  const v = d.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  if (v < 1) {
    d.execSync(`
      CREATE TABLE days (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,              -- local YYYY-MM-DD
        started_at INTEGER NOT NULL,     -- epoch ms
        ended_at INTEGER,                -- null while the day is open
        interrupted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE legs (
        id INTEGER PRIMARY KEY,
        day_id INTEGER REFERENCES days(id),
        date TEXT NOT NULL,
        leg_no INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,                -- null while the leg is being driven
        from_lat REAL, from_lng REAL, from_address TEXT,
        to_lat REAL, to_lng REAL, to_address TEXT,
        miles REAL,
        purpose TEXT,
        note TEXT,
        source TEXT NOT NULL DEFAULT 'gps',
        interrupted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX legs_date ON legs(date);
      CREATE TABLE points (
        id INTEGER PRIMARY KEY,
        leg_id INTEGER NOT NULL REFERENCES legs(id),
        ts INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        accuracy REAL
      );
      CREATE INDEX points_leg ON points(leg_id, ts);
      PRAGMA user_version = 1;
    `);
  }
}

export type Day = {
  id: number;
  date: string;
  started_at: number;
  ended_at: number | null;
  interrupted: number;
};

export type Leg = {
  id: number;
  day_id: number | null;
  date: string;
  leg_no: number;
  start_time: number;
  end_time: number | null;
  from_lat: number | null;
  from_lng: number | null;
  from_address: string | null;
  to_lat: number | null;
  to_lng: number | null;
  to_address: string | null;
  miles: number | null;
  purpose: string | null;
  note: string | null;
  source: string;
  interrupted: number;
};

export function localDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function openDay(): Day | null {
  return db().getFirstSync<Day>('SELECT * FROM days WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1');
}

export function openLeg(): Leg | null {
  return db().getFirstSync<Leg>(
    `SELECT legs.* FROM legs JOIN days ON days.id = legs.day_id
     WHERE days.ended_at IS NULL AND legs.end_time IS NULL ORDER BY legs.id DESC LIMIT 1`
  );
}

export function legsForDate(date: string): Leg[] {
  return db().getAllSync<Leg>('SELECT * FROM legs WHERE date = ? ORDER BY start_time, leg_no', date);
}

export function legsForDay(dayId: number): Leg[] {
  return db().getAllSync<Leg>('SELECT * FROM legs WHERE day_id = ? ORDER BY leg_no', dayId);
}

export function pointsForLeg(legId: number): Fix[] {
  return db().getAllSync<Fix>('SELECT ts, lat, lng, accuracy FROM points WHERE leg_id = ? ORDER BY ts', legId);
}

export function lastPoint(legId: number): Fix | null {
  return db().getFirstSync<Fix>(
    'SELECT ts, lat, lng, accuracy FROM points WHERE leg_id = ? ORDER BY ts DESC LIMIT 1',
    legId
  );
}

export function insertPoints(legId: number, fixes: Fix[]) {
  if (!fixes.length) return;
  const d = db();
  const write = () => {
    for (const f of fixes) {
      d.runSync(
        'INSERT INTO points (leg_id, ts, lat, lng, accuracy) VALUES (?, ?, ?, ?, ?)',
        legId, f.ts, f.lat, f.lng, f.accuracy
      );
    }
  };
  // SQLite can't nest BEGIN; callers like markStop already hold a transaction.
  if (d.isInTransactionSync()) write();
  else d.withTransactionSync(write);
}

export function createDay(ts: number): number {
  return db().runSync('INSERT INTO days (date, started_at) VALUES (?, ?)', localDate(ts), ts).lastInsertRowId;
}

export function createLeg(dayId: number, legNo: number, ts: number, from: Fix): number {
  const d = db();
  const date = d.getFirstSync<{ date: string }>('SELECT date FROM days WHERE id = ?', dayId)!.date;
  const id = d.runSync(
    `INSERT INTO legs (day_id, date, leg_no, start_time, from_lat, from_lng)
     VALUES (?, ?, ?, ?, ?, ?)`,
    dayId, date, legNo, ts, from.lat, from.lng
  ).lastInsertRowId;
  insertPoints(id, [from]);
  return id;
}

export function closeLeg(legId: number, ts: number, to: Fix, miles: number) {
  db().runSync(
    'UPDATE legs SET end_time = ?, to_lat = ?, to_lng = ?, miles = ? WHERE id = ?',
    ts, to.lat, to.lng, miles, legId
  );
}

export function closeDay(dayId: number, ts: number) {
  db().runSync('UPDATE days SET ended_at = ? WHERE id = ?', ts, dayId);
}

export function markInterrupted(dayId: number, legId: number | null) {
  const d = db();
  d.runSync('UPDATE days SET interrupted = 1 WHERE id = ?', dayId);
  if (legId != null) d.runSync('UPDATE legs SET interrupted = 1 WHERE id = ?', legId);
}

export function setAddress(legId: number, end: 'from' | 'to', address: string) {
  const col = end === 'from' ? 'from_address' : 'to_address';
  db().runSync(`UPDATE legs SET ${col} = ? WHERE id = ?`, address, legId);
}

export function legsMissingAddress(): Leg[] {
  return db().getAllSync<Leg>(
    `SELECT * FROM legs WHERE (from_lat IS NOT NULL AND from_address IS NULL)
       OR (to_lat IS NOT NULL AND to_address IS NULL) ORDER BY id DESC LIMIT 50`
  );
}

export function businessMiles(fromDate: string, toDate: string): number {
  const r = db().getFirstSync<{ m: number | null }>(
    `SELECT SUM(miles) AS m FROM legs WHERE date >= ? AND date <= ?
       AND end_time IS NOT NULL AND (purpose IS NULL OR purpose != 'Personal')`,
    fromDate, toDate
  );
  return r?.m ?? 0;
}
