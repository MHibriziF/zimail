<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { linkHtml, normalizeLinkUrl } from '$lib/utils/links';

	let {
		html = $bindable(''),
		placeholder = t('compose.writeMessagePlaceholder'),
		minHeight = 240,
		embedded = false,
		fill = false,
		toolbarEnd
	}: {
		html?: string;
		placeholder?: string;
		minHeight?: number;
		embedded?: boolean;
		/** On phones, grow to fill the composer and drop the card chrome. */
		fill?: boolean;
		toolbarEnd?: import('svelte').Snippet;
	} = $props();

	let editor = $state<HTMLDivElement | null>(null);

	/**
	 * Seed the editable div from `html`.
	 *
	 * A contenteditable is not a controlled input: the binding only ever ran
	 * editor -> html, so anything set from outside (opening a draft, quoting a
	 * message) was dropped on the floor.
	 *
	 * The guard matters as much as the write. Assigning innerHTML on every change
	 * would also fire for the user's own keystrokes and drop the caret back to the
	 * start of the message. After `handleInput`, `html` already equals innerHTML,
	 * so comparing them skips exactly those updates and writes only genuinely
	 * external ones.
	 */
	$effect(() => {
		const incoming = html;
		if (editor && incoming !== editor.innerHTML) {
			editor.innerHTML = incoming;
		}
	});

	function exec(command: string, value?: string) {
		editor?.focus();
		document.execCommand(command, false, value);
		html = editor?.innerHTML ?? '';
	}

	function handleInput() {
		html = editor?.innerHTML ?? '';
	}

	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
		html = editor?.innerHTML ?? '';
	}

	const tools = [
		{ icon: 'bold', command: 'bold', label: 'Bold' },
		{ icon: 'italic', command: 'italic', label: 'Italic' },
		{ icon: 'underline', command: 'underline', label: 'Underline' },
		{ icon: 'list-unordered', command: 'insertUnorderedList', label: 'List' },
		{ icon: 'link', command: 'createLink', label: 'Link' }
	] as const;

	function handleTool(tool: (typeof tools)[number]) {
		if (tool.command === 'createLink') openLink(null);
		else exec(tool.command);
	}

	// The link popover: Text and Link fields beside the selection, or beside a link clicked to edit.
	let linkPopover = $state<HTMLDivElement | null>(null);
	let linkText = $state('');
	let linkUrl = $state('');
	let linkError = $state('');
	let linkEditing = $state(false);
	let savedRange: Range | null = null;
	let editingAnchor: HTMLAnchorElement | null = null;

	function selectionInEditor(): Range | null {
		const selection = window.getSelection();
		if (!editor || !selection || selection.rangeCount === 0) return null;
		const range = selection.getRangeAt(0);
		return editor.contains(range.commonAncestorContainer) ? range : null;
	}

	function anchorAround(node: Node | null | undefined): HTMLAnchorElement | null {
		const element = node instanceof Element ? node : node?.parentElement;
		const anchor = element?.closest('a');
		return anchor && editor?.contains(anchor) ? anchor : null;
	}

	/** Where the popover opens: under the link or selection, else under the top of the editor. */
	function anchorRect(range: Range | null): DOMRect | undefined {
		if (editingAnchor) return editingAnchor.getBoundingClientRect();
		const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
		return rect && (rect.width || rect.height) ? rect : editor?.getBoundingClientRect();
	}

	function openLink(anchor: HTMLAnchorElement | null) {
		const range = selectionInEditor();
		editingAnchor = anchor ?? anchorAround(range?.commonAncestorContainer);
		savedRange = range?.cloneRange() ?? null;
		linkEditing = editingAnchor !== null;
		linkText = editingAnchor ? (editingAnchor.textContent ?? '') : (range?.toString() ?? '');
		linkUrl = editingAnchor?.getAttribute('href') ?? '';
		linkError = '';
		if (!linkPopover) return;
		const rect = anchorRect(range);
		const width = Math.min(320, window.innerWidth - 16);
		const left = Math.max(8, Math.min((rect?.left ?? 8), window.innerWidth - width - 8));
		linkPopover.style.left = `${left}px`;
		linkPopover.style.top = `${(rect?.bottom ?? 8) + 6}px`;
		linkPopover.style.width = `${width}px`;
		linkPopover.showPopover();
		const field = linkPopover.querySelector<HTMLInputElement>(linkText ? 'input[name="url"]' : 'input[name="text"]');
		field?.focus();
	}

	function closeLink() {
		if (linkPopover?.matches(':popover-open')) linkPopover.hidePopover();
	}

	/** Back into the editor, with the cursor where the link work started. */
	function restoreSelection() {
		editor?.focus();
		const selection = window.getSelection();
		if (!selection || !savedRange) return;
		selection.removeAllRanges();
		selection.addRange(savedRange);
	}

	/** Enter applies and Escape closes, without either reaching the composer around the editor. */
	function onLinkKey(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Enter') applyLink();
		else {
			closeLink();
			restoreSelection();
		}
	}

	function applyLink() {
		const url = normalizeLinkUrl(linkUrl);
		if (!url) {
			linkError = t('compose.linkInvalid');
			return;
		}
		const text = linkText.trim();
		if (editingAnchor) {
			editingAnchor.setAttribute('href', url);
			if (text && text !== editingAnchor.textContent) editingAnchor.textContent = text;
			editor?.focus();
		} else {
			restoreSelection();
			const keepsSelection = savedRange && !savedRange.collapsed && text === savedRange.toString();
			if (keepsSelection) document.execCommand('createLink', false, url);
			else document.execCommand('insertHTML', false, linkHtml(url, text));
		}
		html = editor?.innerHTML ?? '';
		closeLink();
	}

	function removeLink() {
		if (!editingAnchor) return;
		editingAnchor.replaceWith(...editingAnchor.childNodes);
		html = editor?.innerHTML ?? '';
		closeLink();
		editor?.focus();
	}

	function handleEditorClick(event: MouseEvent) {
		const anchor = anchorAround(event.target as Node);
		if (!anchor) return;
		event.preventDefault();
		openLink(anchor);
	}

	function handleEditorKey(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			openLink(null);
		}
	}
