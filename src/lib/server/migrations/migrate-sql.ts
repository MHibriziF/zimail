/**
 * SQL text handling for the migration runner, kept apart from the runner
 * itself: `migrate.ts` reaches for `import.meta.glob`, which only exists under
 * the bundler, and these need to be testable without it.
 */

/**
 * Splits one migration file into the statements D1 will accept.
 *
 * `db.exec` needs every statement on a single line, which these are not, so
 * they are split here instead. Quote tracking is what keeps a `--` or a `;`
 * inside a string literal from being mistaken for a comment or a boundary.
 */
export function splitStatements(sql: string): string[] {
	const statements: string[] = [];
	let current = '';
	let index = 0;

	while (index < sql.length) {
		const character = sql[index];

		if (character === "'") {
			const end = stringLiteralEnd(sql, index);
			current += sql.slice(index, end);
			index = end;
		} else if (character === '-' && sql[index + 1] === '-') {
			const newline = sql.indexOf('\n', index);
			current += '\n';
			index = newline === -1 ? sql.length : newline + 1;
		} else if (character === ';' && insideTriggerBody(current)) {
			current += character;
			index += 1;
		} else if (character === ';') {
			statements.push(current);
			current = '';
			index += 1;
		} else {
			current += character;
			index += 1;
		}
	}

	statements.push(current);
	return statements.map((statement) => statement.trim()).filter(Boolean);
}

/**
 * A trigger's body is statements of its own, each ending in `;`, between
 * BEGIN and END — only the `;` after END closes the CREATE TRIGGER.
 */
function insideTriggerBody(statement: string): boolean {
	const words = statement.trim().toUpperCase().split(/\s+/);
	if (words[0] !== 'CREATE') return false;
	const trigger = words.indexOf('TRIGGER');
	if (trigger < 1 || trigger > 2) return false;
	return words.at(-1) !== 'END';
}

/** Index just past the string literal opening at `start`; '' inside it is an escaped quote. */
function stringLiteralEnd(sql: string, start: number): number {
	let index = start + 1;
	while (index < sql.length) {
		if (sql[index] !== "'") index += 1;
		else if (sql[index + 1] === "'") index += 2;
		else return index + 1;
	}
	return sql.length;
}
