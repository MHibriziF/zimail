import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { featuredTileKey, nextPin, personTileKey, pinAfterRemoval, screenTileKey } from '../tile-focus';

const ana = personTileKey('ana');
const boScreen = screenTileKey('bo');

describe('which tile has the stage', () => {
	test('a tile the viewer clicked wins over a screen share', () => {
		assert.equal(featuredTileKey(ana, 'bo'), ana);
	});

	test('with nothing clicked, the picked share has it', () => {
		assert.equal(featuredTileKey(null, 'bo'), boScreen);
	});

	test('with nothing clicked and nobody sharing, everyone shares the grid', () => {
		assert.equal(featuredTileKey(null, null), null);
	});

	test('people and screens never share a key', () => {
		assert.notEqual(personTileKey('bo'), screenTileKey('bo'));
	});
});

describe('clicking a tile', () => {
	test('clicking a tile puts it on the stage', () => {
		assert.equal(nextPin(ana, boScreen), ana);
		assert.equal(nextPin(ana, null), ana);
	});

	test('clicking the tile on the stage gives the stage back', () => {
		assert.equal(nextPin(ana, ana), null);
	});

	test('a pin lets go when its tile goes', () => {
		assert.equal(pinAfterRemoval(boScreen, [personTileKey('bo'), boScreen]), null);
		assert.equal(pinAfterRemoval(ana, [boScreen]), ana);
		assert.equal(pinAfterRemoval(null, [boScreen]), null);
	});
});
