import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, csvToLegs, dedupeKey, parseCsv, parseDate, parseTime, toCsv, type CsvLeg } from '../src/csv.ts';

// npm test runs with TZ=America/Phoenix, so local times are fixed.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

const leg = (over: Partial<CsvLeg> = {}): CsvLeg => ({
  date: '2026-09-21',
  leg_no: 1,
  start_time: at(2026, 9, 21, 8, 12),
  end_time: at(2026, 9, 21, 8, 41),
  from_address: '20 East Main Street, Mesa, Arizona 85201',
  to_address: '748 East Main Street, Mesa, Arizona 85203',
  miles: 12.34,
  purpose: 'Inspection',
  note: 'Smith roof claim',
  from_lat: 33.4152,
  from_lng: -111.8315,
  to_lat: 33.4152,
  to_lng: -111.81418,
  ...over,
});

test('header is exactly the spec column order', () => {
  assert.equal(toCsv([]).split('\r\n')[0], 'date,leg,start_time,end_time,from_address,to_address,miles,purpose,note,from_lat,from_lng,to_lat,to_lng');
  assert.equal(COLUMNS.length, 13);
});

test('row format: local HH:MM times, 2-dp miles, 6-dp coords, quoted addresses', () => {
  const row = toCsv([leg()]).split('\r\n')[1];
  assert.equal(
    row,
    '2026-09-21,1,08:12,08:41,"20 East Main Street, Mesa, Arizona 85201","748 East Main Street, Mesa, Arizona 85203",12.34,Inspection,Smith roof claim,33.415200,-111.831500,33.415200,-111.814180'
  );
});

test('round trip keeps every field', () => {
  const src = [
    leg(),
    leg({ leg_no: 2, note: 'He said "call first", then\nleft', purpose: 'Adjuster meeting' }),
    leg({ leg_no: 3, start_time: null, end_time: null, from_lat: null, from_lng: null, to_lat: null, to_lng: null, note: null }),
  ];
  const { legs, errors } = csvToLegs(toCsv(src));
  assert.deepEqual(errors, []);
  assert.deepEqual(legs.map((l) => l.leg), src);
  assert.deepEqual(legs.map((l) => dedupeKey(l.leg)), src.map(dedupeKey));
});

test('parseCsv: quotes, escaped quotes, embedded newlines, CRLF, BOM, blank lines', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n"multi\nline",z\n');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 4]);
});

test('spreadsheet-mangled values still import (M/D/YYYY, 12-hour times, reordered columns)', () => {
  const csv = 'miles,date,start_time,end_time,purpose\n7.5,9/21/2026,8:05 AM,1:10 PM,Office\n';
  const { legs, errors } = csvToLegs(csv);
  assert.deepEqual(errors, []);
  assert.equal(legs[0].leg.date, '2026-09-21');
  assert.equal(legs[0].leg.start_time, at(2026, 9, 21, 8, 5));
  assert.equal(legs[0].leg.end_time, at(2026, 9, 21, 13, 10));
  assert.equal(legs[0].leg.miles, 7.5);
});

test('a leg past midnight ends on the next day', () => {
  const { legs } = csvToLegs('date,start_time,end_time,miles\n2026-09-21,23:40,00:15,20\n');
  assert.equal(legs[0].leg.end_time, at(2026, 9, 22, 0, 15));
});

test('bad rows are reported with line numbers and the rest still import', () => {
  const csv = 'date,miles,start_time\n2026-09-21,5,\n2026-13-01,5,\nnot a date,5,\n2026-09-21,abc,\n2026-09-21,-1,\n2026-09-21,5,25:00\n2026-09-22,3,\n';
  const { legs, errors } = csvToLegs(csv);
  assert.equal(legs.length, 2);
  assert.deepEqual(errors.map((e) => e.line), [3, 4, 5, 6, 7]);
});

test('missing required columns is one clear error', () => {
  const { legs, errors } = csvToLegs('name,amount\nfoo,1\n');
  assert.equal(legs.length, 0);
  assert.match(errors[0].message, /Missing columns: date, miles/);
});

test('dedupe key ignores purpose/note edits and spreadsheet coordinate rounding', () => {
  const a = leg();
  assert.equal(dedupeKey(a), dedupeKey({ ...a, purpose: 'Office', note: 'changed' }));
  assert.equal(dedupeKey(a), dedupeKey({ ...a, from_lat: 33.41521, to_lng: -111.814181 }));
  assert.notEqual(dedupeKey(a), dedupeKey({ ...a, miles: 12.35 }));
  assert.notEqual(dedupeKey(a), dedupeKey({ ...a, start_time: at(2026, 9, 21, 8, 13) }));
});

test('parseDate and parseTime edge cases', () => {
  assert.equal(parseDate('2026-02-29'), null);
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  assert.equal(parseTime('12:00 AM'), 0);
  assert.equal(parseTime('12:30 pm'), 12 * 60 + 30);
  assert.equal(parseTime('13:00 PM'), null);
  assert.equal(parseTime('7:05:59'), 7 * 60 + 5);
});
