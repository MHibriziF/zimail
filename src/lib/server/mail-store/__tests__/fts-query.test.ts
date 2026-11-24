import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ftsQuery, ftsQueryAll } from '../fts-query';

describe('ftsQuery', () => {
	it('matches every word as a prefix', () => {
		assert.equal(ftsQuery('lunch thurs'), '"lunch"* "thurs"*');
	});

	it('keeps quoted text as an exact phrase', () => {
		assert.equal(ftsQuery('"logo directions" priya'), '"logo directions" "priya"*');
	});

	it('splits an address into its words, as the index does', () => {
		assert.equal(ftsQuery('priya@example.com'), '"priya"* "example"* "com"*');
	});

	it('drops FTS5 syntax so typed text cannot change the query', () => {
		assert.equal(ftsQuery('subject:budget NEAR(a b) -spam ^x *'), '"subject"* "budget"* "NEAR"* "a"* "b"* "spam"* "x"*');
	});

	it('treats an unmatched quote as an ordinary word boundary', () => {
		assert.equal(ftsQuery('"invoice 1042'), '"invoice"* "1042"*');
	});

	it('keeps letters from any script', () => {
		assert.equal(ftsQuery('réunion 会议'), '"réunion"* "会议"*');
	});

	it('returns null when nothing searchable is left', () => {
		assert.equal(ftsQuery('  !!  ""  '), null);
		assert.equal(ftsQuery(''), null);
	});
});

describe('ftsQueryAll', () => {
	it('needs every term, or any one', () => {
		assert.equal(ftsQueryAll(['flight', 'hotel booking']), '("flight"*) AND ("hotel"* "booking"*)');
		assert.equal(ftsQueryAll(['flight', 'hotel'], true), '("flight"*) OR ("hotel"*)');
	});

	it('gives up when one term has nothing searchable', () => {
		assert.equal(ftsQueryAll(['flight', '!!']), null);
		assert.equal(ftsQueryAll([]), null);
	});
});
