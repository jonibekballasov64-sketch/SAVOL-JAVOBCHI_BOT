const { isAdmin } = require('./config');
const { parseQuizText } = require('./quizParser');
const db = require('./db');

// Har bir admin uchun vaqtinchalik holat (xotirada)
// { stage: 'awaiting_meta' | 'awaiting_questions', slug, title, buffer: [] }
const adminState = new Map();

function registerAdminQuizHandlers(bot) {
  // Yangi mavzu boshlash
  bot.command('yangi_mavzu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    adminState.set(ctx.from.id, { stage: 'awaiting_meta', buffer: [] });

    await ctx.reply(
      "Mavzu ma'lumotini yuboring quyidagi formatda:\n\n" +
      "`slug | Mavzu nomi`\n\n" +
      "Masalan:\n" +
      "`5-sinf1-qism | 5-sinf 1-qism savollari`\n\n" +
      "_(slug — guruhda /start_ buyrug'ida ishlatiladigan qism, faqat harf/raqam/tire)_",
      { parse_mode: 'Markdown' }
    );
  });

  // Jarayonni bekor qilish
  bot.command('bekor_qilish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    adminState.delete(ctx.from.id);
    await ctx.reply('Bekor qilindi.');
  });

  // Matnli xabarlarni holatga qarab qayta ishlash
  bot.on('text', async (ctx, next) => {
    if (!isAdmin(ctx.from.id)) return next();
    if (ctx.chat.type !== 'private') return next(); // faqat botga shaxsiy yozganda

    const state = adminState.get(ctx.from.id);
    if (!state) return next();

    const text = ctx.message.text;

    if (state.stage === 'awaiting_meta') {
      return handleMeta(ctx, state, text);
    }

    if (state.stage === 'awaiting_questions') {
      return handleQuestionsChunk(ctx, state, text);
    }

    return next();
  });

  // "Yakunlash" tugmasi
  bot.action('quiz_finish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const state = adminState.get(ctx.from.id);
    if (!state || state.buffer.length === 0) {
      await ctx.answerCbQuery("Hozircha saqlanadigan savol yo'q");
      return;
    }

    await saveTopicToDb(ctx, state);
    adminState.delete(ctx.from.id);
    await ctx.answerCbQuery();
  });

  // "Davom etish" tugmasi — shunchaki klaviaturani yopadi
  bot.action('quiz_continue', async (ctx) => {
    await ctx.answerCbQuery('Davom eting, keyingi savollarni yuboring ✍️');
  });
}

async function handleMeta(ctx, state, text) {
  const parts = text.split('|').map(p => p.trim());

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    await ctx.reply(
      "Format noto'g'ri. Iltimos qayta yuboring:\n`slug | Mavzu nomi`",
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [slug, title] = parts;

  if (!/^[a-zA-Z0-9_\-]+$/.test(slug)) {
    await ctx.reply(
      "Slug faqat lotin harflari, raqam, tire (-) va pastki chiziqdan (_) iborat bo'lishi kerak."
    );
    return;
  }

  const existing = await db.query('SELECT id FROM topics WHERE slug = $1', [slug]);
  if (existing.rows.length > 0) {
    await ctx.reply(
      `"${slug}" slug allaqachon mavjud. Boshqa nom tanlang yoki /bekor_qilish bilan bekor qiling.`
    );
    return;
  }

  state.slug = slug;
  state.title = title;
  state.stage = 'awaiting_questions';

  await ctx.reply(
    `Mavzu: *${title}* (${slug})\n\n` +
    "Endi savol-javoblarni yuboring. Formatda:\n" +
    "⁉️ Savol matni\n✅️ Javob matni\n\n" +
    "Bir nechta savolni birdan, yoki bo'lib-bo'lib yuborishingiz mumkin.",
    { parse_mode: 'Markdown' }
  );
}

async function handleQuestionsChunk(ctx, state, text) {
  const pairs = parseQuizText(text);

  if (pairs.length === 0) {
    await ctx.reply(
      "Bu xabardan savol-javob topilmadi. Format to'g'riligini tekshiring:\n" +
      "⁉️ Savol\n✅️ Javob"
    );
    return;
  }

  state.buffer.push(...pairs);

  await ctx.reply(
    `✅ Shu mavzuda hozircha *${state.buffer.length} ta* savol-javob qabul qilindi.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Davom etish', callback_data: 'quiz_continue' },
            { text: '💾 Yakunlash va saqlash', callback_data: 'quiz_finish' }
          ]
        ]
      }
    }
  );
}

async function saveTopicToDb(ctx, state) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const topicResult = await client.query(
      'INSERT INTO topics (slug, title, created_by) VALUES ($1, $2, $3) RETURNING id',
      [state.slug, state.title, ctx.from.id]
    );
    const topicId = topicResult.rows[0].id;

    for (let i = 0; i < state.buffer.length; i++) {
      const { question, answer } = state.buffer[i];
      await client.query(
        'INSERT INTO questions (topic_id, question_text, answer_text, order_index) VALUES ($1, $2, $3, $4)',
        [topicId, question, answer, i]
      );
    }

    await client.query('COMMIT');

    await ctx.editMessageText(
      `✅ Saqlandi!\n\n` +
      `Mavzu: *${state.title}*\n` +
      `Slug: \`${state.slug}\`\n` +
      `Savollar soni: *${state.buffer.length}*\n\n` +
      `Guruhda boshlash uchun:\n\`/start_${state.slug}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Saqlashda xatolik:', err);
    await ctx.reply("❌ Saqlashda xatolik yuz berdi. Qaytadan urinib ko'ring.");
  } finally {
    client.release();
  }
}

module.exports = { registerAdminQuizHandlers };
