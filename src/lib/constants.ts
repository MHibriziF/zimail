export const APP_NAME = 'Zimail';
/** This fork's GitHub repository; the CLI and MCP installer are served from it. */
export const GITHUB_REPO = 'MHibriziF/zimail';
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh`;
/**
 * Mail domains are discovered from the configured provider during onboarding
 * and stored in the `domains` table.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EMAIL = 5;
/** Providers cap a single message (including attachments) well above this. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Rows per page in the mailbox list. */
export const MAILBOX_PAGE_SIZE = 25;
/** Longest display name on a login identity. */
export const MAX_USER_NAME_LENGTH = 80;
/** Shortest password `setUserPassword` will accept. */
export const MIN_PASSWORD_LENGTH = 8;
/**
 * Scheduled send is run by our own cron, not held by the provider, so there is
 * no delivery horizon to respect. This is only a typo guard — a mistyped year
 * would otherwise leave a message sitting in the outbox for good.
 */
export const MAX_SCHEDULE_YEARS = 5;
/** Same cap as an email attachment — these are just background photos. */
export const MAX_CALL_BACKGROUND_BYTES = 5 * 1024 * 1024;
/** Oldest upload is dropped once a user's gallery hits this size. */
export const MAX_CALL_BACKGROUNDS_PER_USER = 6;
