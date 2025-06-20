const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
require('dotenv').config();

// OpenAI Configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// LangChain imports (Keep them for now, might be useful for prompts)
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// In-memory session storage
const sessions = new Map();

// ========== START: New Data Structures ==========

const Department = [
  'R&D', 'Product', 'IT', 'Engineering', 'Sales', 'Marketing', 
  'Customer Success', 'HR', 'Finance', 'Legal', 'Operations', 
  'Business Development', 'Design', 'Data', 'QA', 'Security', 'Administration',
];

const LocationType = ['on_site', 'hybrid', 'remote'];

const AiModel = [
  'gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o', 
  'claude-3-5-sonnet-latest',
];

const CompanyType = ['Agency', 'Outsourcing', 'Outstaffing', 'Product', 'Startup'];

const EmploymentType = ['part-time', 'full-time'];

const Domain = [
  'Adult', 'Advertising / Marketing', 'Automotive', 'Blockchain / Crypto', 'Dating',
  'E-commerce / Marketplace', 'Education', 'Fintech', 'Gambling', 'Gamedev', 
  'Hardware / IoT', 'Healthcare / MedTech', 'Manufacturing', 'Machine Learning / Big Data',
  'Media', 'MilTech', 'Mobile', 'SaaS', 'Security', 'Telecom / Communications', 'Other',
];

const Language = ['English', 'German', 'Spanish', 'French', 'Ukrainian', 'Polish', 'Other'];
const LanguageLevel = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'];

function getVacancyTemplate() {
    return {
        title: null,
        department: null,
        location: {
            type: null,
            city: null,
        },
        domain: null,
        salary: {
            from: null,
            to: null,
        },
        experience: {
            min: null,
            max: null,
        },
        responsibilities: [],
        skills: [],
        secondary_skills: [],
        soft_skills: [],
        benefits: [],
        is_remote: null,
    };
}

// ========== END: New Data Structures ==========

// Helper function to access nested properties using a string path
function getValueByPath(obj, path) {
    if (!path || !obj) return undefined;
    // Ensure path is a string before calling split
    const pathArray = String(path).split('.');
    return pathArray.reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
}

// Class for working with OpenAI API
class OpenAIAPIBase {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error("OpenAI API key is missing. Please set it in your .env file.");
        }
        try {
            this.openai = new OpenAI({ apiKey });
        } catch (error) {
            console.error("Error initializing OpenAI:", error);
            throw error;
        }
    }

    async callAPI(messages, max_tokens) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4-turbo",
                messages,
                max_tokens,
                temperature: 0.3,
            });
            return completion.choices[0].message.content;
        } catch (error) {
            console.error("Error calling OpenAI API:", error.response ? error.response.data : error.message);
            throw new Error("Failed to get a response from the AI assistant.");
        }
    }
}

class VacancyBuilder {
    constructor() {
        this.openaiAPI = new OpenAIAPIBase(process.env.OPENAI_API_KEY);
        this.model = 'gpt-4o'; // Use a more powerful model for better understanding
        
        this.fields = [
            { name: 'title', displayName: 'Job Title', type: 'string', description: 'The title of the position (e.g., "Frontend Developer").' },
            { name: 'department', displayName: 'Department', type: 'enum', options: Object.values(Department), description: 'The department for this position.' },
            { name: 'location.type', displayName: 'Location Type', type: 'enum', options: Object.values(LocationType), description: 'The type of work location.' },
            { name: 'location.city', displayName: 'City', type: 'string', description: 'The city where the position is located (if not remote).' },
            { name: 'domain', displayName: 'Domain', type: 'enum', options: Object.values(Domain), description: 'The industry domain.' },
            { name: 'salary.from', displayName: 'Minimum Salary', type: 'number', description: 'The minimum salary for the position (in USD).' },
            { name: 'salary.to', displayName: 'Maximum Salary', type: 'number', description: 'The maximum salary for the position (in USD).' },
            { name: 'experience.min', displayName: 'Minimum Years of Experience', type: 'number', description: 'The minimum number of years of professional experience required.' },
            { name: 'experience.max', displayName: 'Maximum Years of Experience', type: 'number', description: 'The maximum number of years of professional experience desired.' },
            { name: 'responsibilities', displayName: 'Responsibilities', type: 'array', description: 'A list of key responsibilities for the role.' },
            { name: 'skills', displayName: 'Primary Skills', type: 'array', description: 'List the primary required skills, separated by commas (e.g., JavaScript, React, Node.js).' },
            { name: 'secondary_skills', displayName: 'Secondary Skills', type: 'array', description: 'List any desirable but not essential skills, separated by commas.' },
            { name: 'soft_skills', displayName: 'Soft Skills', type: 'array', description: 'List required personal qualities (e.g., communication, teamwork).' },
            { name: 'benefits', displayName: 'Benefits', type: 'array', description: 'List the benefits offered with the position (e.g., "Health Insurance", "Paid Time Off").' },
            { name: 'is_remote', displayName: 'Remote Work', type: 'boolean', description: 'Is remote work possible?' },
        ];
    }
    
