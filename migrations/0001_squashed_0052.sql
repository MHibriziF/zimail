-- Squashed by `bun run db:squash` from 52 migrations, kept in migrations/archive/.
-- Every statement is IF NOT EXISTS / OR IGNORE, so it is a no-op on a database that already has them.
-- replaces: 0001_init.sql 0002_attachments.sql 0003_reply_thread.sql 0004_attachment_r2.sql 0005_resend_domains.sql 0006_mailbox.sql 0007_threads.sql 0008_email_signature.sql 0009_api_tokens.sql 0010_push_subscriptions.sql 0011_address_signature.sql 0012_domain_scoped_threads.sql 0013_address_identity.sql 0014_two_factor.sql 0015_password_recovery.sql 0016_scheduled_send.sql 0017_mail_cleanup.sql 0018_user_timezone.sql 0019_scheduled_outbox.sql 0020_ui_theme.sql 0021_user_locale.sql 0022_archive.sql 0023_default_theme_zero.sql 0024_sender_display_names.sql 0025_first_login_setup.sql 0026_meetings.sql 0027_call_backgrounds.sql 0028_meeting_codes.sql 0029_meeting_admission.sql 0030_meeting_screen_share.sql 0031_unrouted_provider_id_unique.sql 0032_attachment_content_id.sql 0033_attachment_content_disposition.sql 0034_labels.sql 0035_spam.sql 0036_inbox_tabs.sql 0037_calendar.sql 0038_calendar_feeds.sql 0039_reservations.sql 0040_reservation_meetings.sql 0041_calendar_invites.sql 0042_invitation_answers.sql 0043_event_meetings.sql 0044_calendar_feed_sync_key.sql 0045_booking_location.sql 0046_guest_reschedule.sql 0047_ai_conversations.sql 0048_auto_sweep.sql 0049_ai_inbox_tabs.sql 0050_ai_inbox_tabs_always_on.sql 0051_meeting_captions.sql 0052_calendar_publish.sql

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
, email_signature TEXT NOT NULL DEFAULT '', totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_enabled_at TEXT, recovery_email TEXT, recovery_email_verified_at TEXT, recovery_email_pending TEXT, trash_retention_days INTEGER NOT NULL DEFAULT 60, last_trash_purge_at TEXT, timezone TEXT, ui_theme TEXT NOT NULL DEFAULT 'classic', locale TEXT NOT NULL DEFAULT 'en', must_change_password INTEGER NOT NULL DEFAULT 0, inbox_tabs INTEGER NOT NULL DEFAULT 1, sweep_auto INTEGER NOT NULL DEFAULT 0, sweep_days INTEGER NOT NULL DEFAULT 90, sweep_only_read INTEGER NOT NULL DEFAULT 1, sweep_keep_starred INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
	from_addr TEXT NOT NULL,
	to_addr TEXT NOT NULL,
	subject TEXT NOT NULL,
	body_text TEXT,
	body_html TEXT,
	message_id TEXT,
	in_reply_to TEXT,
	is_read INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
, reply_to_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL, domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL, provider_id TEXT, status TEXT, status_at TEXT, status_detail TEXT, cc_addr TEXT, bcc_addr TEXT, is_starred INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, thread_id TEXT, thread_key TEXT, references_header TEXT, address_id TEXT REFERENCES addresses(id) ON DELETE SET NULL, scheduled_at TEXT, send_attempts INTEGER NOT NULL DEFAULT 0, archived_at TEXT, from_name TEXT, spam_at TIMESTAMP, category TEXT);

CREATE TABLE IF NOT EXISTS email_attachments (
	id TEXT PRIMARY KEY,
	email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
	filename TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	content_base64 TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
, storage_key TEXT, content_id TEXT, content_disposition TEXT);

CREATE TABLE IF NOT EXISTS domains (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE COLLATE NOCASE,
	status TEXT NOT NULL DEFAULT 'pending',
	region TEXT,
	sending_enabled INTEGER NOT NULL DEFAULT 0,
	receiving_enabled INTEGER NOT NULL DEFAULT 0,
	
	
	catchall_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	synced_at TEXT
);

