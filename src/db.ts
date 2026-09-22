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
  if (v < 2) {
    // v2: start_time becomes optional (manual legs have no times) and legs
    // gain trim columns. SQLite can't drop NOT NULL in place, so rebuild the
    // table. Foreign keys must be off while the old table is dropped, and that
    // pragma is ignored inside a transaction.
    d.execSync('PRAGMA foreign_keys = OFF;');
    d.withTransactionSync(() => {
      d.execSync(`
        CREATE TABLE legs_v2 (
          id INTEGER PRIMARY KEY,
          day_id INTEGER REFERENCES days(id),
          date TEXT NOT NULL,
          leg_no INTEGER NOT NULL,
          start_time INTEGER,              -- null for manual legs
          end_time INTEGER,                -- null while the leg is being driven
          from_lat REAL, from_lng REAL, from_address TEXT,
          to_lat REAL, to_lng REAL, to_address TEXT,
          miles REAL,
          purpose TEXT,
          note TEXT,
          source TEXT NOT NULL DEFAULT 'gps',
          interrupted INTEGER NOT NULL DEFAULT 0,
          trim_end_ts INTEGER,             -- points after this are ignored
          orig_end_time INTEGER            -- end_time before the first trim
        );
        INSERT INTO legs_v2 (id, day_id, date, leg_no, start_time, end_time, from_lat, from_lng,
          from_address, to_lat, to_lng, to_address, miles, purpose, note, source, interrupted)
        SELECT id, day_id, date, leg_no, start_time, end_time, from_lat, from_lng,
          from_address, to_lat, to_lng, to_address, miles, purpose, note, source, interrupted FROM legs;
        DROP TABLE legs;
        ALTER TABLE legs_v2 RENAME TO legs;
        CREATE INDEX legs_date ON legs(date);
        PRAGMA user_version = 2;
      `);
      for (const r of d.getAllSync<{ date: string }>('SELECT DISTINCT date FROM legs')) renumber(r.date);
    });
    d.execSync('PRAGMA foreign_keys = ON;');
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
  start_time: number | null;
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
  trim_end_ts: number | null;
  orig_end_time: number | null;
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

// Manual legs have no start time; they sort after the tracked legs that day.
const LEG_ORDER = 'COALESCE(start_time, 9000000000000), id';

export function legsForDate(date: string): Leg[] {
  return db().getAllSync<Leg>(`SELECT * FROM legs WHERE date = ? ORDER BY ${LEG_ORDER}`, date);
}

export function legsForYear(year: string): Leg[] {
  return db().getAllSync<Leg>(
    `SELECT * FROM legs WHERE date >= ? AND date <= ? ORDER BY date DESC, ${LEG_ORDER}`,
    `${year}-01-01`, `${year}-12-31`
  );
}

export function yearsWithLegs(): string[] {
  return db()
    .getAllSync<{ y: string }>('SELECT DISTINCT substr(date, 1, 4) AS y FROM legs ORDER BY y DESC')
    .map((r) => r.y);
}

// leg_no is the leg's position within its date. Recomputed after anything
// that adds, removes or re-dates a leg so the log never has gaps.
export function renumber(date: string) {
  const d = db();
  const ids = d.getAllSync<{ id: number }>(`SELECT id FROM legs WHERE date = ? ORDER BY ${LEG_ORDER}`, date);
  ids.forEach((r, i) => d.runSync('UPDATE legs SET leg_no = ? WHERE id = ?', i + 1, r.id));
}

export type LegEdit = {
  date: string;
  from_address: string | null;
  to_address: string | null;
  miles: number;
  purpose: string | null;
  note: string | null;
};

export function insertManualLeg(e: LegEdit): number {
  const d = db();
  let id = 0;
  d.withTransactionSync(() => {
    id = d.runSync(
      `INSERT INTO legs (date, leg_no, from_address, to_address, miles, purpose, note, source)
       VALUES (?, 0, ?, ?, ?, ?, ?, 'manual')`,
      e.date, e.from_address, e.to_address, e.miles, e.purpose, e.note
    ).lastInsertRowId;
    renumber(e.date);
  });
  return id;
}

export function updateLeg(id: number, e: LegEdit) {
  const d = db();
  const old = legById(id);
  if (!old) return;
  d.withTransactionSync(() => {
    d.runSync(
      `UPDATE legs SET date = ?, from_address = ?, to_address = ?, miles = ?, purpose = ?, note = ?,
         interrupted = CASE WHEN ? != COALESCE(miles, -1) THEN 0 ELSE interrupted END
       WHERE id = ?`,
      e.date, e.from_address, e.to_address, e.miles, e.purpose, e.note, e.miles, id
    );
    if (old.date !== e.date) {
      renumber(old.date);
      renumber(e.date);
    }
  });
}

export function setPurpose(id: number, purpose: string | null, note: string | null) {
  db().runSync('UPDATE legs SET purpose = ?, note = ? WHERE id = ?', purpose, note, id);
}

export function deleteLeg(id: number) {
  const d = db();
  const leg = legById(id);
  if (!leg) return;
  if (leg.end_time == null && leg.source === 'gps') throw new Error('End or stop this leg before deleting it.');
  d.withTransactionSync(() => {
    d.runSync('DELETE FROM points WHERE leg_id = ?', id);
    d.runSync('DELETE FROM legs WHERE id = ?', id);
    renumber(leg.date);
  });
}

// Cut the end of a tracked leg back to an earlier recorded point, e.g. when
// End day was forgotten and the drive home got recorded. Non-destructive: the
// points after the cut stay in the database, so resetting the trim restores
// the original leg.
export function trimLeg(id: number, cut: Fix, miles: number) {
  const leg = legById(id);
  if (!leg || leg.end_time == null) return;
  db().runSync(
    `UPDATE legs SET trim_end_ts = ?, orig_end_time = COALESCE(orig_end_time, end_time), end_time = ?,
       to_lat = ?, to_lng = ?, to_address = NULL, miles = ?, interrupted = 0 WHERE id = ?`,
    cut.ts, cut.ts, cut.lat, cut.lng, miles, id
  );
}

export function resetTrim(id: number, end: Fix, miles: number) {
  db().runSync(
    `UPDATE legs SET trim_end_ts = NULL, end_time = COALESCE(orig_end_time, end_time), orig_end_time = NULL,
       to_lat = ?, to_lng = ?, to_address = NULL, miles = ? WHERE id = ?`,
    end.lat, end.lng, miles, id
  );
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
  renumber(date);
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
       AND (end_time IS NOT NULL OR source = 'manual') AND (purpose IS NULL OR purpose != 'Personal')`,
    fromDate, toDate
  );
  return r?.m ?? 0;
}

export function legById(id: number): Leg | null {
  return db().getFirstSync<Leg>('SELECT * FROM legs WHERE id = ?', id);
}
