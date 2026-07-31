require('dotenv').config();
const { Telegraf } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const db = require('./db');
const { registerAdminQuizHandlers } = require('./adminQuiz');
const { registerGroupHandlers } = require('./groupCommands');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN topilmadi. .env faylni tekshiring.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function main() {
  await db.initDb();

  registerAdminQuizHandlers(bot);
  registerGroupHandlers(bot);

  bot.command('start', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(
        "Salom! Bu savol-javob bot.\n\n" +
        "Yangi mavzu qo'shish uchun: /yangi_mavzu\n" +
        "Guruhda boshlash uchun: /start_<mavzu_slug>"
      );
    }
  });

  bot.catch((err, ctx) => {
    console.error(`Xatolik (${ctx.updateType}):`, err);
  });

  await bot.launch();
  console.log('🤖 Bot ishga tushdi');
}

main().catch((err) => {
  console.error('Botni ishga tushirishda xatolik:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
