const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
require('dotenv').config();

// OpenAI Configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// LangChain imports
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Инициализация базы данных
const db = new sqlite3.Database('./ai_recruiter.db');

// Создание таблиц
db.serialize(() => {
    // Таблица для кандидатов
    db.run(`CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        position TEXT NOT NULL,
        experience_years INTEGER,
        skills TEXT,
        portfolio_url TEXT,
        resume_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица для сессий рекрутера
    db.run(`CREATE TABLE IF NOT EXISTS recruiter_sessions (
        id TEXT PRIMARY KEY,
        recruiter_name TEXT,
        conversation_history TEXT,
        requirements TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Добавляем колонку current_field если её нет
    db.run(`ALTER TABLE recruiter_sessions ADD COLUMN current_field TEXT DEFAULT 'job_title'`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.log('Колонка current_field уже существует или другая ошибка:', err.message);
        } else if (!err) {
            console.log('✅ Добавлена колонка current_field в таблицу recruiter_sessions');
        }
    });

    // Таблица для вакансий
    db.run(`CREATE TABLE IF NOT EXISTS job_vacancies (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        job_title TEXT NOT NULL,
        experience_years INTEGER,
        core_skills TEXT,
        job_description TEXT,
        additional_requirements TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES recruiter_sessions (id)
    )`);
});

// Класс для работы с OpenAI API
class OpenAIAPI {
    constructor() {
        this.client = openai;
        this.model = 'gpt-3.5-turbo';
    }

    async callAPI(messages, maxTokens = 800) {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                max_tokens: maxTokens,
                temperature: 0.7
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error('Ошибка OpenAI API:', error.message);
            throw error;
        }
    }
}

// Система постепенного сбора полей вакансии
class ProgressiveJobCollector {
    constructor() {
        this.openaiAPI = new OpenAIAPI();
        
        // Поля для сбора (без захардкоженных вопросов)
        this.fields = [
            {
                name: 'job_title',
                displayName: 'Название должности',
                description: 'Конкретная позиция или роль в команде'
            },
            {
                name: 'experience_years',
                displayName: 'Опыт работы',
                description: 'Минимальное количество лет релевантного опыта'
            },
            {
                name: 'core_skills',
                displayName: 'Ключевые навыки',
                description: 'Обязательные технологии, языки программирования, фреймворки'
            },
            {
                name: 'salary_range',
                displayName: 'Зарплатная вилка',
                description: 'Бюджет на зарплату в рублях или долларах'
            },
            {
                name: 'work_format',
                displayName: 'Формат работы',
                description: 'Офис, удаленка, гибридный формат'
            },
            {
                name: 'additional_requirements',
                displayName: 'Дополнительные требования',
                description: 'Языки, soft skills, специфические требования'
            }
        ];
    }

