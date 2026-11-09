import { signatureAttribute, signatureTagRule } from '$lib/signature-html';

function cleanAttributes(element: Element) {
	for (const { name, value } of [...element.attributes]) {
		const kept = signatureAttribute(name, value);
		if (kept === null) element.removeAttribute(name);
		else if (kept !== value) element.setAttribute(name, kept);
	}
}

function cleanNode(node: Node) {
	if (node.nodeType === Node.COMMENT_NODE) {
		node.parentNode?.removeChild(node);
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const element = node as Element;
	const rule = signatureTagRule(element.tagName);
	if (rule === 'drop') {
		element.remove();
		return;
	}
	for (const child of [...element.childNodes]) cleanNode(child);
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
	for (const child of [...doc.body.childNodes]) cleanNode(child);
	return doc.body.innerHTML;
}
