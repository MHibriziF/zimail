<script lang="ts">
	import { t } from '$lib/i18n';
	import type { RoomSettings } from '$lib/meet/room-settings';

	/** How a meeting room admits people and shares screens — for an event's room or every booking's. */
	let {
		room,
		name,
		onchange
	}: {
		room: RoomSettings;
		/** Keeps the radio groups apart when more than one set is on the page. */
		name: string;
		onchange: (patch: Partial<RoomSettings>) => void;
	} = $props();
</script>

<div class="room">
	<label class="room-check">
		<input type="checkbox" checked={room.waitForHost} onchange={(event) => onchange({ waitForHost: event.currentTarget.checked })} />
		<span>
			{t('meetings.waitForHostLabel')}
			<small>{t('meetings.waitForHostHint')}</small>
		</span>
	</label>
	<fieldset class="room-group">
		<legend>{t('meetings.admissionLabel')}</legend>
		<label class="room-radio">
			<input type="radio" name="{name}-admission" checked={!room.requireApproval} onchange={() => onchange({ requireApproval: false })} />
			{t('meetings.admissionOpen')}
		</label>
		<label class="room-radio">
			<input type="radio" name="{name}-admission" checked={room.requireApproval} onchange={() => onchange({ requireApproval: true })} />
			{t('meetings.admissionApproval')}
		</label>
	</fieldset>
	<fieldset class="room-group">
		<legend>{t('meet.screenSharePolicyLabel')}</legend>
		<label class="room-radio">
			<input type="radio" name="{name}-share" checked={room.screenSharePolicy === 'open'} onchange={() => onchange({ screenSharePolicy: 'open' })} />
			{t('meet.screenSharePolicyOpen')}
		</label>
		<label class="room-radio">
			<input type="radio" name="{name}-share" checked={room.screenSharePolicy === 'approval'} onchange={() => onchange({ screenSharePolicy: 'approval' })} />
			{t('meet.screenSharePolicyApproval')}
		</label>
	</fieldset>
	<fieldset class="room-group">
		<legend>{t('meet.screenShareModeLabel')}</legend>
		<label class="room-radio">
			<input type="radio" name="{name}-mode" checked={room.screenShareMode === 'single'} onchange={() => onchange({ screenShareMode: 'single' })} />
			{t('meet.screenShareModeSingle')}
		</label>
		<label class="room-radio">
			<input type="radio" name="{name}-mode" checked={room.screenShareMode === 'multiple'} onchange={() => onchange({ screenShareMode: 'multiple' })} />
			{t('meet.screenShareModeMultiple')}
		</label>
	</fieldset>
</div>

<style>
	/* Indented under the checkbox it belongs to. */
	.room {
		display: grid;
		gap: 0.75rem;
		padding-left: 1.5rem;
	}

	.room-group {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.room-group legend {
		margin-bottom: 0.25rem;
		padding: 0;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.room-radio,
	.room-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.room-check {
		align-items: flex-start;
	}

	.room-check input {
		margin-top: 0.2rem;
	}

	.room-check small {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
</style>
