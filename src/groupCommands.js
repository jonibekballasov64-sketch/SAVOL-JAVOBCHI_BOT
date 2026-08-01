const { isAdmin, getTimingSeconds, setTiming } = require('./config');
const db = require('./db');
const { startSession, handleGroupMessage, stopSession, hasActiveSession } = require('./sessionEngine');

function registerGroupHandlers(bot) {
  // Bot guruhga admin qilinganda/ o'zgarganda ro'yxatga olamiz
  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;

    if (chat.type === 'group' || chat.type === 'supergroup') {
      if (newStatus === 'administrator') {
        await db.query(
          `INSERT INTO groups (chat_id, title) VALUES ($1, $2)
           ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title`,
          [chat.id, chat.title]
        );
      }
    }
  });

  // /start_<slug> — faqat admin, faqat guruhda
  bot.hears(/^\/start_(\S+)/, async (ctx) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
    if (!isAdmin(ctx.from.id)) return;

    const slug = ctx.match[1];

    if (hasActiveSession(ctx.chat.id)) {
      await ctx.reply("⚠️ Bu guruhda allaqachon faol sessiya ketyapti. /toxtat bilan to'xtating.");
      return;
    }

    let botMember;
    try {
      botMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
    } catch (err) {
      await ctx.reply("❌ Bot holatini tekshirib bo'lmadi.");
      return;
    }

    if (botMember.status !== 'administrator') {
      await ctx.reply("❌ Bot bu guruhda admin emas. Avval botni admin qiling.");
      return;
    }

    const topicResult = await db.query('SELECT * FROM topics WHERE slug = $1', [slug]);
    if (topicResult.rows.length === 0) {
      await ctx.reply(`❌ "${slug}" nomli mavzu topilmadi.`);
      return;
    }
    const topic = topicResult.rows[0];

    const questionsResult = await db.query(
      'SELECT * FROM questions WHERE topic_id = $1 ORDER BY order_index ASC',
      [topic.id]
    );
    const questions = questionsResult.rows;

    if (questions.length === 0) {
      await ctx.reply('❌ Bu mavzuda savollar mavjud emas.');
      return;
    }

    const groupResult = await db.query('SELECT id FROM groups WHERE chat_id = $1', [ctx.chat.id]);
    let groupId;
    if (groupResult.rows.length === 0) {
      const insertGroup = await db.query(
        'INSERT INTO groups (chat_id, title) VALUES ($1, $2) RETURNING id',
        [ctx.chat.id, ctx.chat.title]
      );
      groupId = insertGroup.rows[0].id;
    } else {
      groupId = groupResult.rows[0].id;
    }

    const sessionResult = await db.query(
      'INSERT INTO sessions (group_id, topic_id, status) VALUES ($1, $2, $3) RETURNING id',
      [groupId, topic.id, 'active']
    );
    const sessionId = sessionResult.rows[0].id;

    await startSession(bot, {
      chatId: ctx.chat.id,
      groupId,
      topicId: topic.id,
      questions,
      sessionId
    });
  });

  // /toxtat — sessiyani to'xtatish (faqat admin)
  bot.command('toxtat', async (ctx) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
    if (!isAdmin(ctx.from.id)) return;

    if (!hasActiveSession(ctx.chat.id)) {
      await ctx.reply('Faol sessiya yo\'q.');
      return;
    }

    await stopSession(bot, ctx.chat.id);
  });

  // /vaqt — kutish vaqtlarini ko'rish yoki o'zgartirish (faqat admin)
  // Ishlatish: /vaqt              -> hozirgi qiymatlarni ko'rsatadi
  //            /vaqt 7            -> faqat jimlik oynasini (7 soniya) o'zgartiradi
  //            /vaqt 20 10        -> majburiy kutish 20s, jimlik oynasi 10s qilib o'zgartiradi
  bot.command('vaqt', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const parts = ctx.message.text.trim().split(/\s+/).slice(1);

    if (parts.length === 0) {
      const current = getTimingSeconds();
      await ctx.reply(
        `Hozirgi sozlamalar:\n\n` +
        `Majburiy kutish: ${current.mandatory} soniya\n` +
        `Jimlik oynasi: ${current.silence} soniya\n\n` +
        `O'zgartirish uchun:\n` +
        `/vaqt <jimlik_soniya> - faqat jimlik oynasini o'zgartiradi\n` +
        `/vaqt <majburiy_soniya> <jimlik_soniya> - ikkalasini ham o'zgartiradi`
      );
      return;
    }

    let mandatory = null;
    let silence = null;

    if (parts.length === 1) {
      silence = parseInt(parts[0], 10);
    } else {
      mandatory = parseInt(parts[0], 10);
      silence = parseInt(parts[1], 10);
    }

    if ((mandatory !== null && (isNaN(mandatory) || mandatory < 1)) ||
        (silence !== null && (isNaN(silence) || silence < 1))) {
      await ctx.reply("Noto'g'ri qiymat. Faqat musbat butun son kiriting.\n\nMasalan: /vaqt 10  yoki  /vaqt 20 10");
      return;
    }

    setTiming(mandatory, silence);
    const updated = getTimingSeconds();

    await ctx.reply(
      `✅ Sozlamalar yangilandi:\n\n` +
      `Majburiy kutish: ${updated.mandatory} soniya\n` +
      `Jimlik oynasi: ${updated.silence} soniya\n\n` +
      `Bu o'zgarish darhol kuchga kiradi (ketayotgan sessiyada ham).`
    );
  });

  // Guruhdagi barcha xabarlarni sessiya motoriga uzatish
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      await handleGroupMessage(ctx);
    }
    return next();
  });
}

module.exports = { registerGroupHandlers };
