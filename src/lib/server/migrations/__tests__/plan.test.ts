import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { planMigrations, type PlannedMigration } from '../plan';

const old = (name: string): PlannedMigration => ({ name, sql: `-- ${name}`, archived: true });
const squash: PlannedMigration = { name: '0001_squashed_0003.sql', sql: '-- squash', replaces: ['0001_a.sql', '0002_b.sql', '0003_c.sql'] };
const next: PlannedMigration = { name: '0004_d.sql', sql: '-- 0004' };
const all = [squash, next, old('0001_a.sql'), old('0002_b.sql'), old('0003_c.sql')];

const names = (steps: { name: string; sql: string | null }[]) => steps.map((step) => `${step.name}${step.sql === null ? ' (record)' : ''}`);

describe('planning migrations around a squash', () => {
	test('a fresh database runs the squash, then what came after it', () => {
		assert.deepEqual(names(planMigrations(all, new Set())), ['0001_squashed_0003.sql', '0004_d.sql']);
	});

	test('a database that had all of it only records the squash', () => {
		const recorded = new Set(['0001_a.sql', '0002_b.sql', '0003_c.sql']);
		assert.deepEqual(names(planMigrations(all, recorded)), ['0001_squashed_0003.sql (record)', '0004_d.sql']);
	});

	test('a database part of the way through runs the rest of the history, then records the squash', () => {
		const recorded = new Set(['0001_a.sql']);
		assert.deepEqual(names(planMigrations(all, recorded)), [
			'0002_b.sql',
			'0003_c.sql',
			'0001_squashed_0003.sql (record)',
			'0004_d.sql'
		]);
	});

	test('nothing to do once the squash and everything after it are recorded', () => {
		assert.deepEqual(planMigrations(all, new Set(['0001_squashed_0003.sql', '0004_d.sql'])), []);
	});

	test('archived migrations never run on their own', () => {
		const steps = planMigrations(all, new Set(['0001_squashed_0003.sql']));
		assert.deepEqual(names(steps), ['0004_d.sql']);
	});

	test('a squash of a squash counts the first one as done when its own history is', () => {
		const second: PlannedMigration = { name: '0001_squashed_0004.sql', sql: '-- squash 2', replaces: ['0001_squashed_0003.sql', '0004_d.sql'] };
		const nested = [second, { ...squash, archived: true }, { ...next, archived: true }, old('0001_a.sql'), old('0002_b.sql'), old('0003_c.sql')];

		// Installed before either squash, all the way through.
		const original = new Set(['0001_a.sql', '0002_b.sql', '0003_c.sql', '0004_d.sql']);
		assert.deepEqual(names(planMigrations(nested, original)), ['0001_squashed_0004.sql (record)']);
		// Installed from the first squash.
		assert.deepEqual(names(planMigrations(nested, new Set(['0001_squashed_0003.sql', '0004_d.sql']))), ['0001_squashed_0004.sql (record)']);
		// Stopped at 0002 before any squash existed.
		assert.deepEqual(names(planMigrations(nested, new Set(['0001_a.sql', '0002_b.sql']))), [
			'0003_c.sql',
			'0001_squashed_0003.sql (record)',
			'0004_d.sql',
			'0001_squashed_0004.sql (record)'
		]);
		// Brand new.
		assert.deepEqual(names(planMigrations(nested, new Set())), ['0001_squashed_0004.sql']);
	});

	test('a replaced migration missing from the archive is an error, not a silent skip', () => {
		assert.throws(() => planMigrations([squash], new Set(['0001_a.sql'])), /0002_b\.sql .*missing from migrations\/archive/);
	});

	test('without any squash it is the plain pending list, in order', () => {
		const plain = [{ name: '0002_b.sql', sql: 'b' }, { name: '0001_a.sql', sql: 'a' }];
		assert.deepEqual(names(planMigrations(plain, new Set(['0001_a.sql']))), ['0002_b.sql']);
	});
});