</script>

<div class="editor-shell" class:editor-shell-embedded={embedded} class:editor-shell-fill={fill}>
	<div class="toolbar">
		{#each tools as tool (tool.command)}
			<button
				type="button"
				class="icon-btn"
				title={tool.label}
				aria-label={tool.label}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => handleTool(tool)}
			>
				<Icon name={tool.icon} size={16} />
			</button>
		{/each}
		{#if toolbarEnd}
			<div class="toolbar-end">
				{@render toolbarEnd()}
			</div>
		{/if}
	</div>

	<div
		bind:this={editor}
		contenteditable="true"
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		class="editor prose prose-sm max-w-none px-4 py-3 outline-none"
		style:--editor-min-height="{minHeight}px"
		data-placeholder={placeholder}
		oninput={handleInput}
		onpaste={handlePaste}
		onclick={handleEditorClick}
		onkeydown={handleEditorKey}
	></div>

	<!-- Not a <form>: the composer around the editor already is one, and forms cannot nest. -->
	<div
		bind:this={linkPopover}
		class="link-popover"
		popover="auto"
		role="dialog"
		aria-label={t('compose.linkTitle')}
		tabindex="-1"
		onkeydown={onLinkKey}
	>
		<label class="link-field">
			<span>{t('compose.linkText')}</span>
			<input name="text" type="text" bind:value={linkText} autocomplete="off" />
		</label>
		<label class="link-field">
			<span>{t('compose.linkUrl')}</span>
			<input
				name="url"
				type="text"
				inputmode="url"
				bind:value={linkUrl}
				placeholder="https://"
				autocomplete="off"
				oninput={() => (linkError = '')}
			/>
		</label>
		{#if linkError}<p class="link-error" role="alert">{linkError}</p>{/if}
		<div class="link-actions">
			{#if linkEditing}
				<button type="button" class="link-btn link-remove" onclick={removeLink}>{t('compose.linkRemove')}</button>
			{/if}
			<button type="button" class="link-btn link-apply" onclick={applyLink}>{t('compose.linkApply')}</button>
		</div>
	</div>
</div>

<style>
	.editor-shell {
		overflow: hidden;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
	}

	.editor-shell-embedded {
		border-radius: 0;
		box-shadow: none;
		background: transparent;
	}

	.editor-shell-embedded .toolbar {
		padding-left: 0;
		padding-right: 0;
	}

	.editor-shell-embedded .editor {
		padding-left: 0;
		padding-right: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 0.5rem;
	}

	.toolbar-end {
		display: none;
	}

	.editor {
		min-height: var(--editor-min-height, 240px);
		color: var(--color-text);
	}

	@media (max-width: 900px) {
		.toolbar .icon-btn {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.editor {
			font-size: 16px;
		}

		.editor-shell-fill {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 0;
			border-radius: 0;
			box-shadow: none;
			background: transparent;
		}

		.editor-shell-fill .toolbar {
			order: 2;
			flex-shrink: 0;
			padding: 0.125rem 0.375rem calc(0.125rem + env(safe-area-inset-bottom));
			box-shadow: inset 0 1px 0 var(--color-line);
		}

		.editor-shell-fill .toolbar-end {
			display: flex;
			align-items: center;
			gap: 0.125rem;
			margin-left: auto;
		}

		.editor-shell-fill .editor {
			flex: 1;
			min-height: 8rem;
			overflow-y: auto;
			padding: 0.75rem 1rem 1rem;
		}
	}

	.editor:empty::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		pointer-events: none;
	}

	.editor :global(p) {
		margin: 0 0 0.75em;
	}

	.editor :global(p:last-child) {
		margin-bottom: 0;
	}

	/* Tailwind's reset drops list markers, so a bulleted list typed here would
	   otherwise look like plain paragraphs. */
	.editor :global(ul) {
		list-style: disc outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(ol) {
		list-style: decimal outside;
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.editor :global(li) {
		margin: 0.15em 0;
	}

	.editor :global(a) {
		color: var(--color-accent-text);
		text-decoration: underline;
		cursor: pointer;
	}

	/* Opened with showPopover, so it sits in the top layer and the shell's overflow can't clip it. */
	.link-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0.75rem;
		border: none;
		border-radius: 0.75rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-line), 0 12px 32px rgba(0, 0, 0, 0.18);
	}

	.link-popover:popover-open {
		display: grid;
		gap: 0.5rem;
	}

	.link-field {
		display: grid;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.link-field input {
		height: 2.125rem;
		padding: 0 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.link-field input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line, var(--color-accent));
	}

	.link-error {
		font-size: 0.75rem;
		color: var(--color-danger);
	}

	.link-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.link-btn {
		height: 2rem;
		padding: 0 0.875rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.link-remove {
		color: var(--color-danger);
	}

	.link-remove:hover {
		background: var(--color-surface-muted);
	}

	.link-apply {
		color: var(--color-on-accent, #fff);
		background: var(--color-accent);
	}
</style>
