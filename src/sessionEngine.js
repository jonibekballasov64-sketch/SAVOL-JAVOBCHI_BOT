const { MANDATORY_WAIT, SILENCE_WINDOW } = require('./config');
const { isAnswerCorrect } = require('./quizParser');
const db = require('./db');

// chatId -> sessionState (xotirada)
const activeSessions = new Map();

const MOTIVATION_PHRASES = [
  "Faolroq bo'laylik! 💪",
  "Kim tezroq javob topadi? Harakat qiling! 🔥",
  "Zo'r ketyapmiz, davom etamiz! ✨",
  "Bilim — kuch! Keyingisiga o'tamiz 📚"
];

const START_PHRASES = [
  "Boshladik! Diqqat bilan javob bering 🎯",
  "E'tibor bilan o'qiymiz va javob yozamiz ✍️",
  "Savol-javob boshlandi, omad! 🍀"
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startSession(bot, { chatId, groupId, topicId, questions, sessionId }) {
  if (activeSessions.has(chatId)) {
    await bot.telegram.sendMessage(chatId, "⚠️ Bu guruhda allaqachon faol sessiya bor.");
    return;
  }

  const state = {
    chatId,
    groupId,
    topicId,
    sessionId,
    questions,
    currentIndex: 0,
    lastMessageTime: Date.now(),
    correctAnswerFound: false,
    correctMessage: null,
    stopped: false
  };

  activeSessions.set(chatId, state);

  await bot.telegram.sendMessage(
    chatId,
    `📖 *Savol-javob boshlanmoqda!*\n\n${randomFrom(START_PHRASES)}\n\nJami savollar: ${questions.length}`,
    { parse_mode: 'Markdown' }
  );

  await sleep(2000);
  runQuestionLoop(bot, state);
}

async function runQuestionLoop(bot, state) {
  if (state.stopped) return;

  if (state.currentIndex >= state.questions.length) {
    await finishSession(bot, state);
    return;
  }

  const question = state.questions[state.currentIndex];

  state.lastMessageTime = Date.now();
  state.questionStartTime = Date.now();
  state.correctAnswerFound = false;
  state.correctMessage = null;

  await bot.telegram.sendMessage(
    state.chatId,
    `❓ *${state.currentIndex + 1}-savol:*\n\n${question.question_text}`,
    { parse_mode: 'Markdown' }
  );

  await waitAndResolve(bot, state, question);
}

async function waitAndResolve(bot, state, question) {
  while (!state.stopped) {
    await sleep(1000);

    if (state.stopped) return;

    const elapsedSinceStart = Date.now() - state.questionStartTime;
    const elapsedSinceLastMsg = Date.now() - state.lastMessageTime;

    if (elapsedSinceStart < MANDATORY_WAIT) continue;

    if (state.correctAnswerFound) {
      await announceCorrectAnswer(bot, state, question);
      break;
    }

    if (elapsedSinceLastMsg >= SILENCE_WINDOW) {
      await announceBotAnswer(bot, state, question);
      break;
    }
  }

  if (state.stopped) return;

  state.currentIndex++;
  await sleep(1500);
  runQuestionLoop(bot, state);
}

async function announceCorrectAnswer(bot, state, question) {
  try {
    await bot.telegram.forwardMessage(
      state.chatId,
      state.chatId,
      state.correctMessage.message_id
    );
  } catch (err) {
    console.error('Forward xato:', err.message);
  }

  await bot.telegram.sendMessage(
    state.chatId,
    `✅️ To'g'ri javob:\n\n${question.answer_text}`,
    { parse_mode: 'Markdown' }
  );

  // to'g'ri javob berganni saqlab qo'yamiz
  if (state.correctMessage) {
    try {
      await db.query(
        'INSERT INTO correct_answers (session_id, question_id, user_id) VALUES ($1, $2, $3)',
        [state.sessionId, question.id, state.correctMessage.from.id]
      );
    } catch (err) {
      console.error('correct_answers saqlashda xato:', err.message);
    }
  }
}

async function announceBotAnswer(bot, state, question) {
  await bot.telegram.sendMessage(
    state.chatId,
    `⏱ Vaqt tugadi.\n\n✅️ To'g'ri javob:\n${question.answer_text}\n\n${randomFrom(MOTIVATION_PHRASES)}`,
    { parse_mode: 'Markdown' }
  );
}

async function finishSession(bot, state) {
  activeSessions.delete(state.chatId);

  await db.query(
    "UPDATE sessions SET status = 'finished', finished_at = NOW() WHERE id = $1",
    [state.sessionId]
  );

  const activityResult = await db.query(
    `SELECT full_name, username, message_count
     FROM session_activity
     WHERE session_id = $1
     ORDER BY message_count DESC
     LIMIT 20`,
    [state.sessionId]
  );

  let leaderboard = '';
  activityResult.rows.forEach((row, i) => {
    const name = row.full_name || row.username || 'Foydalanuvchi';
    leaderboard += `${i + 1}. ${name} — ${row.message_count} ta xabar\n`;
  });

  await bot.telegram.sendMessage(
    state.chatId,
    `🎉 *Savol-javob yakunlandi!*\n\nBarchaga faol ishtirok uchun rahmat! 🙌\n\n` +
    `*Eng faol ishtirokchilar:*\n${leaderboard || 'Ma\'lumot topilmadi'}`,
    { parse_mode: 'Markdown' }
  );
}

// Guruhdagi har bir xabarni sessiyaga uzatish uchun chaqiriladi
async function handleGroupMessage(ctx) {
  const chatId = ctx.chat.id;
  const state = activeSessions.get(chatId);
  if (!state) return;

  const msg = ctx.message;
  if (!msg.text) return;

  state.lastMessageTime = Date.now();

  // Faollikni yangilash (upsert)
  const userId = msg.from.id;
  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || null;

  try {
    await db.query(
      `INSERT INTO session_activity (session_id, user_id, username, full_name, message_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (session_id, user_id)
       DO UPDATE SET message_count = session_activity.message_count + 1,
                      username = EXCLUDED.username,
                      full_name = EXCLUDED.full_name`,
      [state.sessionId, userId, username, fullName]
    );
  } catch (err) {
    console.error('Faollik yangilashda xato:', err.message);
  }

  // To'g'ri javobni tekshirish (birinchi topilgan to'g'ri javob qabul qilinadi)
  if (!state.correctAnswerFound) {
    const question = state.questions[state.currentIndex];
    if (question && isAnswerCorrect(msg.text, question.answer_text)) {
      state.correctAnswerFound = true;
      state.correctMessage = msg;
    }
  }
}

function stopSession(chatId) {
  const state = activeSessions.get(chatId);
  if (state) {
    state.stopped = true;
    activeSessions.delete(chatId);
  }
}

function hasActiveSession(chatId) {
  return activeSessions.has(chatId);
}

module.exports = {
  startSession,
  handleGroupMessage,
  stopSession,
  hasActiveSession
};
