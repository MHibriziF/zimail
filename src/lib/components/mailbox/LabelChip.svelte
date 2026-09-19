<script lang="ts">
	import { LABEL_SWATCH, type Label } from '$lib/mail/labels';

	let { label, href }: { label: Label; href?: string } = $props();
</script>

{#if href}
	<a class="label-chip" {href} style="--label-color: {LABEL_SWATCH[label.color]}" title={label.name}>{label.name}</a>
{:else}
	<span class="label-chip" style="--label-color: {LABEL_SWATCH[label.color]}" title={label.name}>{label.name}</span>
{/if}

<style>
	.label-chip {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		max-width: 10rem;
		padding: 0.0625rem 0.4375rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
		color: color-mix(in srgb, var(--label-color) 78%, var(--color-text));
		background: color-mix(in srgb, var(--label-color) 16%, transparent);
	}

	a.label-chip:hover {
		background: color-mix(in srgb, var(--label-color) 26%, transparent);
	}
</style>