    // Извлечение всей доступной информации из сообщения
    async extractAllFieldsInfo(message) {
        try {
            const prompt = `Ты - ИИ помощник рекрутера. Проанализируй сообщение пользователя и извлеки ВСЮ доступную информацию о вакансии.

СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: ${message}

Извлеки информацию для следующих полей (если она есть в сообщении):

1. job_title: название должности (например: Frontend разработчик, Python разработчик)
2. experience_years: количество лет опыта (ТОЛЬКО ЧИСЛО, например: 3, 5, 2)
3. core_skills: технологии и навыки (например: React, JavaScript, Node.js)
4. salary_range: диапазон зарплаты (например: 100-150к, $2000-3000)
5. work_format: формат работы (офис/удаленка/гибрид)
6. additional_requirements: дополнительные требования (языки, soft skills, сертификаты)

Отвечай в формате JSON:
{
  "job_title": "найденное название или НЕ_УКАЗАНО",
  "experience_years": "найденное число лет или НЕ_УКАЗАНО", 
  "core_skills": "найденные навыки или НЕ_УКАЗАНО",
  "salary_range": "найденная зарплата или НЕ_УКАЗАНО",
  "work_format": "найденный формат или НЕ_УКАЗАНО",
  "additional_requirements": "найденные доп требования или НЕ_УКАЗАНО"
}

Примеры:
- "Нужен фронтенд разработчик с опытом React от 3 лет" → {"job_title": "Frontend разработчик", "experience_years": "3", "core_skills": "React", "salary_range": "НЕ_УКАЗАНО", "work_format": "НЕ_УКАЗАНО", "additional_requirements": "НЕ_УКАЗАНО"}
- "Python программист удаленно, знание английского" → {"job_title": "Python программист", "experience_years": "НЕ_УКАЗАНО", "core_skills": "Python", "salary_range": "НЕ_УКАЗАНО", "work_format": "удаленка", "additional_requirements": "знание английского"}

ВАЖНО: Отвечай ТОЛЬКО JSON без дополнительного текста!`;

            const messages = [{ role: 'user', content: prompt }];
            const result = await this.openaiAPI.callAPI(messages, 300);
            
            // Очищаем ответ от markdown блоков
            const cleanedResult = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            try {
                return JSON.parse(cleanedResult);
            } catch (parseError) {
                console.error('Ошибка парсинга JSON:', parseError, 'Ответ:', cleanedResult);
                return {
                    job_title: "НЕ_УКАЗАНО",
                    experience_years: "НЕ_УКАЗАНО", 
                    core_skills: "НЕ_УКАЗАНО",
                    salary_range: "НЕ_УКАЗАНО",
                    work_format: "НЕ_УКАЗАНО",
                    additional_requirements: "НЕ_УКАЗАНО"
                };
            }
        } catch (error) {
            console.error('Ошибка извлечения информации:', error);
            return {
                job_title: "НЕ_УКАЗАНО",
                experience_years: "НЕ_УКАЗАНО", 
                core_skills: "НЕ_УКАЗАНО",
                salary_range: "НЕ_УКАЗАНО",
                work_format: "НЕ_УКАЗАНО",
                additional_requirements: "НЕ_УКАЗАНО"
            };
        }
    }

