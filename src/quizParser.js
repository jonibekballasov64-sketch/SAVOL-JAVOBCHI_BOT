/**
 * ⁉️ Savol matni
 * ✅️ Javob matni
 * formatidagi uzun matnni savol-javob juftliklariga ajratadi.
 */
function parseQuizText(text) {
  const pairs = [];

  // ⁉ yoki ⁉️ bilan boshlanadigan, ✅ yoki ✅️ gacha bo'lgan savol,
  // undan keyin keyingi ⁉ gacha yoki matn oxirigacha bo'lgan javob
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

/**
 * Javobni solishtirish uchun normalizatsiya:
 * kichik harf, bo'shliqlar, tinish belgilarini olib tashlaydi
 */
function normalizeAnswer(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()\-–—«»]/g, '')
    .replace(/\s+/g, ' ');
}

function isAnswerCorrect(userText, correctAnswer) {
  return normalizeAnswer(userText) === normalizeAnswer(correctAnswer);
}

module.exports = { parseQuizText, normalizeAnswer, isAnswerCorrect };
