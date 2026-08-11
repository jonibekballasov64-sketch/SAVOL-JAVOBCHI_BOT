const { getMandatoryWait, getSilenceWindow } = require('./config');
const { isAnswerCorrect } = require('./quizParser');
const db = require('./db');

const activeSessions = new Map();

// To'g'ri javob berilganda chiqadigan xabarlar - ko'tarinki, har xil
const CORRECT_REACTIONS = [
  "🎉 Zo'r! Barakalla! qolganlar ham harakat qiling💥",
  "🔥 Ajoyib javob! MUtlaq to'g'ri",
  "👏 Mukammal! Davom etamiz!",
  "⭐ Zo'r natija! Yana oldinga!",
  "💥 Bomba javob! Tabriklaymiz!",
  "🚀 Zo'r sur'at! Shu ruhda davom etamiz!",
  "🏅 Ajoyib bilim! Keyingisiga tayyor bo'ling!",
  "🌟 Zo'r! Siz haqiqiy bilimdonsiz!",
  "👍 Zo'r ketyapmiz, davom etamiz!",
  "🔥 Zo'r! Yana shunday davom eting!"
];

// Vaqt tugaganda / xato javob bo'lganda chiqadigan xabarlar - harakatga chorlovchi
const TIMEOUT_REACTIONS = [
  "⏳ Vaqt tugadi, lekin harakat davom etsin!",
  "💪 Hechqisi yo'q, keyingisida albatta topamiz!",
  "🔥 Faolroq bo'laylik, harakat qiling!",
  "🤔 Diqqat bilan o'ylab ko'raylik, davom etamiz!",
  "📚 Bilimni mustahkamlaymiz, keyingi savolga o'tamiz!",
  "🙌 Kurashni davom ettiramiz!",
  "💡 Keyingi safar albatta topamiz!",
  "😉 Kim tezroq javob topadi? Harakat qiling!",
  "⚡ Diqqatni jamlaymiz, davom etamiz!",
  "🎯 Nishonga aniqroq olamiz, keyingisiga!"
];

const START_PHRASES = [
  "💥Boshladik! Diqqat bilan javob bering",
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
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Xabar yuborishda xatolik, qayta urinilmoqda:', err.message);
    try {
      await sleep(1000);
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err2) {
      console.error('Qayta urinishda ham xatolik:', err2.message);
    }
  }
}

async function safeDbQuery(text, params) {
  try {
    return await db.query(text, params);
  } catch (err) {
    console.error('Baza so\'rovida xatolik:', err.message);
    return { rows: [] };
  }
}