    // Генерация следующего вопроса или завершения
    async generateNextResponse(collectedFields, currentFieldIndex, lastMessage, conversationHistory) {
        try {
            // Проверяем, все ли обязательные поля собраны
            const requiredFields = ['job_title', 'experience_years', 'core_skills'];
            const allRequiredCollected = requiredFields.every(field => 
                collectedFields[field] && collectedFields[field] !== "НЕ_УКАЗАНО"
            );
            
            // Подсчитываем все собранные поля (включая необязательные)
            const allCollectedFields = Object.values(collectedFields).filter(v => v && v !== "НЕ_УКАЗАНО").length;

            // Подсчитываем собранные поля
            const collectedCount = Object.values(collectedFields).filter(v => v && v !== "НЕ_УКАЗАНО").length;
            
            if (allRequiredCollected && currentFieldIndex >= this.fields.length) {
                return {
                    message: `Отлично! Я собрал всю необходимую информацию:

📋 **Вакансия**: ${collectedFields.job_title}
⏰ **Опыт**: ${collectedFields.experience_years} лет
🛠 **Навыки**: ${collectedFields.core_skills}
${collectedFields.salary_range && collectedFields.salary_range !== "НЕ_УКАЗАНО" ? `💰 **Зарплата**: ${collectedFields.salary_range}` : ''}
${collectedFields.work_format && collectedFields.work_format !== "НЕ_УКАЗАНО" ? `🏢 **Формат**: ${collectedFields.work_format}` : ''}

Теперь я могу создать описание вакансии и начать поиск подходящих кандидатов! Хотите, чтобы я сгенерировал полное описание вакансии?`,
                    isComplete: true,
                    nextField: null
                };
            }

            // Определяем следующее незаполненное поле
            let nextField = null;
            let nextFieldIndex = currentFieldIndex;
            
            for (let i = 0; i < this.fields.length; i++) {
                const field = this.fields[i];
                if (!collectedFields[field.name] || collectedFields[field.name] === "НЕ_УКАЗАНО") {
                    nextField = field;
                    nextFieldIndex = i;
                    break;
                }
            }

            if (!nextField) {
                // Все поля собраны
                return {
                    message: `Отлично! Вся основная информация собрана. Хотите добавить дополнительные требования или создать описание вакансии?`,
                    isComplete: true,
                    nextField: null
                };
            }

            // Формируем сообщение с уже собранной информацией
            const collectedInfo = Object.entries(collectedFields)
                .filter(([key, value]) => value && value !== "НЕ_УКАЗАНО")
                .map(([key, value]) => {
                    const fieldDisplay = this.fields.find(f => f.name === key)?.displayName || key;
                    return `✅ ${fieldDisplay}: ${value}`;
                })
                .join('\n');

            // AI генерирует вопрос динамически
            const prompt = `Ты - профессиональный AI-рекрутер, который помогает создать идеальную вакансию. Веди естественный диалог с человеком.

КОНТЕКСТ ДИАЛОГА:
${conversationHistory ? `История разговора:\n${conversationHistory}\n\n` : ''}

УЖЕ СОБРАННАЯ ИНФОРМАЦИЯ:
${collectedInfo || 'Пока ничего не собрано'}

ПОСЛЕДНЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: "${lastMessage}"

СЛЕДУЮЩЕЕ ПОЛЕ ДЛЯ СБОРА: ${nextField.displayName}
ОПИСАНИЕ ПОЛЯ: ${nextField.description}

ТВОЯ ЗАДАЧА:
1. ${collectedInfo ? 'Кратко поблагодари за предоставленную информацию' : 'Поприветствуй пользователя'}
2. Задай ОДИН естественный, умный вопрос про "${nextField.displayName}"
3. Учитывай контекст уже собранной информации при формулировке вопроса
4. Будь дружелюбным, но профессиональным
5. НЕ повторяй вопросы о том, что уже собрано

СТИЛЬ:
- Естественная человеческая речь
- Профессиональный, но не формальный тон
- Короткие понятные предложения
- Персонализированные вопросы исходя из контекста

Сгенерируй подходящий вопрос:`;

            const messages = [{ role: 'user', content: prompt }];
            const response = await this.openaiAPI.callAPI(messages, 300);

            return {
                message: response,
                isComplete: false,
                nextField: nextField.name,
                nextFieldIndex: nextFieldIndex
            };

        } catch (error) {
            console.error('Ошибка генерации ответа:', error);
            
            // Fallback - простая логика без AI
            const nextField = this.fields.find(f => 
                !collectedFields[f.name] || collectedFields[f.name] === "НЕ_УКАЗАНО"
            );
            
            let fallbackMessage = "Расскажите больше о требованиях к кандидату.";
            
            if (nextField) {
                // Генерируем простой вопрос на основе описания поля
                switch (nextField.name) {
                    case 'job_title':
                        fallbackMessage = "Для начала, какую должность вы ищете?";
                        break;
                    case 'experience_years':
                        fallbackMessage = "Отлично! Какой минимальный опыт нужен для этой позиции?";
                        break;
                    case 'core_skills':
                        fallbackMessage = "Хорошо! Какие ключевые навыки должен иметь кандидат?";
                        break;
                    case 'salary_range':
                        fallbackMessage = "Понятно! Какой бюджет на зарплату планируете?";
                        break;
                    case 'work_format':
                        fallbackMessage = "И какой формат работы предпочтителен?";
                        break;
                    case 'additional_requirements':
                        fallbackMessage = "Есть ли дополнительные требования к кандидату?";
                        break;
                    default:
                        fallbackMessage = `Расскажите про ${nextField.displayName}.`;
                }
            }
            
            return {
                message: fallbackMessage,
                isComplete: !nextField,
                nextField: nextField?.name || null
            };
        }
    }

    async generateJobDescription(fields, conversationContext = '') {
        const prompt = `Создай профессиональное описание вакансии на основе собранной информации:

**Основная информация:**
- Должность: ${fields.job_title}
- Опыт: ${fields.experience_years} лет
- Навыки: ${fields.core_skills}
${fields.salary_range ? `- Зарплата: ${fields.salary_range}` : ''}
${fields.work_format ? `- Формат работы: ${fields.work_format}` : ''}

**Контекст разговора:** ${conversationContext}

Создай структурированное описание вакансии в формате:

# ${fields.job_title}

## О компании
[Краткое описание]

## Что предстоит делать
- [Основная обязанность 1]
- [Основная обязанность 2]
- [Основная обязанность 3]

## Требования
- Опыт работы: ${fields.experience_years}+ лет
- Технические навыки: ${fields.core_skills}
- [Дополнительные требования]

## Условия
${fields.salary_range ? `- Зарплата: ${fields.salary_range}` : '- Зарплата обсуждается'}
${fields.work_format ? `- Формат работы: ${fields.work_format}` : '- Формат работы: гибкий'}
- [Дополнительные условия]

## Будет плюсом
- [Дополнительный навык 1]
- [Дополнительный навык 2]

Пиши на русском языке, профессионально и привлекательно для кандидатов.`;

        const messages = [{ role: 'user', content: prompt }];
        return await this.openaiAPI.callAPI(messages, 1500);
    }
}

