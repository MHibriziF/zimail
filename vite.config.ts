import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import { buildEmojiData, EMOJI_LOCALES, type EmojibaseEntry } from './src/lib/utils/emoji';

const PREFIX = 'virtual:emoji-data/';

/** `virtual:emoji-data/<locale>`: emojibase-data trimmed at build time, so the browser only fetches what the picker uses. */
function emojiData(): Plugin {
	const require = createRequire(import.meta.url);
	const locales = new Set<string>(Object.values(EMOJI_LOCALES));
	return {
		name: 'emoji-data',
		resolveId(id) {
			return id.startsWith(PREFIX) && locales.has(id.slice(PREFIX.length)) ? `\0${id}` : null;
		},
		load(id) {
			if (!id.startsWith(`\0${PREFIX}`)) return null;
			const locale = id.slice(PREFIX.length + 1);
			const local: EmojibaseEntry[] = require(`emojibase-data/${locale}/compact.json`);
			const english: EmojibaseEntry[] | null = locale === 'en' ? null : require('emojibase-data/en/compact.json');
			const versions: Record<string, string[]> = require('emojibase-data/versions/emoji.json');
			return `export default ${JSON.stringify(buildEmojiData(local, english, versions))};`;
		}
	};
}

export default defineConfig({ plugins: [tailwindcss(), sveltekit(), emojiData()] });