async function startSession(bot, { chatId, groupId, topicId, questions, sessionId }) {
  if (activeSessions.has(chatId)) {
    await sendHtml(bot, chatId, "Bu guruhda allaqachon faol sessiya bor.");
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
  try {
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
  } catch (err) {
    console.error('runQuestionLoop xatolik:', err.message);
    if (!state.stopped) {
      state.currentIndex++;
      await sleep(1500);
      runQuestionLoop(bot, state);
    }
  }
}

async function waitAndResolve(bot, state, question) {
  try {
    while (!state.stopped) {
      await sleep(1000);

      if (state.stopped) return;

      const elapsedSinceStart = Date.now() - state.questionStartTime;
      const elapsedSinceLastMsg = Date.now() - state.lastMessageTime;

      if (elapsedSinceStart < getMandatoryWait()) continue;

      if (elapsedSinceLastMsg >= getSilenceWindow()) {
        await announceResults(bot, state, question);
        break;
      }
    }

    if (state.stopped) return;

    state.currentIndex++;
    await sleep(1500);
    runQuestionLoop(bot, state);
  } catch (err) {
    console.error('waitAndResolve xatolik:', err.message);
    if (!state.stopped) {
      state.currentIndex++;
      await sleep(1500);
      runQuestionLoop(bot, state);
    }
  }
}

async function announceResults(bot, state, question) {
  try {
    if (state.correctUsers.length > 0) {
      const list = state.correctUsers
        .map((u, i) => `${i + 1}. <b>${escapeHtml(u.name)}</b>`)
        .join('\n');

      const text = `🏆🏆🏆🏆🏆🏆🏆🏆\n<b>To'g'ri javob berganlar:</b>\n\n${list}\n\n✅️ <b>To'g'ri javob:</b> ${escapeHtml(question.answer_text)}\n\n${randomFrom(CORRECT_REACTIONS)}`;
      await sendHtml(bot, state.chatId, text);

      for (const u of state.correctUsers) {
        await safeDbQuery(
          'INSERT INTO correct_answers (session_id, question_id, user_id) VALUES ($1, $2, $3)',
          [state.sessionId, question.id, u.id]
        );
      }
    } else {
      const text = `⏱ Vaqt tugadi.\n\n✅️ <b>To'g'ri javob:</b> ${escapeHtml(question.answer_text)}\n\n${randomFrom(TIMEOUT_REACTIONS)}`;
      await sendHtml(bot, state.chatId, text);
    }
  } catch (err) {
    console.error('announceResults xatolik:', err.message);
  }
}

async function finishSession(bot, state) {
  activeSessions.delete(state.chatId);
  await sendRecapAndStats(bot, state, state.questions, false);
}

async function finishSessionManually(bot, state) {
  activeSessions.delete(state.chatId);
  await sendRecapAndStats(bot, state, state.questions, true);
}

async function sendRecapAndStats(bot, state, questionsToRecap, wasStoppedManually) {
  try {
    await safeDbQuery(
      "UPDATE sessions SET status = 'finished', finished_at = NOW() WHERE id = $1",
      [state.sessionId]
    );

    let recap = `📋 <b>Barcha savol-javoblar (${questionsToRecap.length} ta):</b>\n\n`;
    questionsToRecap.forEach((q) => {
      recap += `⁉️ ${escapeHtml(q.question_text)}\n✅️ <b>${escapeHtml(q.answer_text)}</b>\n\n`;
    });

    const chunks = splitMessage(recap, 3800);
    for (const chunk of chunks) {
      await sendHtml(bot, state.chatId, chunk);
      await sleep(500);
    }

    const activityResult = await safeDbQuery(
      `SELECT full_name, username, message_count
       FROM session_activity
       WHERE session_id = $1
       ORDER BY message_count DESC`,
      [state.sessionId]
    );

    const medals = ['🥇', '🥈', '🥉'];

    let leaderboard = '';
    activityResult.rows.forEach((row, i) => {
      const name = row.full_name || row.username || 'Foydalanuvchi';
      const prefix = medals[i] || `${i + 1}.`;
      leaderboard += `${prefix} <b>${escapeHtml(name)}</b> - ${row.message_count} ta xabar\n`;
    });

    const statsIntro = `🎉🎊 <b>FAOLLAR REYTINGI</b> 🎊🎉\n\n👏👏👏 Barchaga katta olqish! 👏👏👏\n\n`;
    const statsOutro = activityResult.rows.length > 0
      ? `\n🔥 Ayniqsa top uchlik uchun qarsaklar! 🔥\n✨ Zo'r natija, davom eting! ✨`
      : '';

    const statsChunks = splitMessage(
      statsIntro + (leaderboard || "Ma'lumot topilmadi") + statsOutro,
      3800
    );
    for (const chunk of statsChunks) {
      await sendHtml(bot, state.chatId, chunk);
      await sleep(500);
    }

    await sleep(1000);
    const finishText = wasStoppedManually
      ? `🎈 <b>Savol-javob to'xtatildi.</b> 🎈\n\nBarchaga faol ishtirok uchun katta rahmat! 🙌🌟\n\nKeyingi darsga yanada kuchli tayyorlaning! 💪📚✨`
      : `🎈 <b>Savol-javob muvaffaqiyatli yakunlandi!</b> 🎈\n\nBarchaga faol ishtirok uchun katta rahmat! 🙌🌟\n\nKeyingi darsga yanada kuchli tayyorlaning! 💪📚✨`;
    await sendHtml(bot, state.chatId, finishText);
  } catch (err) {
    console.error('sendRecapAndStats xatolik:', err.message);
  }
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
  try {
    const chatId = ctx.chat.id;
    const state = activeSessions.get(chatId);
    if (!state) return;

    const msg = ctx.message;
    if (!msg.text) return;

    state.lastMessageTime = Date.now();

    const userId = msg.from.id;
    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
    const username = msg.from.username || null;

    await safeDbQuery(
      `INSERT INTO session_activity (session_id, user_id, username, full_name, message_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (session_id, user_id)
       DO UPDATE SET message_count = session_activity.message_count + 1,
                      username = EXCLUDED.username,
                      full_name = EXCLUDED.full_name`,
      [state.sessionId, userId, username, fullName]
    );

    const question = state.questions[state.currentIndex];
    if (question && isAnswerCorrect(msg.text, question.answer_text)) {
      if (!state.correctUserIds.has(userId)) {
        state.correctUserIds.add(userId);
        state.correctUsers.push({ id: userId, name: fullName || username || 'Foydalanuvchi' });
      }
    }
  } catch (err) {
    console.error('handleGroupMessage xatolik:', err.message);
  }
}

async function stopSession(bot, chatId) {
  const state = activeSessions.get(chatId);
  if (!state) return false;

  state.stopped = true;
  await finishSessionManually(bot, state);
  return true;
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
