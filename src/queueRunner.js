const db = require('./db');
const { startSession, hasActiveSession } = require('./sessionEngine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bitta navbat yozuvini (id bo'yicha) "started" deb belgilab, sessiyani boshlaydi.
// UPDATE ... WHERE status='pending' orqali atomik "ushlab olinadi" - shu bilan
// scheduler va zanjirlash bir xil yozuvni ikki marta boshlamasligi kafolatlanadi.
async function startQueueItem(bot, queueItemId) {
  const claimRes = await db.query(
    "UPDATE topic_queue SET status='started' WHERE id=$1 AND status='pending' RETURNING *",
    [queueItemId]
  );
  if (claimRes.rows.length === 0) return false; // allaqachon boshqa joyda ushlangan/bekor qilingan
  const queueItem = claimRes.rows[0];

  // MUHIM: pg kutubxonasi BIGINT ustunlarni (chat_id shular jumlasidan) JS
  // "string" sifatida qaytaradi, "number" emas. Agar shu qiymat to'g'ridan-to'g'ri
  // activeSessions Map kalitiga yoki keyingi solishtirishlarga ishlatilsa, u
  // Telegraf'dan keladigan ctx.chat.id (number) bilan === orqali mos kelmay qoladi -
  // natijada /toxtat "Faol sessiya yo'q" deydi va javoblar hisoblanmaydi. Shu yerda
  // bir marta Number()ga o'tkazib, shu yerdan keyin hamma joyda shu son ishlatiladi.
  const chatId = Number(queueItem.chat_id);

  try {
    const topicRes = await db.query('SELECT * FROM topics WHERE id=$1', [queueItem.topic_id]);
    const topic = topicRes.rows[0];
    if (!topic) {
      await db.query("UPDATE topic_queue SET status='error' WHERE id=$1", [queueItem.id]);
      return false;
    }

    const questionsRes = await db.query(
      'SELECT * FROM questions WHERE topic_id=$1 ORDER BY order_index ASC',
      [topic.id]
    );
    const questions = questionsRes.rows;
    if (questions.length === 0) {
      await db.query("UPDATE topic_queue SET status='error' WHERE id=$1", [queueItem.id]);
      return false;
    }

    let groupRes = await db.query('SELECT id FROM groups WHERE chat_id=$1', [chatId]);
    let groupId;
    if (groupRes.rows.length === 0) {
      const insertGroup = await db.query(
        'INSERT INTO groups (chat_id, title) VALUES ($1, $2) RETURNING id',
        [chatId, null]
      );
      groupId = insertGroup.rows[0].id;
    } else {
      groupId = groupRes.rows[0].id;
    }

    const sessionRes = await db.query(
      'INSERT INTO sessions (group_id, topic_id, status) VALUES ($1, $2, $3) RETURNING id',
      [groupId, topic.id, 'active']
    );
    const sessionId = sessionRes.rows[0].id;

    await startSession(bot, {
      chatId,
      groupId,
      topicId: topic.id,
      questions,
      sessionId,
      queueItemId: queueItem.id,
    });
    return true;
  } catch (err) {
    console.error('startQueueItem xatolik:', err.message);
    await db.query("UPDATE topic_queue SET status='error' WHERE id=$1", [queueItem.id]).catch(() => {});
    return false;
  }
}

// Har ~15 soniyada chaqiriladi: vaqti kelgan (position=1, scheduled_at <= NOW())
// va guruhda hali faol sessiya yo'q bo'lgan navbatlarni avtomatik boshlaydi.
async function checkSchedule(bot) {
  try {
    const res = await db.query(
      `SELECT id, chat_id FROM topic_queue
       WHERE position = 1 AND status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`
    );
    for (const item of res.rows) {
      const chatId = Number(item.chat_id); // bigint -> string muammosi uchun, yuqoridagi izohga qarang
      if (hasActiveSession(chatId)) continue; // guruh band - keyingi tekshiruvda urinib ko'ramiz
      await startQueueItem(bot, item.id);
    }
  } catch (err) {
    console.error('Navbatni tekshirishda xatolik:', err.message);
  }
}

// Bir mavzu tabiiy ravishda (barcha savollar tugab) yakunlanganda sessionEngine
// shu funksiyani chaqiradi: navbatdagi keyingi mavzu bo'lsa, qisqa tanaffusdan
// so'ng avtomatik boshlaydi.
async function tryAdvanceQueue(bot, chatId, finishedQueueItemId) {
  try {
    const finishedRes = await db.query('SELECT * FROM topic_queue WHERE id=$1', [finishedQueueItemId]);
    const finished = finishedRes.rows[0];
    if (!finished) return;

    await db.query("UPDATE topic_queue SET status='done' WHERE id=$1 AND status='started'", [finished.id]);

    const nextRes = await db.query(
      "SELECT id FROM topic_queue WHERE chat_id=$1 AND position=$2 AND status='pending'",
      [chatId, finished.position + 1]
    );
    if (nextRes.rows.length === 0) return;

    await sleep(4000); // tabriklar xabari joyiga tushishi uchun kichik tanaffus
    if (hasActiveSession(chatId)) return; // ehtiyot chorasi
    await startQueueItem(bot, nextRes.rows[0].id);
  } catch (err) {
    console.error('tryAdvanceQueue xatolik:', err.message);
  }
}

module.exports = { startQueueItem, checkSchedule, tryAdvanceQueue };
