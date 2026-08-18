import test from "node:test";
import assert from "node:assert/strict";
import { ReminderEngine, formatReminderMessage } from "../src/reminders.js";
import { parseRotationMeetings } from "../src/sheet.js";

const meeting = (overrides = {}) => ({
  id: "meeting-1",
  discordUserId: "123456789012345678",
  title: "Team meeting",
  start: new Date("2026-08-20T18:00:00.000Z"),
  meetingUrl: "https://meet.example.com/team",
  channelId: "987654321098765432",
  offsetsMinutes: [1440, 60],
  ...overrides
});

test("finds a one-day reminder inside the catch-up window", () => {
  const now = new Date("2026-08-19T18:05:00.000Z");
  const engine = new ReminderEngine({ sendReminder: async () => {}, now: () => now, catchUpWindowMinutes: 30 });
  engine.replaceMeetings([meeting()]);
  const due = engine.getDueReminders();
  assert.equal(due.length, 1);
  assert.equal(due[0].meeting.id, "meeting-1");
  assert.equal(due[0].offsetMinutes, 1440);
  assert.equal(due[0].dueAt.toISOString(), "2026-08-19T18:00:00.000Z");
});

test("does not send a reminder twice", async () => {
  const now = new Date("2026-08-19T18:00:00.000Z");
  let sends = 0;
  const engine = new ReminderEngine({ sendReminder: async () => { sends += 1; }, now: () => now });
  engine.replaceMeetings([meeting()]);
  await engine.tick();
  await engine.tick();
  assert.equal(sends, 1);
});

test("formats a mention and Discord relative timestamp", () => {
  const message = formatReminderMessage({ meeting: meeting(), offsetMinutes: 1440 });
  assert.match(message, /<@123456789012345678>/);
  assert.match(message, /Team meeting/);
  assert.match(message, /<t:1787248800:F>/);
  assert.match(message, /https:\/\/meet\.example\.com\/team/);
});

test("parses the existing date/name rotation format at 12:45 Pacific", () => {
  const result = parseRotationMeetings({
    values: [["August 19, 2026", "Adrian Poon"]],
    defaultChannelId: "987654321098765432",
    defaultOffsets: [1440, 60, 15],
    meetingTimeLocal: "12:45",
    meetingTimezone: "America/Los_Angeles",
    meetingTitle: "council",
    userMapJson: JSON.stringify({ "Adrian Poon": "123456789012345678" })
  });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.meetings[0].start.toISOString(), "2026-08-19T19:45:00.000Z");
  assert.equal(formatReminderMessage({ meeting: result.meetings[0], offsetMinutes: 1440 }), "<@123456789012345678> council");
});
