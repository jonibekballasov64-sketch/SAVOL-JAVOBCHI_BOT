const { MANDATORY_WAIT, SILENCE_WINDOW } = require('./config');
const { isAnswerCorrect } = require('./quizParser');
const db = require('./db');

const activeSessions = new Map();

const MOTIVATION_PHRASES = [
  "Faolroq bo'laylik!",
  "Kim tezroq javob topadi? Harakat qiling!",
  "Zo'r ketyapmiz, davom etamiz!",
  "Bilim - kuch! Keyingisiga o'tamiz"
];

const START_PHRASES = [
  "Boshladik! Diqqat bilan javob bering",
  "E'tibor bilan o'qiymiz va javob yozamiz",
  "Savol-javob boshlandi, omad!"
];

const QUESTION_SEPARATOR = '⁉️'.repeat(11);

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendHtml(bot, chatId, text) {
  await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function startSession(bot, { chatId, groupId, topicId, questions, sessionId }) {
  if (activeSessions.has(chatId)) {
    await bot.telegram.sendMessage(chatId, "Bu guruhda allaqachon faol sessiya bor.");
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
    correctUsers: [],
    correctUserIds: new Set(),
    stopped: false
  };

  activeSessions.set(chatId, state);

  await sendHtml(
    bot,
    chatId,
    `<b>Savol-javob boshlanmoqda!</b>\n\n${randomFrom(START_PHRASES)}\n\nJami savollar: ${questions.length}`
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
  state.correctUsers = [];
  state.correctUserIds = new Set();

  const text = `${QUESTION_SEPARATOR}\n<b>${state.currentIndex + 1}-savol:</b>\n\n${escapeHtml(question.question_text)}`;
  await sendHtml(bot, state.chatId, text);

  await waitAndResolve(bot, state, question);
}

async function waitAndResolve(bot, state, question) {
  while (!state.stopped) {
    await sleep(1000);

    if (state.stopped) return;

    const elapsedSinceStart = Date.now() - state.questionStartTime;
    const elapsedSinceLastMsg = Date.now() - state.lastMessageTime;

    if (elapsedSinceStart < MANDATORY_WAIT) continue;

    if (elapsedSinceLastMsg >= SILENCE_WINDOW) {
      await announceResults(bot, state, question);
      break;
    }
  }

  if (state.stopped) return;

  state.currentIndex++;
  await sleep(1500);
  runQuestionLoop(bot, state);
}

async function announceResults(bot, state, question) {
  if (state.correctUsers.length > 0) {
    const list = state.correctUsers
      .map((u, i) => `${i + 1}. <b>${escapeHtml(u.name)}</b>`)
      .join('\n');

    const text = `🏆🏆🏆🏆🏆🏆🏆🏆\n<b>To'g'ri javob berganlar:</b>\n\n${list}\n\n✅️ <b>To'g'ri javob:</b> ${escapeHtml(question.answer_text)}\n\n${randomFrom(MOTIVATION_PHRASES)}`;
    await sendHtml(bot, state.chatId, text);

    for (const u of state.correctUsers) {
      try {
        await db.query(
          'INSERT INTO correct_answers (session_id, question_id, user_id) VALUES ($1, $2, $3)',
          [state.sessionId, question.id, u.id]
        );
      } catch (err) {
        console.error('correct_answers saqlashda xato:', err.message);
      }
    }
  } else {
    const text = `⏱ Vaqt tugadi.\n\n✅️ <b>To'g'ri javob:</b> ${escapeHtml(question.answer_text)}\n\n${randomFrom(MOTIVATION_PHRASES)}`;
    await sendHtml(bot, state.chatId, text);
  }
}

async function finishSession(bot, state) {
  activeSessions.delete(state.chatId);

  await db.query(
    "UPDATE sessions SET status = 'finished', finished_at = NOW() WHERE id = $1",
    [state.sessionId]
  );

  // 1) Barcha savol-javoblarni ⁉️ ✅️ formatda qayta post qilish
  let recap = `📋 <b>Barcha savol-javoblar (${state.questions.length} ta):</b>\n\n`;
  state.questions.forEach((q) => {
    recap += `⁉️ ${escapeHtml(q.question_text)}\n✅️ <b>${escapeHtml(q.answer_text)}</b>\n\n`;
  });

  const chunks = splitMessage(recap, 3800);
  for (const chunk of chunks) {
    await sendHtml(bot, state.chatId, chunk);
    await sleep(500);
  }

  // 2) Faollik statistikasi
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
    leaderboard += `${i + 1}. <b>${escapeHtml(name)}</b> - ${row.message_count} ta xabar\n`;
  });

  await sendHtml(
    bot,
    state.chatId,
    `<b>Eng faol ishtirokchilar:</b>\n${leaderboard || "Ma'lumot topilmadi"}`
  );

  // 3) Yakuniy motivatsion xabar
  await sleep(1000);
  await sendHtml(
    bot,
    state.chatId,
    `<b>Savol-javob yakunlandi!</b> Barchaga faol ishtirok uchun rahmat 🙌\n\nKeyingi darsga yanada kuchli tayyorlaning! 💪📚`
  );
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let current = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if ((current + line + '\n').length > maxLen) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current);

  return chunks;
}

async function handleGroupMessage(ctx) {
  const chatId = ctx.chat.id;
  const state = activeSessions.get(chatId);
  if (!state) return;

  const msg = ctx.message;
  if (!msg.text) return;

  state.lastMessageTime = Date.now();

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

  const question = state.questions[state.currentIndex];
  if (question && isAnswerCorrect(msg.text, question.answer_text)) {
    if (!state.correctUserIds.has(userId)) {
      state.correctUserIds.add(userId);
      state.correctUsers.push({ id: userId, name: fullName || username || 'Foydalanuvchi' });
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