// Инициализация AI-рекрутера
const jobCollector = new ProgressiveJobCollector();

// Маршруты для кандидатов
app.post('/api/candidates', (req, res) => {
    const { name, email, position, experienceYears, skills, portfolioUrl, resumeText } = req.body;
    
    if (!name || !email || !position) {
        return res.status(400).json({ error: 'Не заполнены обязательные поля' });
    }

    const candidateId = uuidv4();
    
    const stmt = db.prepare(`
        INSERT INTO candidates (id, name, email, position, experience_years, skills, portfolio_url, resume_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([candidateId, name, email, position, experienceYears, skills, portfolioUrl, resumeText], 
        function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Ошибка сохранения данных' });
            }
            
            res.json({ 
                success: true, 
                candidateId,
                message: 'Анкета успешно отправлена!' 
            });
        });
    
    stmt.finalize();
});

// Получение всех кандидатов
app.get('/api/candidates', (req, res) => {
    db.all('SELECT * FROM candidates ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка получения данных' });
        }
        res.json(rows);
    });
});

// Маршрут для чата с AI-рекрутером
app.post('/api/recruiter/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    
    try {
        let session;
        
        if (sessionId) {
            // Получаем существующую сессию
            session = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM recruiter_sessions WHERE id = ?', [sessionId], 
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });
        }
        
        if (!session) {
            // Создаем новую сессию
            const newSessionId = uuidv4();
            session = {
                id: newSessionId,
                conversation_history: '[]',
                requirements: '{}',
                current_field: 'job_title'
            };
            
            const stmt = db.prepare(`
                INSERT INTO recruiter_sessions (id, conversation_history, requirements, current_field)
                VALUES (?, ?, ?, ?)
            `);
            stmt.run([newSessionId, '[]', '{}', 'job_title']);
            stmt.finalize();
        }

        // Парсим историю разговора
        let conversationHistory = [];
        try {
            conversationHistory = JSON.parse(session.conversation_history || '[]');
        } catch (e) {
            conversationHistory = [];
        }

        // Получаем уже собранные поля из сессии
        let jobFields = {};
        try {
            jobFields = JSON.parse(session.requirements || '{}');
        } catch (e) {
            jobFields = {};
        }

        // Извлекаем ВСЮ доступную информацию из сообщения
        const extractedFields = await jobCollector.extractAllFieldsInfo(message);
        
        // Обновляем все поля, где найдена информация
        for (const [fieldName, fieldValue] of Object.entries(extractedFields)) {
            if (fieldValue !== "НЕ_УКАЗАНО") {
                jobFields[fieldName] = fieldValue;
                console.log(`✅ Обновлено поле ${fieldName}: ${fieldValue}`);
            }
        }

        // Определяем текущее поле для сбора (следующее незаполненное)
        let currentFieldIndex = 0;
        for (let i = 0; i < jobCollector.fields.length; i++) {
            const field = jobCollector.fields[i];
            if (!jobFields[field.name] || jobFields[field.name] === "НЕ_УКАЗАНО") {
                currentFieldIndex = i;
                break;
            }
            currentFieldIndex = i + 1; // Если все поля заполнены
        }

        // Формируем историю для контекста
        const historyText = conversationHistory.map(h => `Рекрутер: ${h.human}\nAI: ${h.ai}`).join('\n\n');

        // Генерируем следующий ответ
        const aiResponse = await jobCollector.generateNextResponse(
            jobFields,
            currentFieldIndex,
            message,
            historyText
        );

        // Определяем следующее поле для сбора
        let nextField = aiResponse.nextField || currentField;
        if (aiResponse.nextFieldIndex !== undefined && aiResponse.nextFieldIndex < jobCollector.fields.length) {
            nextField = jobCollector.fields[aiResponse.nextFieldIndex].name;
        } else if (aiResponse.isComplete) {
            nextField = 'completed';
        }
        
        // Добавляем в историю
        conversationHistory.push({
            human: message,
            ai: aiResponse.message,
            timestamp: new Date().toISOString()
        });

        // Сохраняем обновленную информацию
        const stmt = db.prepare(`
            UPDATE recruiter_sessions 
            SET conversation_history = ?, requirements = ?, current_field = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        stmt.run([
            JSON.stringify(conversationHistory), 
            JSON.stringify(jobFields), 
            nextField,
            session.id
        ]);
        stmt.finalize();

        res.json({
            response: aiResponse.message,
            sessionId: session.id,
            isComplete: aiResponse.isComplete,
            collectedFields: jobFields,
            nextField: nextField
        });

    } catch (error) {
        console.error('Ошибка чата:', error);
        
        // Fallback ответ с учетом прогрессивного сбора
        let fallbackMessage = "Привет! Я помогу создать вакансию. ";
        
        if (!sessionId) {
            fallbackMessage += "Начнем с названия должности. Какую позицию вы ищете?";
        } else {
            fallbackMessage += "Давайте продолжим сбор информации о вакансии.";
        }
        
        res.json({
            response: fallbackMessage + " (Примечание: AI временно недоступен, используется демо-режим)",
            sessionId: sessionId || uuidv4(),
            isComplete: false
        });
    }
});

