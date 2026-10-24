import assert from "node:assert/strict";
import { it } from "node:test";
import { getBackupSettings } from "../engine";

it("backup defaults match local+cloud and 12-hour schedule", () => {
  const settings = getBackupSettings();

  assert.equal(settings.destination, "both");
  assert.equal(settings.frequency, "twice_daily");
  assert.equal(settings.reminder_frequency, "twice_daily");
  assert.equal(settings.retention_count, 15);
});
