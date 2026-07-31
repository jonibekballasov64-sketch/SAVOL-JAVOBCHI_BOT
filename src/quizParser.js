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

function isAnswerCorrect(userText, correctAnswer) {
  const normUser = normalizeAnswer(userText);
  const normCorrect = normalizeAnswer(correctAnswer);

  if (!normUser) return false;

  // To'liq mos kelish (imloviy xatoga chidamli)
  if (fuzzyMatch(normUser, normCorrect)) return true;

  // Qisman mos kelish: "Qodiriy" ~ "Abdulla Qodiriy", "Xushro'y" ~ "Xushro'ybibi"
  if (normUser.length >= 3 && (normCorrect.includes(normUser) || normUser.includes(normCorrect))) {
    return true;
  }

  // So'z darajasida solishtirish (har bir so'zni alohida, imloviy xatoga chidamli)
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
