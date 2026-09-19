<script lang="ts">
	import MailboxSlot from '$lib/components/mailbox/MailboxSlot.svelte';
	import { APP_NAME } from '$lib/constants';
	import { t } from '$lib/i18n';
	import type { Label } from '$lib/mail/labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const label = $derived(((data.labels ?? []) as Label[]).find((entry) => entry.id === data.filters.labelId));
</script>

<svelte:head>
	<title>{t('mailbox.pageTitle', { folder: label?.name ?? t('nav.allMail'), app: APP_NAME })}</title>
</svelte:head>

<MailboxSlot view={data.view} mailbox={data.mailbox} filters={data.filters} />
