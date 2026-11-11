import { parseMailDomains, ProviderError, type EmailProvider, type ProviderDomain } from '../email-provider';
import { ConfigError } from '../errors';
import type { OutboundMailInput, OutboundMailResult } from '../outbound/send-mail';
import { sendSmtp, SmtpError, type SmtpConnect, type SmtpSecurity } from './smtp/client';
import { buildMime } from './smtp/mime';
import { connectSmtp } from './smtp/sockets';

/**
 * Any SMTP relay: Postmark, SES, Mailgun, Brevo, an ISP's server, or Postfix
 * on the same machine. Like the Cloudflare provider, the domains come from
 * configuration (`SMTP_MAIL_DOMAINS`) rather than an API, and there are no
 * delivery webhooks, so a message is `sent` once the relay accepts it.
 */
export type SmtpSettings = {
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	/** `tls` (465), `starttls` (587, the default elsewhere) or `none` (a local relay, no password). */
	SMTP_SECURITY?: string;
	SMTP_USER?: string;
	SMTP_PASSWORD?: string;
	SMTP_MAIL_DOMAINS?: string;
};

const SECURITIES: SmtpSecurity[] = ['tls', 'starttls', 'none'];

export function smtpConfigured(settings: SmtpSettings): boolean {
	return Boolean(settings.SMTP_HOST?.trim()) && parseMailDomains(settings.SMTP_MAIL_DOMAINS).length > 0;
}

function readPort(raw: string | undefined): number {
	if (!raw?.trim()) return 587;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new ConfigError(`SMTP_PORT "${raw}" is not a port number.`);
	return port;
}

function readSecurity(raw: string | undefined, port: number): SmtpSecurity {
	const value = raw?.trim().toLowerCase();
	if (!value) return port === 465 ? 'tls' : 'starttls';
	if (!SECURITIES.includes(value as SmtpSecurity)) {
		throw new ConfigError(`SMTP_SECURITY "${raw}" is not one of tls, starttls or none.`);
	}
	return value as SmtpSecurity;
}

function domainOf(address: string): string {
	return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

function smtpDomain(name: string): ProviderDomain {
	return { id: name, name, status: 'verified', region: null, sendingEnabled: true, receivingEnabled: true };
}

function asArray(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

/**
 * Socket errors can arrive without a message: a refused connection to a name
 * with both IPv4 and IPv6 addresses is an `AggregateError` of the attempts.
 */
function describeSocketError(error: unknown): string {
	if (!(error instanceof Error)) return 'Could not reach the SMTP server';
	if (error.message) return error.message;
	const inner = error instanceof AggregateError ? error.errors.find((each) => each instanceof Error && each.message) : null;
	if (inner instanceof Error) return inner.message;
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? `Could not reach the SMTP server (${code})` : 'Could not reach the SMTP server';
}

/** 4xx is worth retrying later, 5xx is the relay saying no. */
function toProviderError(error: unknown): ProviderError {
	if (error instanceof ProviderError) return error;
	if (error instanceof SmtpError) {
		return new ProviderError(error.code >= 500 ? 400 : 502, error.code >= 500 ? 'smtp_rejected' : 'smtp_unavailable', error.message);
	}
	return new ProviderError(502, 'smtp_unavailable', describeSocketError(error));
}

export function createSmtpProvider(settings: SmtpSettings, connect: SmtpConnect = connectSmtp): EmailProvider {
	const host = settings.SMTP_HOST?.trim();
	if (!host) throw new ConfigError('SMTP_HOST is not set.');
	const port = readPort(settings.SMTP_PORT);
	const security = readSecurity(settings.SMTP_SECURITY, port);
	const domains = () => parseMailDomains(settings.SMTP_MAIL_DOMAINS);

	return {
		kind: 'smtp',

		async send(input: OutboundMailInput): Promise<OutboundMailResult> {
			const from = input.from.address;
			const to = asArray(input.to);
			const cc = asArray(input.cc);
			const messageId = `${crypto.randomUUID()}@${domainOf(from)}`;
			const raw = buildMime({
				from: { address: from, name: input.senderName },
				to,
				cc,
				subject: input.subject,
				text: input.text,
				html: input.html,
				headers: input.headers,
				attachments: input.attachments,
				messageId,
				date: new Date()
			});
			try {
				await sendSmtp(
					connect,
					{ host, port, security, user: settings.SMTP_USER?.trim() || undefined, password: settings.SMTP_PASSWORD, clientName: domainOf(from) },
					{ from, to: [...to, ...cc, ...asArray(input.bcc)] },
					raw
				);
			} catch (error) {
				throw toProviderError(error);
			}
			// No provider id over SMTP, so our own Message-ID is the handle.
			return { providerId: messageId };
		},

		async listDomains() {
			return domains().map(smtpDomain);
		},

		async getDomain(id: string) {
			const match = domains().find((name) => name === id.toLowerCase());
			if (!match) throw new ProviderError(404, 'domain_not_configured', `${id} is not in SMTP_MAIL_DOMAINS`);
			return smtpDomain(match);
		}
	};
}
