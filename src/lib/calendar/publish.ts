export type PublishOptions = { includeFeeds: boolean; busyOnly: boolean };

/** Whether the user's calendar is published as a feed, and how (#170). */
export type PublishStatus = { published: false } | ({ published: true } & PublishOptions);
