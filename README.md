# Discord Google Sheet Reminder Bot

This bot reads a weekly rotation from Google Sheets and pings the assigned Discord user before council. For your current setup, it reads the date from column A, the person from column B, uses Wednesday at 12:45 PM Pacific, and sends the short message `<@user-id> council`. By default it sends reminders one day, one hour, and fifteen minutes before the meeting.

## Sheet format

The existing two-column rotation format works in `SHEET_MODE=rotation`:

| Column A | Column B |
| --- | --- |
| August 19, 2026 | Adrian Poon |
| August 26, 2026 | Anish Agarwal |

The bot needs a Discord ID for each name. Put the mapping in `DISCORD_USER_MAP_JSON`, for example `{"Adrian Poon":"123456789012345678"}`. Discord needs numeric user IDs to create a real ping; a display name alone is not reliable.

For a more flexible setup, use `SHEET_MODE=meeting` and a tab named `Meetings` with a header row. Header matching is case-insensitive and accepts the aliases listed below.

| id | name | discord_user_id | meeting_title | meeting_start | meeting_url | channel_id | enabled | reminder_offsets_minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| planning-2026-08-20 | Alex | 123456789012345678 | Planning meeting | 2026-08-20T11:00:00-07:00 | https://meet.google.com/example | 987654321098765432 | TRUE | 1440,60,15 |

Required per active row: `discord_user_id`, `meeting_start`, and either `channel_id` or `DEFAULT_DISCORD_CHANNEL_ID`. Use an ISO-8601 timestamp with an explicit timezone offset, such as `2026-08-20T11:00:00-07:00`, to avoid daylight-saving and locale ambiguity. Set `enabled` to `FALSE` to skip a row.

The bot only reads the Sheet; it does not modify it. It refreshes the active meeting list every five minutes and checks for due reminders every 30 seconds. A 30-minute catch-up window prevents a reminder from being lost during a short restart, while an in-memory sent set prevents duplicate messages during normal operation.

## One-time setup

1. Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Copy the bot token. Invite the bot to the server with the `bot` scope and permission to view and send messages in the reminder channel. This is how the code gets into Discord: the running bot logs in with the token, then calls Discord's `channel.send()` API when a reminder is due.
2. Create a Google Cloud service account, enable the Google Sheets API, and download its JSON credentials. Share the Sheet with the service-account email as a Viewer.
3. Copy `.env.example` to `.env` and fill in the values. `GOOGLE_SERVICE_ACCOUNT_JSON` must be the complete service-account JSON on one line.
4. Install and run:

   ```sh
   npm install
   npm run check
   npm test
   npm start
   ```

The process must remain running for Discord reminders to be delivered. Use a host such as Railway, Render, Fly.io, or a VPS; add the same environment variables there. The included `Dockerfile` can be used by any Docker-compatible host.

## Configuration

- `REMINDER_OFFSETS_MINUTES=1440,60,15` controls the default reminders. `1440` means one day before.
- `SHEET_MODE=rotation` reads the current date/name rotation sheet. Use `SHEET_MODE=meeting` for the header-based format.
- `MEETING_TIME_LOCAL=12:45` and `MEETING_TIMEZONE=America/Los_Angeles` define the weekly meeting time.
- `DISCORD_USER_MAP_JSON` maps Sheet names to Discord numeric user IDs.
- `REMINDER_CATCH_UP_WINDOW_MINUTES=30` controls how late a reminder can still be sent after its due time.
- `DEFAULT_DISCORD_CHANNEL_ID` is used when `channel_id` is blank in a row.
- `DRY_RUN=true` logs reminders without sending them, useful for a first test.

## Security notes

Never commit `.env` or the service-account JSON. If a token is exposed, rotate it in Discord or Google Cloud immediately. The bot uses the read-only Google Sheets scope.

## GitHub Actions

The included workflow runs syntax checks and tests on pushes and pull requests. It does not need your runtime secrets.
