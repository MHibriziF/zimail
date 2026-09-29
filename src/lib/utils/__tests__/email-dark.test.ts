import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { adaptDarkColours } from '../email-dark';

/** The first colour a `property:` declaration ends up with. */
function colourOf(html: string, property: string): string {
	return html.match(new RegExp(`${property}:\\s*([^;"]+)`))?.[1].trim() ?? '';
}

function hsl(hex: string): [number, number, number] {
	const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	const delta = max - min;
	if (delta === 0) return [0, 0, lightness];
	let hue: number;
	if (max === red) hue = ((green - blue) / delta) % 6;
	else if (max === green) hue = (blue - red) / delta + 2;
	else hue = (red - green) / delta + 4;
	return [(hue * 60 + 360) % 360, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

describe('adaptDarkColours', () => {
	test('a white page goes dark and black text goes light', () => {
		const out = adaptDarkColours('<div style="background:#ffffff;color:#000000">Hi</div>');
		assert.ok(hsl(colourOf(out, 'background'))[2] < 0.15);
		assert.ok(hsl(colourOf(out, 'color'))[2] > 0.9);
	});

	test('each colour keeps its hue — navy turns light blue, orange stays orange', () => {
		for (const ink of ['#1a3d5c', '#d9480f', '#2f7d32']) {
			const out = adaptDarkColours(`<p style="color:${ink}">x</p>`);
			const [hueBefore, , lightBefore] = hsl(ink);
			const [hueAfter, , lightAfter] = hsl(colourOf(out, 'color'));
			assert.ok(Math.abs(hueBefore - hueAfter) < 2, `${ink}: hue ${hueBefore} → ${hueAfter}`);
			assert.ok(lightAfter > lightBefore, `${ink} got lighter`);
		}
	});

	test('a pale highlight becomes a dark tint of the same colour', () => {
		const out = adaptDarkColours('<span style="background-color:#fff3bf">note</span>');
		const [hue, , lightness] = hsl(colourOf(out, 'background-color'));
		assert.ok(Math.abs(hue - hsl('#fff3bf')[0]) < 2);
		assert.ok(lightness < 0.2);
	});

	test('what is already on the dark side stays — a black bar with white text on it', () => {
		const html = '<td style="background:#111111;color:#ffffff">Header</td>';
		assert.equal(adaptDarkColours(html), html);
	});

	test('stylesheets and colour attributes are recoloured too', () => {
		const out = adaptDarkColours('<style>body { background: #fff; color: #222 }</style><table bgcolor="white"><td><font color="black">x</font></td></table>');
		assert.ok(!out.includes('background: #fff;'));
		assert.ok(!out.includes('bgcolor="white"'));
		assert.ok(!out.includes('color="black"'));
	});

	test('images and their links are never touched', () => {
		const html = '<img src="https://cdn.test/logo-white-black.png" alt="Logo black on white">';
		assert.equal(adaptDarkColours(html), html);
	});

	test('see-through colours are left alone', () => {
		const html = '<p style="color:rgba(0, 0, 0, 0.1)">x</p>';
		assert.equal(adaptDarkColours(html), html);
	});
});
