// CSV export/import. Zero imports: used by the app and by Node tests (Node
// runs this file via type stripping, so only erasable TS syntax).

export const COLUMNS = [
  'date', 'leg', 'start_time', 'end_time', 'from_address', 'to_address', 'miles',
  'purpose', 'note', 'from_lat', 'from_lng', 'to_lat', 'to_lng',
] as const;
export type Column = (typeof COLUMNS)[number];

export type CsvLeg = {
  date: string; // YYYY-MM-DD
  leg_no: number;
  start_time: number | null; // epoch ms
  end_time: number | null;
  from_address: string | null;
  to_address: string | null;
  miles: number | null;
  purpose: string | null;
  note: string | null;
  from_lat: number | null;
  from_lng: number | null;
  to_lat: number | null;
  to_lng: number | null;
};

// ---------------------------------------------------------------- writing ---

const pad = (n: number) => String(n).padStart(2, '0');

// Local 24-hour "HH:MM". The date column carries the day.
export function hhmm(ts: number | null): string {
  if (ts == null) return '';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const num = (v: number | null, digits: number) => (v == null ? '' : v.toFixed(digits));

export function legToRow(l: CsvLeg): Record<Column, string> {
  return {
    date: l.date,
    leg: String(l.leg_no),
    start_time: hhmm(l.start_time),
    end_time: hhmm(l.end_time),
    from_address: l.from_address ?? '',
    to_address: l.to_address ?? '',
    miles: num(l.miles, 2),
    purpose: l.purpose ?? '',
    note: l.note ?? '',
    from_lat: num(l.from_lat, 6),
    from_lng: num(l.from_lng, 6),
    to_lat: num(l.to_lat, 6),
    to_lng: num(l.to_lng, 6),
  };
}

function quote(field: string): string {
  return /[",\r\n]|^\s|\s$/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function toCsv(legs: CsvLeg[]): string {
  const lines = [COLUMNS.join(',')];
  for (const l of legs) {
    const r = legToRow(l);
    lines.push(COLUMNS.map((c) => quote(r[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- reading ---

// RFC 4180: quoted fields may hold commas, quotes ("") and newlines.
// Returns rows with the 1-based line number each row started on.
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const s = text.replace(/^﻿/, '');
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      cells.push(field);
      if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
      cells = [];
      field = '';
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  cells.push(field);
  if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
  return rows;
}

// Accepts YYYY-MM-DD, and M/D/YYYY because Google Sheets and Excel rewrite
// dates that way if the file is opened and saved again.
export function parseDate(v: string): string | null {
  const t = v.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (mt) {
    [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  } else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    [y, m, d] = [+mt[3], +mt[1], +mt[2]];
  } else {
    return null;
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// "08:12", "8:12:30", "8:12 AM", "8:12 pm" -> minutes after midnight.
export function parseTime(v: string): number | null {
  const mt = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(v.trim());
  if (!mt) return null;
  let h = +mt[1];
  const min = +mt[2];
  const ampm = mt[4]?.toLowerCase().replace(/\./g, '');
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'am' && h === 12) h = 0;
    if (ampm === 'pm' && h !== 12) h += 12;
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function atMinutes(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
}

function optNumber(v: string | undefined): number | null | 'bad' {
  const t = (v ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'bad';
}

export type ParseResult = {
  legs: { line: number; leg: CsvLeg }[];
  errors: { line: number; message: string }[];
};

export function csvToLegs(text: string): ParseResult {
  const rows = parseCsv(text);
  const out: ParseResult = { legs: [], errors: [] };
  if (!rows.length) {
    out.errors.push({ line: 1, message: 'The file is empty.' });
    return out;
  }
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const col = (name: Column) => header.indexOf(name);
  const missing = (['date', 'miles'] as Column[]).filter((c) => col(c) < 0);
  if (missing.length) {
    out.errors.push({ line: 1, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Is this a Mileage Log export?` });
    return out;
  }
  const get = (cells: string[], name: Column) => (col(name) < 0 ? '' : (cells[col(name)] ?? ''));
  const text_ = (cells: string[], name: Column) => get(cells, name).trim() || null;

  for (const { line, cells } of rows.slice(1)) {
    const date = parseDate(get(cells, 'date'));
    if (!date) {
      out.errors.push({ line, message: `bad date "${get(cells, 'date')}"` });
      continue;
    }
    const miles = optNumber(get(cells, 'miles'));
    if (miles === 'bad' || miles == null || miles < 0) {
      out.errors.push({ line, message: `bad miles "${get(cells, 'miles')}"` });
      continue;
    }
    const coords = (['from_lat', 'from_lng', 'to_lat', 'to_lng'] as Column[]).map((c) => optNumber(get(cells, c)));
    if (coords.includes('bad')) {
      out.errors.push({ line, message: 'bad coordinates' });
      continue;
    }
    const st = get(cells, 'start_time').trim();
    const et = get(cells, 'end_time').trim();
    const sMin = st ? parseTime(st) : null;
    const eMin = et ? parseTime(et) : null;
    if ((st && sMin == null) || (et && eMin == null)) {
      out.errors.push({ line, message: `bad time "${st && sMin == null ? st : et}"` });
      continue;
    }
    const start = sMin == null ? null : atMinutes(date, sMin);
    let end = eMin == null ? null : atMinutes(date, eMin);
    if (start != null && end != null && end < start) end += 24 * 60 * 60 * 1000; // leg ran past midnight
    const [fromLat, fromLng, toLat, toLng] = coords as (number | null)[];
    out.legs.push({
      line,
      leg: {
        date,
        leg_no: Number(get(cells, 'leg')) || 0,
        start_time: start,
        end_time: end,
        from_address: text_(cells, 'from_address'),
        to_address: text_(cells, 'to_address'),
        miles: Math.round(miles * 100) / 100,
        purpose: text_(cells, 'purpose'),
        note: text_(cells, 'note'),
        from_lat: fromLat,
        from_lng: fromLng,
        to_lat: toLat,
        to_lng: toLng,
      },
    });
  }
  return out;
}

// Identity of a leg for "is this already on the phone?". Built from the
// exported form of the fields so a leg matches its own export after a round
// trip. Purpose and note are left out: they're edited after the fact, and a
// re-import must not duplicate a leg just because its note changed. Coords
// are compared at 4 decimals (~11 m) to survive spreadsheet rounding.
export function dedupeKey(l: CsvLeg): string {
  const r = legToRow(l);
  const c = (v: number | null) => (v == null ? '' : v.toFixed(4));
  const a = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  return [r.date, r.start_time, r.end_time, r.miles, c(l.from_lat), c(l.from_lng), c(l.to_lat), c(l.to_lng),
    a(r.from_address), a(r.to_address)].join('|');
}
