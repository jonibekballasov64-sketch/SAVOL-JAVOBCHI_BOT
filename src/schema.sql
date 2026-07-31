-- Mavzular
CREATE TABLE IF NOT EXISTS topics (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(150) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Savollar
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  order_index INTEGER NOT NULL
);

-- Bot admin bo'lgan guruhlar
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  title VARCHAR(255)
);

-- Sessiyalar
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id),
  topic_id INTEGER REFERENCES topics(id),
  current_question_index INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

-- Faollik (sessiya davomida xabarlar soni)
CREATE TABLE IF NOT EXISTS session_activity (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  username VARCHAR(255),
  full_name VARCHAR(255),
  message_count INTEGER DEFAULT 0,
  UNIQUE(session_id, user_id)
);

-- To'g'ri javob berganlar tarixi
CREATE TABLE IF NOT EXISTS correct_answers (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  question_id INTEGER REFERENCES questions(id),
  user_id BIGINT NOT NULL,
  answered_at TIMESTAMP DEFAULT NOW()
);
