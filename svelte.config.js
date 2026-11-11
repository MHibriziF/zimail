import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';

/** `ZIMAIL_TARGET=node` builds the self-hosted server (`bun run build:node`); anything else is the Worker. */
const target = process.env.ZIMAIL_TARGET === 'node' ? 'node' : 'cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter:
			target === 'node'
				? node({ out: 'build' })
				: cloudflare({
						config: 'wrangler.jsonc',
						platformProxy: {
							configPath: 'wrangler.jsonc',
							persist: { path: '.wrangler/state/v3' }
						}
					}),
		alias: {
			$themes: 'src/themes'
		},
		// Vite's unbundled worker fails in the browser. Production registration
		// lives in registerAppServiceWorker().
		serviceWorker: {
			register: false
		}
	}
};

export default config;
