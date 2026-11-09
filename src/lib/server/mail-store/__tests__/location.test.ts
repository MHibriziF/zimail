import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TRASH_CANCELS_SCHEDULE, withLocationRules } from '../location';
import { flagAssignments, type MailFlagUpdate } from '../repository';

const CHOICES = [undefined, true, false] as const;

function everyLocationUpdate(): MailFlagUpdate[] {
	return CHOICES.flatMap((trashed) =>
		CHOICES.flatMap((archived) => CHOICES.map((spam) => ({ trashed, archived, spam })))
	);
}

function label(update: MailFlagUpdate): string {
	return JSON.stringify(update);
}

describe('withLocationRules', () => {
	for (const update of everyLocationUpdate()) {
		test(`${label(update)}`, () => {
			const applied = withLocationRules(update);
			assert.equal(applied.trashed, update.trashed, 'trash is never changed by another flag');
			assert.equal(applied.spam, update.spam, 'spam is never changed by another flag');
			assert.equal(applied.archived, update.spam ? false : update.archived);
		});
	}

	test('leaves read and starred alone', () => {
		assert.deepEqual(withLocationRules({ isRead: true, isStarred: true, spam: true }), {
			isRead: true,
			isStarred: true,
			spam: true,
			archived: false
		});
	});
});

describe('flagAssignments', () => {
	for (const update of everyLocationUpdate()) {
		test(`${label(update)} writes each column once`, () => {
			const { assignments } = flagAssignments(update);
			const columns = assignments.map((assignment) => assignment.split(' = ')[0]);
			assert.equal(new Set(columns).size, columns.length);
			assert.equal(assignments.includes(TRASH_CANCELS_SCHEDULE[0]), update.trashed === true);
		});
	}

	test('reporting spam takes the message out of Archive', () => {
		assert.deepEqual(flagAssignments({ spam: true }).assignments, ['archived_at = NULL', "spam_at = datetime('now')"]);
	});

	test('restoring from Trash does not touch the schedule', () => {
		assert.deepEqual(flagAssignments({ trashed: false }).assignments, ['deleted_at = NULL']);
	});
});
