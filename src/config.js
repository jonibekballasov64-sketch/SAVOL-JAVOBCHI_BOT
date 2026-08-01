require('dotenv').config();

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)
  .map(Number);

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

// Vaqtlar endi o'zgaruvchan - admin /vaqt buyrug'i bilan o'zgartira oladi
const timing = {
  mandatoryWaitSeconds: 20, // majburiy kutish (soniya)
  silenceWindowSeconds: 7   // oxirgi xabardan keyingi jimlik oynasi (soniya)
};

function getMandatoryWait() {
  return timing.mandatoryWaitSeconds * 1000;
}

function getSilenceWindow() {
  return timing.silenceWindowSeconds * 1000;
}

function setTiming(mandatorySeconds, silenceSeconds) {
  if (mandatorySeconds !== null && mandatorySeconds !== undefined) {
    timing.mandatoryWaitSeconds = mandatorySeconds;
  }
  if (silenceSeconds !== null && silenceSeconds !== undefined) {
    timing.silenceWindowSeconds = silenceSeconds;
  }
}

function getTimingSeconds() {
  return {
    mandatory: timing.mandatoryWaitSeconds,
    silence: timing.silenceWindowSeconds
  };
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_IDS,
  isAdmin,
  getMandatoryWait,
  getSilenceWindow,
  setTiming,
  getTimingSeconds,
  QUESTION_EMOJI: ['⁉️', '⁉'],
  ANSWER_EMOJI: ['✅️', '✅']
};
