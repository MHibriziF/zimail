<script lang="ts">
	import { navigating } from '$app/state';

	// A navigation that finishes this fast doesn't need a bar, and flashing one would read as jank.
	const SHOW_AFTER_MS = 120;

	let visible = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const timer = setTimeout(() => (visible = true), SHOW_AFTER_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div class="nav-progress" aria-hidden="true"></div>
{/if}

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 1000;
		width: 100%;
		height: 2px;
		background: var(--color-accent);
		transform-origin: left;
		animation: nav-progress 8s cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
		pointer-events: none;
	}

	@keyframes nav-progress {
		from {
			transform: scaleX(0.08);
		}
		to {
			transform: scaleX(0.92);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-progress {
			animation: none;
			transform: scaleX(0.5);
		}
	}
</style>
