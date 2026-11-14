# SAVOL-JAVOBCHI_BOT
Savol javobchi

## Asosiy buyruqlar

- `/yangi_mavzu` — yangi mavzu va savollarni qo'shish (faqat shaxsiy chatda, admin)
- `/mavzular` — barcha mavzular ro'yxati (faqat shaxsiy chatda, admin)
- `/start_<slug>` — guruhda bitta mavzuni darhol boshlash (admin)
- `/toxtat` — guruhdagi joriy savol-javobni to'xtatish; shu guruh uchun tuzilgan navbat ham bekor bo'ladi (admin)
- `/vaqt` — javob kutish vaqtlarini ko'rish/o'zgartirish (admin)

## Navbat bilan (taymerli) ketma-ket boshlash — `/rejalashtir`

Bir nechta mavzuni oldindan navbatga qo'yib, belgilangan vaqtda birinchisini
avtomatik boshlatish, u tugagach (natijalar e'lon qilingach) keyingisini o'zi
davom ettirish mumkin. Buyruq **guruhning o'zida** yuboriladi:

```
/rejalashtir 19:58
10sinf-adabiyot
10sinf-tilshunoslik
10sinf-mantiq
```

- 1-qator: boshlanish vaqti, `HH:MM` formatida, **Toshkent vaqti bo'yicha**.
  Shu kuni vaqt allaqachon o'tib ketgan bo'lsa — ertangi kunga rejalashtiriladi.
  Darhol boshlash kerak bo'lsa, vaqt o'rniga `hoziroq` deb yozing.
- Keyingi qatorlar: mavzu sluglari, ketma-ket boshlanadigan tartibda (har biri
  alohida qatorda).
- Har bir mavzu tugagach (barcha savollar javoblanib, natijalar e'lon
  qilingach), ~4 soniyadan keyin navbatdagi keyingi mavzu **o'zi** boshlanadi.
- Shu guruh uchun avval tuzilgan, hali boshlanmagan navbat bor bo'lsa — yangi
  `/rejalashtir` uning o'rnini oladi (eskisi bekor bo'ladi).
- `/navbat` — shu guruhdagi joriy navbat holatini ko'rsatadi.
- `/navbatni_bekor_qilish` — hali boshlanmagan navbatni bekor qiladi.
- `/toxtat` bilan qo'lda to'xtatilsa, navbatdagi qolgan mavzular ham
  avtomatik davom etmaydi — kerak bo'lsa `/rejalashtir` bilan qaytadan tuzing.

## Railway'ga joylash

1. Bu repo'ni GitHub'ga push qiling.
2. Railway'da "New Project" > "Deploy from GitHub repo" tanlang.
3. Railway loyihasiga **PostgreSQL** plagin qo'shing (Add Plugin > PostgreSQL).
   `DATABASE_URL` avtomatik qo'shiladi.
4. Variables bo'limiga qo'shing:
   - `BOT_TOKEN` — BotFather'dan olingan token
   - `ADMIN_IDS` — masalan: `123456789,987654321`
5. Deploy avtomatik ishga tushadi, `npm start` orqali botni ko'taradi.
   Jadval sxemasi (shu jumladan navbat jadvali) har ishga tushishda avtomatik
   tekshiriladi/yaratiladi.
