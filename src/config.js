require('dotenv').config();

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)
  .map(Number);

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_IDS,
  isAdmin,
  MANDATORY_WAIT: 20000, // 20 soniya - majburiy kutish
  SILENCE_WINDOW: 7000,  // 7 soniya - jimlik oynasi
  QUESTION_EMOJI: ['⁉️', '⁉'],
  ANSWER_EMOJI: ['✅️', '✅']
};
