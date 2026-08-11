function parseQuizText(text) {
  const pairs = [];
  const regex = /(?:⁉️|⁉)\s*([\s\S]*?)\s*(?:✅️|✅)\s*([\s\S]*?)(?=(?:⁉️|⁉)|$)/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();

    if (question && answer) {
      pairs.push({ question, answer });
    }
  }

  return pairs;
}

function normalizeAnswer(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()«»'’‘ʻʼ`"\-–—]/g, '')
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function allowedDistance(len) {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

function fuzzyMatch(a, b) {
  if (a === b) return true;
  const dist = levenshtein(a, b);
  return dist <= allowedDistance(Math.max(a.length, b.length));
}

// ---- Raqam so'zlarini tanish uchun ----

const NUMBER_WORDS = {
  nol: 0, bir: 1, ikki: 2, uch: 3, tort: 4, besh: 5, olti: 6,
  yetti: 7, sakkiz: 8, toqqiz: 9,
  on: 10, yigirma: 20, ottiz: 30, qirq: 40, ellik: 50,
  oltmish: 60, yetmish: 70, sakson: 80, toqson: 90,
  yuz: 100, ming: 1000
};

// Raqam so'zlari uchun kengroq (ko'proq imloviy xatoga chidamli) tolerantlik
function numberWordAllowedDistance(len) {
  if (len <= 3) return 1;
  if (len <= 7) return 2;
  return 3;
}

function fuzzyMatchNumberWord(a, b) {
  if (a === b) return true;
  const dist = levenshtein(a, b);
  const len = Math.max(a.length, b.length);
  return dist <= numberWordAllowedDistance(len);
}

function stripTaSuffix(token) {
  if (token.length > 2 && token.endsWith('ta')) {
    return token.slice(0, -2);
  }
  return token;
}

function matchNumberWord(token) {
  if (!token) return null;
  if (/^\d+$/.test(token)) return parseInt(token, 10);

  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) {
    return NUMBER_WORDS[token];
  }

  let best = null;
  let bestDist = Infinity;
  for (const word of Object.keys(NUMBER_WORDS)) {
    if (fuzzyMatchNumberWord(token, word)) {
      const dist = levenshtein(token, word);
      if (dist < bestDist) {
        bestDist = dist;
        best = NUMBER_WORDS[word];
      }
    }
  }
  return best;
}

// Matnni to'liq son sifatida o'qishga harakat qiladi.
// Agar tarkibida notanish (raqam bo'lmagan) so'z bo'lsa - null qaytaradi.
function extractPureNumber(normalizedText) {
  if (!normalizedText) return null;

  const rawTokens = normalizedText.split(' ').filter(Boolean);
  const values = [];

  for (const t of rawTokens) {
    if (t === 'ta' || t === 'dona') continue;

    const stripped = stripTaSuffix(t);
    if (!stripped) continue;

    const val = matchNumberWord(stripped);
    if (val === null || val === undefined) return null;
    values.push(val);
  }

  if (values.length === 0) return null;

  let total = 0;
  let current = 0;
  for (const v of values) {
    if (v >= 100) {
      if (current === 0) current = 1;
      current *= v;
      total += current;
      current = 0;
    } else {
      current += v;
    }
  }
  total += current;

  return total;
}

// ---- Asosiy tekshiruv ----

function isAnswerCorrect(userText, correctAnswer) {
  const normUser = normalizeAnswer(userText);
  const normCorrect = normalizeAnswer(correctAnswer);

  if (!normUser) return false;

  // 1) Raqamli javoblarni moslashtirib solishtirish
  // (masalan "20 ta" = "yigirmata" = "yegirma" = "20" = "yegirrrma")
  const userNum = extractPureNumber(normUser);
  const correctNum = extractPureNumber(normCorrect);
  if (userNum !== null && correctNum !== null && userNum === correctNum) {
    return true;
  }

  // 2) To'liq mos kelish (imloviy xatoga chidamli)
  if (fuzzyMatch(normUser, normCorrect)) return true;

  // 3) Qisman mos kelish: "Qodiriy" ~ "Abdulla Qodiriy", "Xushro'y" ~ "Xushro'ybibi"
  if (normUser.length >= 3 && (normCorrect.includes(normUser) || normUser.includes(normCorrect))) {
    return true;
  }

  // 4) So'z darajasida solishtirish
  const correctWords = normCorrect.split(' ').filter(w => w.length >= 3);
  const userWords = normUser.split(' ').filter(w => w.length >= 2);

  for (const cw of correctWords) {
    for (const uw of userWords) {
      if (fuzzyMatch(uw, cw)) return true;
      if (uw.length >= 3 && (cw.includes(uw) || uw.includes(cw))) return true;
    }
  }

  return false;
}

module.exports = { parseQuizText, normalizeAnswer, isAnswerCorrect };
