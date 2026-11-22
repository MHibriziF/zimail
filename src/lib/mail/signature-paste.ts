import { looksLikeHtml } from '$lib/email-signature';
import { signatureAttribute, signatureTagRule } from '$lib/signature-html';

/** Tags that only hold text: what an editor wraps a plain-text paste in, or a code editor's highlighting. */
const TEXT_ONLY_TAGS = new Set(['BR', 'DIV', 'P', 'SPAN', 'FONT', 'PRE', 'CODE']);

function cleanAttributes(element: Element) {
	// A copy, because removing from the live list while walking it would skip the next attribute.
	const attributes = Array.from(element.attributes);
	for (const { name, value } of attributes) {
		const kept = signatureAttribute(name, value);
		if (kept === null) element.removeAttribute(name);
		else if (kept !== value) element.setAttribute(name, kept);
	}
}

/** Cleans each child, taking the next sibling first since cleaning may remove or unwrap the current one. */
function cleanChildren(parent: Node) {
	let child = parent.firstChild;
	while (child) {
		const next = child.nextSibling;
		cleanNode(child);
		child = next;
	}
}

function cleanNode(node: ChildNode) {
	if (node.nodeType === Node.COMMENT_NODE) {
		node.remove();
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const element = node as Element;
	const rule = signatureTagRule(element.tagName);
	if (rule === 'drop') {
		element.remove();
		return;
	}
	cleanChildren(element);
	if (rule === 'unwrap') {
		element.replaceWith(...element.childNodes);
		return;
	}
	cleanAttributes(element);
	const tag = element.tagName.toLowerCase();
	if (tag === 'img' && !element.hasAttribute('src')) element.remove();
	else if (tag === 'a' && !element.hasAttribute('href')) element.replaceWith(...element.childNodes);
	else if (tag === 'a' && element.hasAttribute('target')) element.setAttribute('rel', 'noopener');
}

/**
 * Pasted HTML, such as a signature copied from Gmail or Outlook, cut down to what a signature keeps.
 * DOMParser builds an inert document, so nothing in the paste runs or loads while it is cleaned.
 * The server cleans it again on save; this keeps it harmless while it sits in the editor.
 */
export function cleanPastedHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	cleanChildren(doc.body);
	return doc.body.innerHTML;
}

/**
 * The markup of a signature whose HTML went in as text, or null when it is a real signature.
 * That happens when HTML source is pasted into the visual editor, and to HTML that was saved as a
 * plain-text signature before signatures became HTML (migration 0059 escaped those).
 */
export function signatureMarkupWrittenAsText(html: string): string | null {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const elements = Array.from(doc.body.querySelectorAll('*'));
	if (!elements.every((element) => TEXT_ONLY_TAGS.has(element.tagName))) return null;
	for (const br of doc.body.querySelectorAll('br')) br.replaceWith('\n');
	const text = (doc.body.textContent ?? '').trim();
	return looksLikeHtml(text) ? text : null;
}