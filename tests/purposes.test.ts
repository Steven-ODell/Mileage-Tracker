import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromPicker, isBusiness, toPicker } from '../src/purposes.ts';

test('fromPicker: a button keeps the text as the note', () => {
  assert.deepEqual(fromPicker('Final walk', ' Smith claim '), { purpose: 'Final walk', note: 'Smith claim' });
  assert.deepEqual(fromPicker('Office', '  '), { purpose: 'Office', note: null });
});

test('fromPicker: typed text with no button becomes the purpose', () => {
  assert.deepEqual(fromPicker(null, ' Dropped off permit at city hall '), { purpose: 'Dropped off permit at city hall', note: null });
  assert.deepEqual(fromPicker(null, ''), { purpose: null, note: null });
});

test('toPicker: presets light their button, typed purposes go back in the text box', () => {
  assert.deepEqual(toPicker('Final walk', 'Smith'), { chip: 'Final walk', text: 'Smith' });
  assert.deepEqual(toPicker(null, null), { chip: null, text: '' });
  assert.deepEqual(toPicker('Permit pickup', null), { chip: null, text: 'Permit pickup' });
  // An imported CSV row could carry both; neither is dropped.
  assert.deepEqual(toPicker('Permit pickup', 'Tempe'), { chip: null, text: 'Permit pickup; Tempe' });
});

test('a typed purpose round-trips and counts as business', () => {
  const { chip, text } = toPicker('Permit pickup', null);
  assert.deepEqual(fromPicker(chip, text), { purpose: 'Permit pickup', note: null });
  assert.equal(isBusiness('Permit pickup'), true);
  assert.equal(isBusiness('Final walk'), true);
});