// Генерация описания вакансии
app.post('/api/generate-job', async (req, res) => {
    const { jobTitle, experienceYears, coreSkills, sessionId } = req.body;
    
    if (!jobTitle || !experienceYears || !coreSkills) {
        return res.status(400).json({ error: 'Не заполнены обязательные поля' });
    }

    try {
        // Получаем историю разговора для контекста
        let conversationHistory = '';
        if (sessionId) {
            const session = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM recruiter_sessions WHERE id = ?', [sessionId], 
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });
            
            if (session) {
                const history = JSON.parse(session.conversation_history || '[]');
                conversationHistory = history.map(h => `Рекрутер: ${h.human}\nAI: ${h.ai}`).join('\n\n');
            }
        }

        // Формируем поля вакансии
        const jobFields = {
            job_title: jobTitle,
            experience_years: experienceYears.toString(),
            core_skills: coreSkills
        };

        // Генерируем описание вакансии через LangChain
        const jobDescription = await jobCollector.generateJobDescription(
            jobFields, 
            conversationHistory
        );

        // Сохраняем вакансию в базу данных
        const vacancyId = uuidv4();
        const stmt = db.prepare(`
            INSERT INTO job_vacancies (id, session_id, job_title, experience_years, core_skills, job_description)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run([vacancyId, sessionId, jobTitle, experienceYears, coreSkills, jobDescription], 
            function(err) {
                if (err) {
                    console.error('Ошибка сохранения вакансии:', err);
                }
            });
        stmt.finalize();

        res.json({
            success: true,
            vacancyId,
            jobDescription,
            message: 'Описание вакансии успешно создано!'
        });

    } catch (error) {
        console.error('Ошибка генерации вакансии:', error);
        res.status(500).json({ error: 'Ошибка создания описания вакансии' });
    }
});

// Получение всех вакансий
app.get('/api/vacancies', (req, res) => {
    db.all('SELECT * FROM job_vacancies ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка получения вакансий' });
        }
        res.json(rows);
    });
});

// Поиск кандидатов по критериям
app.post('/api/search-candidates', async (req, res) => {
    const { position, minExperience, skills } = req.body;
    
    let query = 'SELECT * FROM candidates WHERE 1=1';
    let params = [];
    
    if (position) {
        query += ' AND position LIKE ?';
        params.push(`%${position}%`);
    }
    
    if (minExperience) {
        query += ' AND experience_years >= ?';
        params.push(minExperience);
    }
    
    if (skills) {
        query += ' AND skills LIKE ?';
        params.push(`%${skills}%`);
    }
    
    query += ' ORDER BY created_at DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка поиска' });
        }
        res.json(rows);
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 AI-Рекрутер запущен на http://localhost:${PORT}`);
    console.log(`🤖 Используется OpenAI для обработки запросов`);
    console.log('📝 OpenAI API ключ настроен автоматически');
});

module.exports = app; 