    findNextFieldToFill(vacancy, lastFieldName) {
        const fieldNames = this.fields.map(f => f.name);
        const lastIndex = lastFieldName ? fieldNames.indexOf(lastFieldName) : -1;
        
        // Create a new array of field names starting from the one after the last asked field, and wrapping around
        const searchOrder = [...fieldNames.slice(lastIndex + 1), ...fieldNames.slice(0, lastIndex + 1)];

        for (const fieldName of searchOrder) {
            const value = getValueByPath(vacancy, fieldName);
            if (value === null || (Array.isArray(value) && value.length === 0) || value === '') {
                return this.fields.find(f => f.name === fieldName);
            }
        }
        return null; // All fields are filled
    }

    async generateNextResponse(session) {
        const { vacancy, lastQuestionField } = session;

        // Find the next field to fill
        const nextField = this.findNextFieldToFill(vacancy, lastQuestionField);

        if (!nextField) {
            // All fields seem to be filled
            const vacancyText = await this.generateJobDescription(vacancy);
            return { message: `Looks like we have all the details. Here is the generated vacancy description:\n\n${vacancyText}`, isComplete: true };
        }

        session.lastQuestionField = nextField.name;

        // Use the AI to generate a more natural question
        const questionPrompt = `You are a friendly AI recruiter. Your task is to ask the next question to fill out a job vacancy.
The field to ask about is "${nextField.displayName}".
Here is the field's description: "${nextField.description}".

Please formulate a single, clear, and conversational question for the user. Keep it brief.

Example for "Primary Skills": "What are the essential skills for this role?"
Example for "Maximum Salary": "What is the maximum salary for this position?"

Now, generate a suitable question for "${nextField.displayName}":`;

        const question = await this.openaiAPI.callAPI([{ role: 'user', content: questionPrompt }], 100);

        return { message: question.replace(/"/g, ''), isComplete: false };
    }

    async extractAndUpdateFields(session, userInput) {
        const { vacancy, lastQuestionField } = session;

        const fieldSchema = this.fields.map(f => ({
            name: f.name,
            displayName: f.displayName,
            type: f.type,
            description: f.description,
            options: f.type === 'enum' ? f.options : undefined
        }));

        const lastQuestionFieldInfo = this.fields.find(f => f.name === lastQuestionField);
        const lastQuestion = lastQuestionField 
            ? `The last question I asked was about "${lastQuestionFieldInfo?.displayName}".` 
            : "This is the first message from the user.";

        const prompt = `You are a meticulous data extraction assistant. Your task is to analyze a user's message and precisely update a JSON object for a job vacancy. Follow the rules strictly.

**Rules:**
1.  **Start with an exact copy of the 'CURRENT VACANCY STATE' JSON.** Do not change any values initially.
2.  **Analyze the User's LATEST message ONLY**: \`"${userInput}"\`
3.  **Modify ONLY the fields the user explicitly mentions in their latest message.** All other fields MUST remain untouched from the original JSON you started with.
4.  **Be Precise with Enums**: For 'enum' type fields, you must map the user's input (e.g., "it", "It department") to one of the exact valid options from the schema (e.g., "IT").
5.  **Handle Skips/Negatives**: If the user wants to skip a field (e.g., "not needed", "no", "none"), this is a SUCCESS. Leave the field as \`null\` or \`[]\` and report SUCCESS.
6.  **Request Clarification**: If the user's message is too vague, irrelevant to the whole vacancy, or you are truly unsure how to map it to the schema, you must request clarification.

**Your Response Format:**
You MUST return a single JSON object with the following structure:
{
  "status": "SUCCESS" | "CLARIFICATION_NEEDED",
  "updatedVacancy": { ... the entire, precisely updated vacancy JSON ... },
  "commentary": "A brief explanation of your action. If status is CLARIFICATION_NEEDED, this will be your clarifying question to the user."
}

---
**Context:**
-   **Last Question Asked**: ${lastQuestion}
-   **User's Message**: "${userInput}"

**Data:**
-   **Current Vacancy State**:
    \`\`\`json
    ${JSON.stringify(vacancy, null, 2)}
    \`\`\`
-   **Vacancy Schema**:
    \`\`\`json
    ${JSON.stringify(fieldSchema, null, 2)}
    \`\`\`
---

Now, produce ONLY the JSON response.
`;
        const messages = [{ role: 'user', content: prompt }];
        try {
            const result = await this.openaiAPI.callAPI(messages, 2048); // Increased token limit for safety
            const cleanedResult = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsedResult = JSON.parse(cleanedResult);
            
            // Basic validation of the AI's response
            if (!parsedResult.status || !parsedResult.updatedVacancy) {
                throw new Error("AI response is missing 'status' or 'updatedVacancy' fields.");
            }

            return parsedResult;

        } catch (error) {
            console.error("Error parsing AI response for field extraction:", error);
            // Return a fallback object to avoid crashing the server
            return {
                status: 'CLARIFICATION_NEEDED',
                updatedVacancy: vacancy, // Return original vacancy
                commentary: "I'm having a little trouble understanding. Could you please rephrase that?"
            };
        }
    }

    async generateJobDescription(vacancy) {
        const {
            title, department, locationType, employmentType, companyType, domain,
            overallExperiencesFrom, overallExperiencesTo, coreSkills, secondarySkills,
            languages, salaryExpectations, education, isTestsTask, additionalInformation
        } = vacancy;

        const prompt = `
You are a professional HR copywriter. Your task is to generate a comprehensive, attractive, and well-structured job description in English using the provided JSON data. Use Markdown for formatting.

**JOB DATA:**
- **Title:** ${title}
- **Department:** ${department}
- **Location:** ${locationType}
- **Employment Type:** ${employmentType}
- **Company Type:** ${companyType}
- **Industry Domain:** ${domain}
- **Experience Range:** ${overallExperiencesFrom}-${overallExperiencesTo} years
- **Core Skills:** ${coreSkills.join(', ')}
- **Secondary Skills:** ${secondarySkills.join(', ')}
- **Languages:** ${languages.map(lang => `${lang.language} (${lang.level})`).join(', ')}
- **Salary:** min ${salaryExpectations.min}, max ${salaryExpectations.max}
- **Education Required:** ${education ? 'Yes' : 'No'}
- **Test Task:** ${isTestsTask ? 'Yes' : 'No'}
- **Additional Info:** ${additionalInformation}

**TASK:**
Create a job description with the following sections:

1.  **Job Title:** (Start with the title)
2.  **Location & Employment:** (e.g., "Remote, Full-time")
3.  **About the Company:** (Write a brief, engaging paragraph about a ${companyType} company in the ${domain} sector. Mention the ${department} department if relevant.)
4.  **Job Summary:** (A short paragraph summarizing the role's purpose and what the candidate will do.)
5.  **Key Responsibilities:** (Create a bulleted list of 4-6 primary duties based on the title and core skills.)
6.  **Required Skills and Qualifications:** (Create a bulleted list. Include experience years, core skills, language requirements, and education.)
7.  **Preferred Qualifications:** (Create a bulleted list from the secondary skills.)
8.  **We Offer:** (Create a bulleted list of benefits. Include competitive salary, employment type, location flexibility, and mention if there's a test task.)
9.  **Additional Information:** (Include any other relevant details from the additional info field.)

Make it professional, clear, and appealing to potential candidates. Start directly with the job title.
`;
        const messages = [{ role: 'system', content: 'You are an expert HR copywriter.' }, { role: 'user', content: prompt }];
        return await this.openaiAPI.callAPI(messages, 1500);
    }
}

// Initialize the AI builder
const vacancyBuilder = new VacancyBuilder();

// Route for chat with AI recruiter
app.post('/api/recruiter/chat', async (req, res) => {
    try {
        const { message, sessionId: currentSessionId } = req.body;
        let session;
        let sessionId = currentSessionId;

        if (sessionId && sessions.has(sessionId)) {
            session = sessions.get(sessionId);
        } else {
            sessionId = Date.now().toString();
            session = {
                id: sessionId,
                conversationHistory: [],
                vacancy: getVacancyTemplate(),
                status: 'collecting',
                lastQuestionField: null,
            };
            sessions.set(sessionId, session);
        }

        const { conversationHistory } = session;

        if (message) {
            // Add user message to history before processing.
            conversationHistory.push({ role: 'user', content: message });
            
            const extractionResult = await vacancyBuilder.extractAndUpdateFields(session, message);
            
            session.vacancy = extractionResult.updatedVacancy; // Always update the vacancy

            if (extractionResult.status === 'CLARIFICATION_NEEDED') {
                // If AI needs to clarify, use its commentary as the next response.
                const aiResponse = { message: extractionResult.commentary, isComplete: false };
                conversationHistory.push({ role: 'assistant', content: aiResponse.message });
                res.json({ sessionId, message: aiResponse.message, isComplete: aiResponse.isComplete });
                return; // End the current request-response cycle
            }
        }
        
        const aiResponse = await vacancyBuilder.generateNextResponse(session);
        
        // Add AI response to history.
        conversationHistory.push({ role: 'assistant', content: aiResponse.message });
        
        session.status = aiResponse.isComplete ? 'pending_generation' : 'collecting';

        res.json({ sessionId: session.id, message: aiResponse.message, isComplete: aiResponse.isComplete });
    } catch (error) {
        console.error(`Error in /api/recruiter/chat: ${error}`);
        res.status(500).json({ error: "An internal server error occurred." });
    }
});

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 AI Recruiter started on http://localhost:${PORT}`);
    console.log(`🤖 Using OpenAI to process requests`);
    console.log('📝 OpenAI API key configured automatically');
});

module.exports = app; 