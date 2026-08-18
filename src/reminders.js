export class ReminderEngine {
  constructor({ sendReminder, catchUpWindowMinutes = 30, now = () => new Date(), logger = console }) {
    this.sendReminder = sendReminder;
    this.catchUpWindowMs = catchUpWindowMinutes * 60 * 1000;
    this.now = now;
    this.logger = logger;
    this.meetings = [];
    this.sent = new Set();
  }

  replaceMeetings(meetings) {
    this.meetings = meetings;
  }

  getDueReminders(at = this.now()) {
    const nowMs = at.getTime();
    const due = [];

    for (const meeting of this.meetings) {
      const startMs = meeting.start.getTime();
      if (!Number.isFinite(startMs) || startMs <= nowMs) continue;

      for (const offsetMinutes of meeting.offsetsMinutes) {
        const dueAtMs = startMs - offsetMinutes * 60 * 1000;
        const key = `${meeting.id}:${startMs}:${offsetMinutes}`;
        if (this.sent.has(key)) continue;
        if (nowMs >= dueAtMs && nowMs <= dueAtMs + this.catchUpWindowMs) {
          due.push({ meeting, offsetMinutes, dueAt: new Date(dueAtMs), key });
        }
      }
    }
    return due;
  }

  async tick(at = this.now()) {
    const due = this.getDueReminders(at);
    for (const reminder of due) {
      try {
        await this.sendReminder(reminder);
        this.sent.add(reminder.key);
        this.logger.info?.(`Sent ${reminder.offsetMinutes}-minute reminder for ${reminder.meeting.id}`);
      } catch (error) {
        this.logger.error?.(`Failed ${reminder.offsetMinutes}-minute reminder for ${reminder.meeting.id}: ${error.message}`);
      }
    }
    return due.length;
  }
}

export const formatReminderMessage = ({ meeting, offsetMinutes }) => {
  if (meeting.simpleMessage) return meeting.simpleMessage;
  const unixSeconds = Math.floor(meeting.start.getTime() / 1000);
  const offsetLabel = offsetMinutes >= 1440
    ? `${Math.round(offsetMinutes / 1440)} day${offsetMinutes === 1440 ? "" : "s"}`
    : `${offsetMinutes} minute${offsetMinutes === 1 ? "" : "s"}`;
  const lines = [
    `<@${meeting.discordUserId}> ⏰ Reminder: **${meeting.title}** starts in about ${offsetLabel}.`,
    `When: <t:${unixSeconds}:F> (<t:${unixSeconds}:R>)`
  ];
  if (meeting.meetingUrl) lines.push(`Join: ${meeting.meetingUrl}`);
  return lines.join("\n");
};
