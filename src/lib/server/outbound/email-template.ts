import { APP_NAME } from '$lib/constants';
import type { OutboundAttachmentInput } from '$lib/types';
import { EMAIL_LOGO_PNG } from './email-logo';
import { escapeHtml } from './send-mail';

/**
 * Transactional email layout, built on the app's own palette.
 *
 * Email is not the web: `sendOutboundEmail` wraps this in a bare <html><body>,
 * and mail clients strip <head>, drop external CSS and ignore flexbox. So every
 * rule here is inline and the layout is tables — the only things Outlook and
 * Gmail both honour. Colours match src/routes/layout.css so a notice looks like
 * it came from the same product.
 */

const SAGE = '#90ac9a';
const ON_SAGE = '#14231a';
const INK = '#0a0a0a';
const INK_2 = '#525252';
const MUTED = '#a3a3a3';
const SURFACE = '#ffffff';
const PAGE = '#f4f6f4';
const LINE = '#e6e9e6';
const FONT =
	"-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

const LOGO_CID = 'zimail-logo';

/**
 * The header logo travels with the message as an inline part, so it shows even
 * where remote images are held back until asked, Zimail's own reader included.
 * Every message rendered with `renderEmailHtml` should carry it.
 */
export function emailLogoAttachment(): OutboundAttachmentInput {
	return { filename: 'zimail.png', type: 'image/png', content: EMAIL_LOGO_PNG, disposition: 'inline', contentId: LOGO_CID };
}

export type EmailDetail = { label: string; value: string };

export type EmailAction = { label: string; href: string };

export type EmailContent = {
	title: string;
	lead: string;
	details?: EmailDetail[];
	action?: EmailAction;
	/** A labelled row of small text links under the button, e.g. "Add to calendar: Google · Outlook". */
	links?: { label: string; items: EmailAction[] };
	/** Small print under the divider. Plain text; links are not parsed. */
	footer?: string;
};

function detailRows(details: EmailDetail[]): string {
	return details
		.map(
			({ label, value }) => `
              <tr>
                <td style="padding:0 0 6px 0;font:400 12px/1.5 ${FONT};color:${MUTED};white-space:nowrap;">${escapeHtml(label)}</td>
                <td style="padding:0 0 6px 12px;font:500 13px/1.5 ${FONT};color:${INK};">${escapeHtml(value)}</td>
              </tr>`
		)
		.join('');
}

function linkRow({ label, items }: NonNullable<EmailContent['links']>): string {
	const anchors = items
		.map(({ label: text, href }) => `<a href="${escapeHtml(href)}" style="color:${INK};font-weight:600;text-decoration:underline;">${escapeHtml(text)}</a>`)
		.join(` <span style="color:${MUTED};">·</span> `);
	return `
          <p style="margin:18px 0 0 0;font:400 13px/1.6 ${FONT};color:${INK_2};">${escapeHtml(label)}: ${anchors}</p>`;
}

/**
 * A "bulletproof" button: the colour and radius sit on a <td>, not the <a>,
 * because Outlook ignores padding and border-radius on inline elements.
 */
function actionButton({ label, href }: EmailAction): string {
	return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
            <tr>
              <td align="center" bgcolor="${SAGE}" style="border-radius:10px;">
                <a href="${escapeHtml(href)}"
                   style="display:inline-block;padding:12px 22px;font:600 14px/1 ${FONT};color:${ON_SAGE};text-decoration:none;border-radius:10px;">
                  ${escapeHtml(label)}
                </a>
              </td>
            </tr>
          </table>`;
}

export function renderEmailHtml(content: EmailContent): string {
	const { title, lead, details, action, links, footer } = content;

	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE};margin:0;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:${SURFACE};border:1px solid ${LINE};border-radius:16px;">
        <tr>
          <td style="padding:28px 28px 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:26px;height:26px;"><img src="cid:${LOGO_CID}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0;border-radius:7px;"></td>
                <td style="padding-left:10px;font:700 14px/1 ${FONT};color:${INK};letter-spacing:-0.01em;">${escapeHtml(APP_NAME)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 0 28px;">
            <h1 style="margin:0;font:600 20px/1.3 ${FONT};color:${INK};letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
            <p style="margin:10px 0 0 0;font:400 14px/1.6 ${FONT};color:${INK_2};">${escapeHtml(lead)}</p>
          </td>
        </tr>
        ${
					details?.length
						? `<tr>
          <td style="padding:20px 28px 0 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE};border-radius:10px;">
              <tr>
                <td style="padding:14px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">${detailRows(details)}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
						: ''
				}
        ${
					action
						? `<tr>
          <td style="padding:0 28px;">${actionButton(action)}</td>
        </tr>`
						: ''
				}
        ${
					links?.items.length
						? `<tr>
          <td style="padding:0 28px;">${linkRow(links)}</td>
        </tr>`
						: ''
				}
        <tr>
          <td style="padding:24px 28px 28px 28px;">
            <div style="height:1px;background:${LINE};font-size:0;line-height:0;">&nbsp;</div>
            <p style="margin:16px 0 0 0;font:400 12px/1.6 ${FONT};color:${MUTED};">${escapeHtml(
							footer ??
								'If this was not you, change your password straight away. This message was sent automatically — replies are not read.'
						)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** The plain-text half. Every client gets a readable version. */
export function renderEmailText(content: EmailContent): string {
	const lines = [content.title, '', content.lead];

	if (content.details?.length) {
		lines.push('');
		for (const { label, value } of content.details) {
			lines.push(`${label}: ${value}`);
		}
	}

	if (content.action) {
		lines.push('', content.action.label + ':', content.action.href);
	}

	if (content.links?.items.length) {
		lines.push('', `${content.links.label}:`, ...content.links.items.map(({ label, href }) => `${label}: ${href}`));
	}

	lines.push(
		'',
		content.footer ??
			'If this was not you, change your password straight away. This message was sent automatically — replies are not read.'
	);

	return lines.join('\n');
}
