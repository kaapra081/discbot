import { createSign } from "node:crypto";

const HEADER_ALIASES = {
  id: ["id", "meeting_id", "event_id"],
  name: ["name", "user", "display_name", "member_name"],
  discordUserId: ["discord_user_id", "discord_id", "user_id", "member_id"],
  title: ["meeting_title", "title", "meeting", "event"],
  meetingStart: ["meeting_start", "start_time", "start", "datetime", "date_time"],
  meetingUrl: ["meeting_url", "meeting_link", "url", "link"],
  channelId: ["channel_id", "discord_channel_id", "channel"],
  timezone: ["timezone", "time_zone", "tz"],
  enabled: ["enabled", "active", "send_reminders"],
  reminderOffsets: ["reminder_offsets_minutes", "reminders", "reminder_offsets"]
};

const normalizeHeader = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_|_$/g, "");

const firstValue = (row, key) => {
  for (const alias of HEADER_ALIASES[key] || []) {
    if (row[alias] !== undefined && String(row[alias]).trim() !== "") return String(row[alias]).trim();
  }
  return "";
};

const isFalse = (value) => ["false", "no", "0", "off", "disabled", "inactive"].includes(
  String(value ?? "").trim().toLowerCase()
);

const parseTime = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`MEETING_TIME_LOCAL must use HH:MM, received "${value}"`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const localDateParts = (value) => {
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) throw new Error(`date "${value}" is not recognized`);
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate()
  };
};

const zonedDateTimeToUtc = ({ year, month, day, hour, minute }, timeZone) => {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map(({ type, value }) => [type, value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
};

const parseDate = (raw, rowNumber) => {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error(`row ${rowNumber}: meeting_start is required`);

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`row ${rowNumber}: meeting_start "${value}" is not a recognized date/time`);
  }
  return new Date(timestamp);
};

const parseRowOffsets = (value, fallback) => {
  if (!value) return fallback;
  const offsets = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0);
  return offsets.length ? [...new Set(offsets)].sort((a, b) => b - a) : fallback;
};

export const parseMeetings = (values, defaultChannelId, defaultOffsets) => {
  if (!Array.isArray(values) || values.length < 2) return { meetings: [], warnings: [] };

  const headers = values[0].map(normalizeHeader);
  const meetings = [];
  const warnings = [];

  values.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const raw = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""]));
    if (Object.values(raw).every((value) => String(value).trim() === "")) return;
    if (isFalse(firstValue(raw, "enabled"))) return;

    try {
      const discordUserId = firstValue(raw, "discordUserId");
      if (!/^\d{17,20}$/.test(discordUserId)) {
        throw new Error(`row ${rowNumber}: discord_user_id must be a Discord user ID (17-20 digits)`);
      }

      const channelId = firstValue(raw, "channelId") || defaultChannelId;
      if (!/^\d{17,20}$/.test(channelId || "")) {
        throw new Error(`row ${rowNumber}: channel_id is required either in the row or DEFAULT_DISCORD_CHANNEL_ID`);
      }

      meetings.push({
        id: firstValue(raw, "id") || `sheet-row-${rowNumber}`,
        sheetRow: rowNumber,
        name: firstValue(raw, "name") || "there",
        discordUserId,
        title: firstValue(raw, "title") || "Upcoming meeting",
        start: parseDate(firstValue(raw, "meetingStart"), rowNumber),
        meetingUrl: firstValue(raw, "meetingUrl"),
        channelId,
        timezone: firstValue(raw, "timezone"),
        offsetsMinutes: parseRowOffsets(firstValue(raw, "reminderOffsets"), defaultOffsets)
      });
    } catch (error) {
      warnings.push(error.message);
    }
  });

  return { meetings, warnings };
};

export const parseRotationMeetings = ({ values, defaultChannelId, defaultOffsets, meetingTimeLocal, meetingTimezone, meetingTitle, userMapJson }) => {
  const meetings = [];
  const warnings = [];
  let userMap;
  try {
    userMap = JSON.parse(userMapJson || "{}");
  } catch {
    return { meetings: [], warnings: ["DISCORD_USER_MAP_JSON must be valid JSON"] };
  }
  const normalizedUserMap = Object.fromEntries(Object.entries(userMap).map(([name, id]) => [name.trim().toLowerCase(), String(id).trim()]));
  const { hour, minute } = parseTime(meetingTimeLocal);

  (values || []).forEach((cells, index) => {
    const rowNumber = index + 1;
    const dateValue = cells?.[0];
    const person = String(cells?.[1] || "").trim();
    if (!dateValue && !person) return;
    try {
      if (!person) throw new Error(`row ${rowNumber}: person is required in column B`);
      const discordUserId = /^\d{17,20}$/.test(person) ? person : normalizedUserMap[person.toLowerCase()];
      if (!/^\d{17,20}$/.test(discordUserId || "")) {
        throw new Error(`row ${rowNumber}: no Discord user ID mapping found for "${person}"`);
      }
      const date = localDateParts(dateValue);
      const start = zonedDateTimeToUtc({ ...date, hour, minute }, meetingTimezone);
      meetings.push({
        id: `rotation-${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}-${person}`,
        sheetRow: rowNumber,
        name: person,
        discordUserId,
        title: meetingTitle,
        start,
        meetingUrl: "",
        channelId: defaultChannelId,
        timezone: meetingTimezone,
        offsetsMinutes: defaultOffsets,
        simpleMessage: `<@${discordUserId}> ${meetingTitle}`
      });
    } catch (error) {
      warnings.push(error.message);
    }
  });
  return { meetings, warnings };
};

const base64Url = (value) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

class GoogleSheetsClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken;
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({
      iss: this.credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    }));
    const unsignedToken = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(unsignedToken).sign(this.credentials.private_key, "base64");
    const assertion = `${unsignedToken}.${base64Url(Buffer.from(signature, "base64"))}`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });
    if (!tokenResponse.ok) throw new Error(`Google auth failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
    const token = await tokenResponse.json();
    this.accessToken = token.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async getValues({ spreadsheetId, range, majorDimension }) {
    const accessToken = await this.getAccessToken();
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    url.searchParams.set("majorDimension", majorDimension);
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Google Sheets read failed (${response.status}): ${await response.text()}`);
    return { data: await response.json() };
  }
}

export const createSheetsClient = (serviceAccountJson) => {
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key");
  }
  return new GoogleSheetsClient(credentials);
};

export const loadMeetingsFromSheet = async ({ sheets, spreadsheetId, tab, mode = "meeting", defaultChannelId, defaultOffsets, meetingTimeLocal, meetingTimezone, meetingTitle, userMapJson }) => {
  const response = await sheets.getValues({
    spreadsheetId,
    range: `${tab}!A:Z`,
    majorDimension: "ROWS"
  });

  const parsed = mode === "rotation"
    ? parseRotationMeetings({
      values: response.data.values || [],
      defaultChannelId,
      defaultOffsets,
      meetingTimeLocal,
      meetingTimezone,
      meetingTitle,
      userMapJson
    })
    : parseMeetings(response.data.values || [], defaultChannelId, defaultOffsets);
  return { ...parsed, fetchedAt: new Date() };
};
