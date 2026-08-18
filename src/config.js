const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const integer = (name, fallback, { min = Number.MIN_SAFE_INTEGER } = {}) => {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return value;
};

export const parseOffsets = (raw) => {
  const values = String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    throw new Error("REMINDER_OFFSETS_MINUTES must contain at least one positive number");
  }

  return [...new Set(values)].sort((a, b) => b - a);
};

export const loadConfig = () => ({
  discordToken: required("DISCORD_TOKEN"),
  googleServiceAccountJson: required("GOOGLE_SERVICE_ACCOUNT_JSON"),
  googleSheetId: required("GOOGLE_SHEET_ID"),
  googleSheetTab: process.env.GOOGLE_SHEET_TAB?.trim() || "Meetings",
  sheetMode: process.env.SHEET_MODE?.trim().toLowerCase() || "rotation",
  meetingTimeLocal: process.env.MEETING_TIME_LOCAL?.trim() || "12:45",
  meetingTimezone: process.env.MEETING_TIMEZONE?.trim() || "America/Los_Angeles",
  meetingTitle: process.env.MEETING_TITLE?.trim() || "council",
  discordUserMapJson: process.env.DISCORD_USER_MAP_JSON?.trim() || "{}",
  defaultChannelId: process.env.DEFAULT_DISCORD_CHANNEL_ID?.trim() || null,
  reminderOffsetsMinutes: parseOffsets(process.env.REMINDER_OFFSETS_MINUTES || "1440,60,15"),
  catchUpWindowMinutes: integer("REMINDER_CATCH_UP_WINDOW_MINUTES", 30, { min: 0 }),
  sheetSyncIntervalMs: integer("SHEET_SYNC_INTERVAL_MS", 300_000, { min: 10_000 }),
  reminderTickIntervalMs: integer("REMINDER_TICK_INTERVAL_MS", 30_000, { min: 5_000 }),
  appTimezone: process.env.APP_TIMEZONE?.trim() || "America/Los_Angeles",
  dryRun: String(process.env.DRY_RUN || "false").toLowerCase() === "true"
});
