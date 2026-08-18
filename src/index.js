import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { createSheetsClient, loadMeetingsFromSheet } from "./sheet.js";
import { ReminderEngine, formatReminderMessage } from "./reminders.js";

const config = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const sheets = createSheetsClient(config.googleServiceAccountJson);

const sendReminder = async ({ meeting, offsetMinutes }) => {
  const content = formatReminderMessage({ meeting, offsetMinutes });
  if (config.dryRun) {
    console.log(`[DRY RUN] ${meeting.channelId}: ${content.replaceAll("\n", " | ")}`);
    return;
  }

  const channel = await client.channels.fetch(meeting.channelId);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new Error(`Discord channel ${meeting.channelId} is not a writable text channel`);
  }
  await channel.send({
    content,
    allowedMentions: { users: [meeting.discordUserId] }
  });
};

const engine = new ReminderEngine({
  sendReminder,
  catchUpWindowMinutes: config.catchUpWindowMinutes
});

let syncInProgress = false;
const syncMeetings = async () => {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    const result = await loadMeetingsFromSheet({
      sheets,
      spreadsheetId: config.googleSheetId,
      tab: config.googleSheetTab,
      mode: config.sheetMode,
      defaultChannelId: config.defaultChannelId,
      defaultOffsets: config.reminderOffsetsMinutes,
      meetingTimeLocal: config.meetingTimeLocal,
      meetingTimezone: config.meetingTimezone,
      meetingTitle: config.meetingTitle,
      userMapJson: config.discordUserMapJson
    });
    engine.replaceMeetings(result.meetings);
    console.log(`Loaded ${result.meetings.length} active meeting(s) from Google Sheets at ${result.fetchedAt.toISOString()}`);
    for (const warning of result.warnings) console.warn(`Sheet warning: ${warning}`);
  } catch (error) {
    console.error(`Google Sheets sync failed: ${error.message}`);
  } finally {
    syncInProgress = false;
  }
};

client.once("ready", async (readyClient) => {
  console.log(`Logged in to Discord as ${readyClient.user.tag}`);
  await syncMeetings();
  await engine.tick();
  setInterval(syncMeetings, config.sheetSyncIntervalMs);
  setInterval(() => engine.tick().catch((error) => console.error(`Reminder tick failed: ${error.message}`)), config.reminderTickIntervalMs);
});

const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down`);
  client.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

client.login(config.discordToken).catch((error) => {
  console.error(`Discord login failed: ${error.message}`);
  process.exitCode = 1;
});