CREATE TABLE IF NOT EXISTS addresses (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
	address TEXT NOT NULL UNIQUE COLLATE NOCASE,
	label TEXT,
	is_default INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
, signature TEXT);

CREATE TABLE IF NOT EXISTS unrouted_emails (
	id TEXT PRIMARY KEY,
	provider_id TEXT,
	from_addr TEXT NOT NULL,
	to_addr TEXT NOT NULL,
	subject TEXT,
	reason TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_events (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_tokens (
	id            TEXT PRIMARY KEY,
	user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name          TEXT NOT NULL,
	token_hash    TEXT NOT NULL,
	token_preview TEXT NOT NULL,
	scopes        TEXT NOT NULL DEFAULT 'mail:read,mail:send',
	created_at    TEXT NOT NULL,
	last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
	id              TEXT PRIMARY KEY,
	user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint        TEXT NOT NULL UNIQUE,
	p256dh           TEXT NOT NULL,
	auth             TEXT NOT NULL,
	expiration_time  INTEGER,
	user_agent       TEXT,
	created_at       TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS totp_backup_codes (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	code_hash TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_tokens (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'recovery_email')),
	token_hash TEXT NOT NULL UNIQUE,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
	title TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
, code TEXT, require_approval INTEGER NOT NULL DEFAULT 0, screen_share_policy TEXT NOT NULL DEFAULT 'open', screen_share_mode TEXT NOT NULL DEFAULT 'multiple', captions_enabled INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS call_backgrounds (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	storage_key TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_admissions (
	id TEXT PRIMARY KEY,
	meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_labels (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	conversation_id TEXT NOT NULL,
	label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, conversation_id, label_id)
);

CREATE TABLE IF NOT EXISTS blocked_senders (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	address TEXT NOT NULL COLLATE NOCASE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, address)
);

CREATE TABLE IF NOT EXISTS sender_categories (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	address TEXT NOT NULL COLLATE NOCASE,
	category TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, address)
);

CREATE TABLE IF NOT EXISTS calendar_events (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	source TEXT NOT NULL DEFAULT 'manual',
	source_id TEXT,
	external_uid TEXT,
	title TEXT NOT NULL,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	all_day INTEGER NOT NULL DEFAULT 0,
	location TEXT,
	notes TEXT,
	busy INTEGER NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
, sequence INTEGER NOT NULL DEFAULT 0, meeting_code TEXT);

CREATE TABLE IF NOT EXISTS calendar_feeds (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT 'blue',
	event_count INTEGER NOT NULL DEFAULT 0,
	last_attempt_at TEXT,
	last_synced_at TEXT,
	last_error TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
, sync_key TEXT);

CREATE TABLE IF NOT EXISTS reservation_pages (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	slug TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT,
	time_zone TEXT NOT NULL,
	
	start_date TEXT NOT NULL,
	end_date TEXT NOT NULL,
	
	weekdays TEXT NOT NULL,
	
	day_start INTEGER NOT NULL,
	day_end INTEGER NOT NULL,
	slot_minutes INTEGER NOT NULL,
	buffer_minutes INTEGER NOT NULL DEFAULT 0,
	notice_minutes INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
, with_meeting INTEGER NOT NULL DEFAULT 0, location TEXT, reschedule_cutoff_hours INTEGER NOT NULL DEFAULT 24);

CREATE TABLE IF NOT EXISTS reservations (
	id TEXT PRIMARY KEY,
	page_id TEXT NOT NULL REFERENCES reservation_pages(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	event_id TEXT NOT NULL,
	guest_name TEXT NOT NULL,
	guest_email TEXT NOT NULL,
	note TEXT,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	created_at TEXT NOT NULL
, meeting_code TEXT, meeting_url TEXT, manage_token_hash TEXT, reschedule_count INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS calendar_invites (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	uid TEXT NOT NULL,
	sequence INTEGER NOT NULL DEFAULT 0,
	response TEXT,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (user_id, uid)
);

CREATE TABLE IF NOT EXISTS event_guests (
	event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	name TEXT,
	status TEXT NOT NULL DEFAULT 'needs-action',
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY (event_id, email)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	turns TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_publish (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	include_feeds INTEGER NOT NULL DEFAULT 0,
	busy_only INTEGER NOT NULL DEFAULT 0,
	ics TEXT,
	built_at TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_user_created ON emails(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_attachments_email ON email_attachments(email_id);

CREATE INDEX IF NOT EXISTS idx_emails_reply_to ON emails(reply_to_email_id);

CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

CREATE INDEX IF NOT EXISTS idx_addresses_domain ON addresses(domain_id);

CREATE INDEX IF NOT EXISTS idx_emails_provider ON emails(provider_id);

CREATE INDEX IF NOT EXISTS idx_emails_domain ON emails(domain_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_starred ON emails(user_id, is_starred);

CREATE INDEX IF NOT EXISTS idx_emails_deleted ON emails(user_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(user_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_emails_thread_key ON emails(user_id, thread_key);

CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(user_id, message_id);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_emails_domain_thread_key
	ON emails(user_id, domain_id, thread_key);

CREATE INDEX IF NOT EXISTS idx_emails_domain_message_id
	ON emails(user_id, domain_id, message_id);

CREATE INDEX IF NOT EXISTS idx_emails_address ON emails(address_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON totp_backup_codes(user_id);

CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, kind);

CREATE INDEX IF NOT EXISTS idx_emails_scheduled ON emails(user_id, scheduled_at)
	WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_due_send ON emails(scheduled_at)
	WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_archived ON emails(user_id, archived_at);

CREATE INDEX IF NOT EXISTS meetings_user_id_idx ON meetings(user_id);

CREATE INDEX IF NOT EXISTS call_backgrounds_user_id_idx ON call_backgrounds(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS meetings_code_idx ON meetings(code) WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS meeting_admissions_meeting_id_idx ON meeting_admissions(meeting_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unrouted_emails_provider_id
  ON unrouted_emails (provider_id)
  WHERE provider_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS labels_user_name_idx ON labels(user_id, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS conversation_labels_label_idx ON conversation_labels(label_id);

CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx ON calendar_events(user_id, starts_at);

CREATE INDEX IF NOT EXISTS calendar_events_source_idx ON calendar_events(user_id, source, source_id);

CREATE INDEX IF NOT EXISTS calendar_feeds_user_idx ON calendar_feeds(user_id);

CREATE INDEX IF NOT EXISTS calendar_feeds_attempt_idx ON calendar_feeds(last_attempt_at);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_pages_slug_idx ON reservation_pages(slug COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS reservation_pages_user_idx ON reservation_pages(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_page_start_idx ON reservations(page_id, starts_at);

CREATE INDEX IF NOT EXISTS reservations_event_idx ON reservations(event_id);

CREATE INDEX IF NOT EXISTS reservations_page_created_idx ON reservations(page_id, created_at);

CREATE INDEX IF NOT EXISTS event_guests_user_idx ON event_guests(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_manage_token_idx ON reservations(manage_token_hash) WHERE manage_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations(user_id, updated_at);

CREATE TRIGGER IF NOT EXISTS calendar_publish_evict_insert AFTER INSERT ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = NEW.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR NEW.source <> 'feed');
END;

CREATE TRIGGER IF NOT EXISTS calendar_publish_evict_update AFTER UPDATE ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = NEW.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR NEW.source <> 'feed');
END;

CREATE TRIGGER IF NOT EXISTS calendar_publish_evict_delete AFTER DELETE ON calendar_events
BEGIN
	UPDATE calendar_publish SET ics = NULL, built_at = NULL
	WHERE user_id = OLD.user_id AND ics IS NOT NULL AND (include_feeds = 1 OR OLD.source <> 'feed');
END;

