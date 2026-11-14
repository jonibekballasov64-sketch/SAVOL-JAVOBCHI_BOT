const { isAdmin } = require('./config');
const db = require('./db');
const { hasActiveSession } = require('./sessionEngine');

// O'zbekiston UTC+5, DST qo'llanmaydi - shuning uchun oddiy sobit siljish yetarli.
const TASHKENT_OFFSET_MIN = 5 * 60;

// "19:58" kabi Toshkent vaqtini bugungi (agar o'tib ketgan bo'lsa ertangi) UTC Date'ga aylantiradi.
function parseTimeToUtcDate(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;

  const nowUtcMs = Date.now();
  const nowTashkentMs = nowUtcMs + TASHKENT_OFFSET_MIN * 60000;
  const nowTashkent = new Date(nowTashkentMs);

  const targetTashkentMs = Date.UTC(
    nowTashkent.getUTCFullYear(),
    nowTashkent.getUTCMonth(),
    nowTashkent.getUTCDate(),
    hours,
    minutes,
    0,
    0
  );

  let targetUtcMs = targetTashkentMs - TASHKENT_OFFSET_MIN * 60000;
  if (targetUtcMs <= nowUtcMs) {
    targetUtcMs += 24 * 60 * 60 * 1000; // vaqt o'tib ketgan bo'lsa - ertaga shu vaqtda
  }
  return new Date(targetUtcMs);
}

function formatTashkentTime(utcDate) {
  const t = new Date(new Date(utcDate).getTime() + TASHKENT_OFFSET_MIN * 60000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mo} ${hh}:${mm}`;
}

function registerQueueAdminHandlers(bot) {
  // /rejalashtir 19:58
  // 10sinf-adabiyot
  // 10sinf-tilshunoslik
  // ...
  bot.command('rejalashtir', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      await ctx.reply("Bu buyruq faqat guruh ichida ishlaydi - navbat shu guruh uchun tuziladi.");
      return;
    }

    const lines = ctx.message.text.split('\n');
    const firstLine = lines[0].replace(/^\/rejalashtir(@\S+)?/, '').trim();
    const slugLines = lines.slice(1).map((l) => l.trim()).filter(Boolean);

    if (!firstLine || slugLines.length === 0) {
      await ctx.reply(
        "Format:\n/rejalashtir 19:58\n10sinf-adabiyot\n10sinf-tilshunoslik\n\n" +
          "Birinchi qator - boshlanish vaqti (HH:MM, Toshkent vaqti) yoki 'hoziroq'.\n" +
          "Keyingi qatorlar - mavzu sluglari, ketma-ket boshlanadigan tartibda.\n\n" +
          "Har biri tugagach (barcha savollar javoblangach), natijalar e'lon qilinadi va navbatdagi keyingi mavzu o'zi boshlanadi."
      );
      return;
    }

    let scheduledAt = null;
    const isNow = firstLine.toLowerCase() === 'hoziroq';
    if (!isNow) {
      scheduledAt = parseTimeToUtcDate(firstLine);
      if (!scheduledAt) {
        await ctx.reply("Vaqt formati noto'g'ri. Masalan: 19:58  (yoki 'hoziroq' deb yozing)");
        return;
      }
    }

    const topics = [];
    for (const slug of slugLines) {
      const topicRes = await db.query('SELECT * FROM topics WHERE slug=$1', [slug]);
      if (topicRes.rows.length === 0) {
        await ctx.reply(`❌ "${slug}" nomli mavzu topilmadi. Navbat tuzilmadi, hech narsa saqlanmadi.`);
        return;
      }
      const topic = topicRes.rows[0];
      const qCountRes = await db.query('SELECT COUNT(*) FROM questions WHERE topic_id=$1', [topic.id]);
      if (Number(qCountRes.rows[0].count) === 0) {
        await ctx.reply(`❌ "${slug}" mavzusida savollar yo'q. Navbat tuzilmadi, hech narsa saqlanmadi.`);
        return;
      }
      topics.push(topic);
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

    // Shu guruh uchun avvalgi kutilayotgan navbatni bekor qilamiz (yangisi uning o'rnini oladi)
    await db.query("UPDATE topic_queue SET status='cancelled' WHERE chat_id=$1 AND status='pending'", [
      ctx.chat.id,
    ]);

    const insertedIds = [];
    for (let i = 0; i < topics.length; i++) {
      const insertRes = await db.query(
        `INSERT INTO topic_queue (chat_id, topic_id, position, scheduled_at, status, created_by)
         VALUES ($1,$2,$3,$4,'pending',$5) RETURNING id`,
        [ctx.chat.id, topics[i].id, i + 1, i === 0 && !isNow ? scheduledAt : null, ctx.from.id]
      );
      insertedIds.push(insertRes.rows[0].id);
    }

    const whenText = isNow ? 'hoziroq' : `${formatTashkentTime(scheduledAt)} (Toshkent vaqti)`;
    const list = topics.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
    await ctx.reply(
      `✅ Navbat tuzildi.\n\nBoshlanish: ${whenText}\n\n${list}\n\n` +
        `Har biri tugagach, natijalar e'lon qilinadi va keyingisi avtomatik boshlanadi.`
    );

    if (isNow && !hasActiveSession(ctx.chat.id)) {
      const { startQueueItem } = require('./queueRunner');
      await startQueueItem(bot, insertedIds[0]);
    }
  });

  bot.command('navbat', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      await ctx.reply('Bu buyruq guruh ichida ishlatiladi.');
      return;
    }

    const res = await db.query(
      `SELECT q.position, q.status, q.scheduled_at, t.title
       FROM topic_queue q JOIN topics t ON t.id = q.topic_id
       WHERE q.chat_id=$1 AND q.status IN ('pending','started')
       ORDER BY q.position ASC`,
      [ctx.chat.id]
    );

    if (res.rows.length === 0) {
      await ctx.reply("Bu guruhda hozir navbat yo'q.");
      return;
    }

    let text = '📋 Navbat:\n\n';
    res.rows.forEach((r) => {
      let statusLabel;
      if (r.status === 'started') statusLabel = '▶️ hozir ketyapti';
      else if (r.scheduled_at) statusLabel = `⏰ ${formatTashkentTime(r.scheduled_at)}`;
      else statusLabel = '⏳ navbatda (oldingisi tugashini kutadi)';
      text += `${r.position}. ${r.title} — ${statusLabel}\n`;
    });

    await ctx.reply(text);
  });

  bot.command('navbatni_bekor_qilish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;

    const res = await db.query(
      "UPDATE topic_queue SET status='cancelled' WHERE chat_id=$1 AND status='pending'",
      [ctx.chat.id]
    );

    await ctx.reply(
      res.rowCount > 0
        ? `✅ ${res.rowCount} ta rejalashtirilgan mavzu bekor qilindi.`
        : "Bekor qilinadigan navbat topilmadi."
    );
  });
}

module.exports = { registerQueueAdminHandlers, parseTimeToUtcDate, formatTashkentTime };
