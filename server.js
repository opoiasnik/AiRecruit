require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');

// OpenAI API Key Loading
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error('❌ Missing OpenAI API key. Make sure to set the OPENAI_API_KEY environment variable in a .env file.');
    process.exit(1);
}
console.log('🔑 OpenAI API key loaded successfully.');

// Fetch polyfill for Node.js versions < 18
const fetch = (() => {
    try {
        return globalThis.fetch || require('node-fetch');
    } catch (e) {
        console.warn('⚠️ Fetch not available. Please install node-fetch: npm install node-fetch');
        return null;
    }
})();

// LangChain imports (Keep them for now, might be useful for prompts)
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');

const app = express();
const PORT = 3001;

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

// Полная структура вакансии согласно требованиям
function getVacancyTemplate() {
    return {
        title: null,
        description: null,
        authorId: "user_2hm9OQpFfHybPE5X2YAKC10dfJW", // по дефолту
        orgId: "org_2hm9FHY47aoA4uB6HZVf64dohbO", // по дефолту
        hiringCompanyId: "bac58803-ce02-4fcd-abea-7d89652037aa", // по дефолту
        department: null,
        additionalInformation: null,
        locationType: null,
        remote: null,
        aiModel: null,
        companyType: null,
        employmentType: null,
        domain: null,
        isTestsTask: null,
        coreSkills: [],
        secondarySkills: [],
        overallExperiencesFrom: null,
        overallExperiencesTo: null,
        education: null,
        languages: [], // массив объектов {language: string, level: string}
        salaryExpectations: {
            min: null,
            max: null,
            currency: "USD"
        }
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

class IntelligentRecruiterChat {
    constructor() {
        this.openaiAPI = new OpenAIAPIBase(OPENAI_API_KEY);
        this.model = 'gpt-4-turbo';
        
        // Define all fields for analysis
        this.vacancyFields = [
            { name: 'title', type: 'string', description: 'Job title (e.g., Frontend Developer, Backend Developer)' },
            { name: 'description', type: 'string', description: 'Brief description of the vacancy' },
            { name: 'department', type: 'enum', options: Department, description: 'Company department' },
            { name: 'additionalInformation', type: 'string', description: 'Additional information about the vacancy' },
            { name: 'locationType', type: 'enum', options: LocationType, description: 'Work location type' },
            { name: 'remote', type: 'boolean', description: 'Is remote work possible' },
            { name: 'aiModel', type: 'enum', options: AiModel, description: 'AI model to use' },
            { name: 'companyType', type: 'enum', options: CompanyType, description: 'Company type' },
            { name: 'employmentType', type: 'enum', options: EmploymentType, description: 'Employment type' },
            { name: 'domain', type: 'enum', options: Domain, description: 'Business domain' },
            { name: 'isTestsTask', type: 'boolean', description: 'Is test assignment required' },
            { name: 'coreSkills', type: 'array', description: 'Core skills separated by commas' },
            { name: 'secondarySkills', type: 'array', description: 'Additional skills separated by commas' },
            { name: 'overallExperiencesFrom', type: 'number', description: 'Minimum years of experience' },
            { name: 'overallExperiencesTo', type: 'number', description: 'Maximum years of experience' },
            { name: 'education', type: 'boolean', description: 'Is higher education required' },
            { name: 'languages', type: 'array', description: 'Languages and levels [{language: "English", level: "B2"}]' },
            { name: 'salaryExpectations.min', type: 'number', description: 'Minimum salary' },
            { name: 'salaryExpectations.max', type: 'number', description: 'Maximum salary' }
        ];
    }
    
    // Analyze user message to extract vacancy data
    async analyzeMessage(userMessage, conversationHistory, currentVacancy) {
        const prompt = `You are an intelligent AI recruiter analyzing natural human conversation to extract job vacancy information.

CORE PRINCIPLE: Understand human intent, not just keywords. Be smart about context and natural language.

ANALYSIS APPROACH:
1. Read the user's message naturally, like a human would
2. Consider the full conversation context
3. Extract any job-related information mentioned
4. Map information to appropriate vacancy fields intelligently
5. Use available enum options when applicable
6. Return updated vacancy JSON with only NEW information

SMART INTERPRETATION EXAMPLES:
- "We need someone with React experience" → coreSkills: ["React"]
- "Looking for 3-5 years experience" → overallExperiencesFrom: 3, overallExperiencesTo: 5
- "Remote work is fine" → locationType: "remote", remote: true
- "Full time position" → employmentType: "full-time"
- "Budget is $4000-6000" → salaryExpectations: {min: 4000, max: 6000}
- "Education domain" → domain: "Education"
- "IT department" → department: "IT"

AVAILABLE ENUM OPTIONS:
- department: ${JSON.stringify(Department)}
- locationType: ${JSON.stringify(LocationType)}
- domain: ${JSON.stringify(Domain)}
- companyType: ${JSON.stringify(CompanyType)}
- employmentType: ${JSON.stringify(EmploymentType)}

CONVERSATION CONTEXT:
${conversationHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

USER'S LATEST MESSAGE: "${userMessage}"

CURRENT VACANCY STATE:
${JSON.stringify(currentVacancy, null, 2)}

TASK: Return updated vacancy JSON with any new information from the user's message. Be intelligent about natural language understanding.`;

        try {
            // Check if user wants to skip/reject current field
            const skipResponse = await this.checkForSkipResponse(userMessage, currentVacancy);
            if (skipResponse.shouldSkip) {
                console.log(`🚫 User wants to skip field, setting to: ${skipResponse.value}`);
                const updatedVacancy = { ...currentVacancy };
                const nextField = this.getNextMissingField(currentVacancy);
                if (nextField) {
                    if (nextField.includes('.')) {
                        // Handle nested fields like salaryExpectations.min
                        const [parent, child] = nextField.split('.');
                        if (!updatedVacancy[parent]) updatedVacancy[parent] = {};
                        updatedVacancy[parent][child] = skipResponse.value;
                    } else {
                        updatedVacancy[nextField] = skipResponse.value;
                    }
                }
                return { success: true, updatedVacancy };
            }

            const response = await this.openaiAPI.callAPI([{ role: 'user', content: prompt }], 1500);
            const cleanedResponse = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            try {
                const updatedVacancy = JSON.parse(cleanedResponse);
                
                // Smart auto-completion and field mapping
                this.applySmartMappings(updatedVacancy, userMessage, currentVacancy);
                
                // Merge with current vacancy to preserve existing data
                const mergedVacancy = { ...currentVacancy };
                Object.keys(updatedVacancy).forEach(key => {
                    if (updatedVacancy[key] !== null && updatedVacancy[key] !== undefined) {
                        mergedVacancy[key] = updatedVacancy[key];
                    }
                });
                
                console.log('📝 Field updates applied:', Object.keys(updatedVacancy).filter(k => updatedVacancy[k] !== null));
                
                return { success: true, updatedVacancy: mergedVacancy };
            } catch (parseError) {
                console.error('JSON parsing error:', parseError);
                return { success: false, error: 'Data processing error', updatedVacancy: currentVacancy };
            }
        } catch (error) {
            console.error('Message analysis error:', error);
            return { success: false, error: 'AI analysis error', updatedVacancy: currentVacancy };
        }
    }

    // Check if vacancy has all required fields
    isVacancyComplete(vacancy) {
        // Required fields for creating a vacancy
        const requiredFields = ['title', 'department', 'domain', 'coreSkills', 'overallExperiencesFrom'];
        
        for (const field of requiredFields) {
            const value = getValueByPath(vacancy, field);
            if (!value || (Array.isArray(value) && value.length === 0)) {
                return false;
            }
        }
        return true;
    }

    // Get the next field that needs to be filled
    getNextMissingField(vacancy) {
        // Ordered list of all fields to fill
        const allFields = [
            'title', 
            'department', 
            'domain', 
            'coreSkills', 
            'overallExperiencesFrom',
            'salaryExpectations.min',
            'locationType',
            'employmentType',
            'companyType',
            'secondarySkills',
            'overallExperiencesTo',
            'languages',
            'education',
            'isTestsTask',
            'description'
        ];

        for (const field of allFields) {
            const value = getValueByPath(vacancy, field);
            const isEmpty = value === null || value === undefined || 
                           (Array.isArray(value) && value.length === 0) ||
                           (typeof value === 'number' && isNaN(value));
            
            // Special handling for boolean fields - false is a valid value
            if (field === 'isTestsTask' || field === 'education' || field === 'remote') {
                if (value === null || value === undefined) {
                    console.log(`📝 Next missing field: ${field}`);
                    return field;
                }
            } 
            // Special handling for optional string fields - empty string is valid if user said no
            else if (field === 'description' || field === 'additionalInformation') {
                if (value === null || value === undefined) {
                    console.log(`📝 Next missing field: ${field}`);
                    return field;
                }
                // If it's an empty string, that's fine - user might have skipped it
            }
            // For other fields, check if empty
            else if (isEmpty || (typeof value === 'string' && value.trim() === '')) {
                console.log(`📝 Next missing field: ${field}`);
                return field;
            }
        }
        
        return null; // All fields filled
    }

    // Get human-readable field description
    getFieldDescription(fieldName) {
        const descriptions = {
            'title': 'job title',
            'department': 'department',
            'domain': 'business domain/industry',
            'coreSkills': 'required skills and technologies',
            'overallExperiencesFrom': 'minimum years of experience',
            'salaryExpectations.min': 'salary range',
            'locationType': 'work format (remote/hybrid/on-site)',
            'employmentType': 'employment type (full-time/part-time)',
            'companyType': 'company type',
            'secondarySkills': 'additional nice-to-have skills',
            'overallExperiencesTo': 'maximum years of experience',
            'languages': 'language requirements',
            'education': 'education requirements',
            'isTestsTask': 'test assignment requirement',
            'description': 'job description and additional details about the role'
        };
        
        return descriptions[fieldName] || fieldName;
    }

    // Use AI to determine if user wants to skip the current field
    async checkForSkipResponse(userMessage, currentVacancy) {
        try {
            const nextField = this.getNextMissingField(currentVacancy);
            const fieldDescription = this.getFieldDescription(nextField);
            
            const skipPrompt = `Analyze if the user wants to skip or decline to fill the current field.

CURRENT FIELD: ${fieldDescription}
USER MESSAGE: "${userMessage}"

Context: We're collecting job vacancy information step by step. The user was asked about ${fieldDescription}.

TASK: Determine if the user is declining to provide this information or wants to skip this field.

Examples of declining/skipping:
- "no", "skip", "not needed", "not required"  
- "I don't want to add that", "nothing else", "that's all"
- "no additional details", "no extra information"

Examples of providing information:
- "React and Node.js", "$3000-4000", "Bachelor's degree required"
- Any actual content or specific details

Return ONLY "skip" if user wants to skip this field.
Return ONLY "fill" if user is providing actual information.

RESPONSE:`;

            const response = await this.openaiAPI.callAPI([{ role: 'user', content: skipPrompt }], 30);
            const shouldSkip = response.toLowerCase().trim().includes('skip');
            
            if (shouldSkip) {
                console.log(`🧠 AI determined user wants to skip field: ${nextField}`);
                
                // Smart default values based on field type
                let defaultValue = '';
                if (nextField === 'isTestsTask' || nextField === 'education' || nextField === 'remote') {
                    defaultValue = false;
                } else if (nextField === 'secondarySkills' || nextField === 'languages') {
                    defaultValue = [];
                } else if (nextField?.includes('salaryExpectations') || nextField === 'overallExperiencesTo') {
                    defaultValue = null;
                }
                
                return {
                    shouldSkip: true,
                    value: defaultValue,
                    field: nextField
                };
            }
            
            return { shouldSkip: false };
            
        } catch (error) {
            console.error('Skip analysis failed:', error);
            return { shouldSkip: false };
        }
    }

    // Apply smart mappings based on context and user input
    applySmartMappings(updatedVacancy, userMessage, currentVacancy) {
        const msg = userMessage.toLowerCase();
        
        // Auto-fill department for developer roles
        if (updatedVacancy.title && 
            (updatedVacancy.title.toLowerCase().includes('developer') || 
             updatedVacancy.title.toLowerCase().includes('engineer') || 
             updatedVacancy.title.toLowerCase().includes('frontend') || 
             updatedVacancy.title.toLowerCase().includes('backend')) && 
            !currentVacancy.department) {
            updatedVacancy.department = 'IT';
            console.log('🤖 Auto-filled department as IT for developer role');
        }
        
        // Map salary patterns
        const salaryMatch = msg.match(/(\d+)[-\s]*(\d+)?\s*dollars?/);
        if (salaryMatch && !currentVacancy.salaryExpectations?.min) {
            updatedVacancy.salaryExpectations = {
                min: parseInt(salaryMatch[1]),
                max: salaryMatch[2] ? parseInt(salaryMatch[2]) : null,
                currency: "USD"
            };
            console.log('🤖 Extracted salary expectations:', updatedVacancy.salaryExpectations);
        }
        
        // Map location types
        if (msg.includes('remote') && !currentVacancy.locationType) {
            updatedVacancy.locationType = 'remote';
            updatedVacancy.remote = true;
            console.log('🤖 Set location to remote');
        } else if (msg.includes('hybrid') && !currentVacancy.locationType) {
            updatedVacancy.locationType = 'hybrid';
            console.log('🤖 Set location to hybrid');
        } else if (msg.includes('office') || msg.includes('on-site') && !currentVacancy.locationType) {
            updatedVacancy.locationType = 'on_site';
            console.log('🤖 Set location to on-site');
        }
        
        // Map employment type
        if (msg.includes('full') && msg.includes('time') && !currentVacancy.employmentType) {
            updatedVacancy.employmentType = 'full-time';
            console.log('🤖 Set employment to full-time');
        } else if (msg.includes('part') && msg.includes('time') && !currentVacancy.employmentType) {
            updatedVacancy.employmentType = 'part-time';
            console.log('🤖 Set employment to part-time');
        }
        
        // Map experience numbers
        const expMatch = msg.match(/(\d+)\s*(?:years?|yrs?)/);
        if (expMatch && !currentVacancy.overallExperiencesFrom) {
            updatedVacancy.overallExperiencesFrom = parseInt(expMatch[1]);
            console.log('🤖 Set experience requirement:', updatedVacancy.overallExperiencesFrom);
        }
        
        // Map common skills if mentioned in context
        const skillPatterns = {
            'react': /react(?:js)?/i,
            'next': /next(?:\.?js)?/i,
            'vue': /vue(?:\.?js)?/i,
            'angular': /angular/i,
            'node': /node(?:\.?js)?/i,
            'typescript': /typescript|ts/i,
            'javascript': /javascript|js/i,
            'python': /python/i,
            'docker': /docker/i,
            'kubernetes': /kubernetes|k8s/i,
            'aws': /aws|amazon web services/i,
            'azure': /azure/i,
            'gcp': /gcp|google cloud/i
        };
        
        if (!currentVacancy.coreSkills || currentVacancy.coreSkills.length === 0) {
            const foundSkills = [];
            Object.entries(skillPatterns).forEach(([skill, pattern]) => {
                if (pattern.test(userMessage)) {
                    foundSkills.push(skill);
                }
            });
            
            if (foundSkills.length > 0) {
                updatedVacancy.coreSkills = foundSkills;
                console.log('🤖 Extracted skills:', foundSkills);
            }
        }
    }

        // Generate response considering context
    async generateResponse(userMessage, conversationHistory, currentVacancy) {
        // Get next missing field
        const nextField = this.getNextMissingField(currentVacancy);
        
        // Calculate completion percentage
        const totalFields = 15; // Total number of fields we track
        const filledFields = totalFields - (nextField ? 1 : 0);
        const completionPercentage = Math.round((filledFields / totalFields) * 100);
        
        // Check if we have minimum required info
        const hasMinimumInfo = this.isVacancyComplete(currentVacancy);
        
        // If all fields are filled
            if (!nextField) {
                return {
                message: `🎉 Perfect! We have collected all the information needed for your ${currentVacancy.title} position.\n\n` +
                        `I'll generate the complete job description now! 🚀`,
                    isComplete: true,
                completionPercentage: 100
            };
        }
        
        // Check if user confirms generation when all fields are complete
        if (!nextField && userMessage) {
            try {
                const confirmPrompt = `The user was offered to generate a job description. Does their response confirm they want to proceed?

USER MESSAGE: "${userMessage}"

Return only "yes" or "no":`;

                const confirmResponse = await this.openaiAPI.callAPI([{ role: 'user', content: confirmPrompt }], 20);
                const userConfirms = confirmResponse.toLowerCase().trim().includes('yes');
                
                if (userConfirms) {
                    console.log(`🧠 User confirmed job generation`);
                    return {
                        message: `Perfect! Generating your job description now... 🚀`,
                        isComplete: true,
                        completionPercentage: 100
                    };
                }
            } catch (error) {
                console.log(`⚠️ Generation confirmation analysis failed`);
            }
        }
        
        // Use AI to determine if user wants to generate job description early
        let userWantsToGenerate = false;
        if (hasMinimumInfo && userMessage && nextField) {
            try {
                const intentPrompt = `The user was being asked about "${this.getFieldDescription(nextField)}" but they might want to generate the job description instead. Do they want to skip remaining fields and generate now?

USER MESSAGE: "${userMessage}"

Return only "yes" or "no":`;

                const intentResponse = await this.openaiAPI.callAPI([{ role: 'user', content: intentPrompt }], 20);
                userWantsToGenerate = intentResponse.toLowerCase().trim().includes('yes');
                console.log(`🧠 User wants to generate early: ${userWantsToGenerate}`);
            } catch (error) {
                console.log(`⚠️ Intent analysis failed`);
            }
        }
        
        // If user wants to generate early and we have minimum info
        if (hasMinimumInfo && userWantsToGenerate) {
            return {
                message: `Perfect! I'll create the job description now. 🚀`,
                isComplete: true,
                completionPercentage
            };
        }

        // Generate prompt to ask about next field
        const fieldDescription = this.getFieldDescription(nextField);
        const isRequired = ['title', 'department', 'domain', 'coreSkills', 'overallExperiencesFrom'].includes(nextField);
        
        const responsePrompt = `You are a friendly AI recruiter collecting information step by step to create a job vacancy.

CONTEXT:
- User just said: "${userMessage}"
- Current progress: ${completionPercentage}% completed
- Next field to ask about: ${fieldDescription} ${isRequired ? '(required)' : '(optional)'}

CURRENT VACANCY INFORMATION:
${Object.entries(currentVacancy)
    .filter(([key, value]) => value !== null && value !== undefined && 
           (!Array.isArray(value) || value.length > 0) &&
           (typeof value !== 'string' || value.trim() !== ''))
    .map(([key, value]) => `• ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('\n') || 'None yet'}

FIELD TO ASK ABOUT: ${fieldDescription}

INSTRUCTIONS:
1. Thank them if they provided information in their message
2. Ask naturally about the next field: ${fieldDescription}
3. Be conversational and friendly
4. Don't mention technical field names
5. Give examples if helpful
6. Keep it brief and natural

${nextField === 'domain' ? 'AVAILABLE DOMAINS: ' + JSON.stringify(Domain) : ''}
${nextField === 'department' ? 'AVAILABLE DEPARTMENTS: ' + JSON.stringify(Department) : ''}
${nextField === 'locationType' ? 'LOCATION TYPES: remote, hybrid, on_site' : ''}
${nextField === 'employmentType' ? 'EMPLOYMENT TYPES: full-time, part-time' : ''}

Generate a natural question about ${fieldDescription}:`;

        try {
            const response = await this.openaiAPI.callAPI([{ role: 'user', content: responsePrompt }], 200);
            return {
                message: response,
                isComplete: false,
                completionPercentage
            };
        } catch (error) {
            console.error('Response generation error:', error);
            
            // Fallback questions for each field
            const fallbackQuestions = {
                'title': 'What job title are we hiring for?',
                'department': 'Which department will this role be in?',
                'domain': 'What industry or business domain is this for?',
                'coreSkills': 'What are the main skills or technologies required?',
                'overallExperiencesFrom': 'How many years of experience should candidates have?',
                'salaryExpectations.min': 'What salary range are you offering?',
                'locationType': 'Will this be remote, hybrid, or on-site work?',
                'employmentType': 'Is this a full-time or part-time position?',
                'companyType': 'What type of company is this?',
                'secondarySkills': 'Any additional nice-to-have skills?',
                'overallExperiencesTo': 'What\'s the maximum experience level you\'d consider?',
                'languages': 'Any specific language requirements?',
                'education': 'Do you require higher education?',
                'isTestsTask': 'Will there be a test assignment?',
                'description': 'Please provide a brief description of the role and any additional details that would help candidates understand the position better.'
            };
            
            return {
                message: fallbackQuestions[nextField] || `Tell me about the ${fieldDescription} for this position.`,
                isComplete: false,
                completionPercentage
            };
        }
    }

    // Generate job description using advanced prompt
    async generateJobDescription(vacancy) {
        const prompt = `You are a professional job description generator. Create an engaging and comprehensive job description based on the provided vacancy data.

**VACANCY DATA:**
Title: ${vacancy.title}
Company Type: ${vacancy.companyType || 'Technology company'}
Domain: ${vacancy.domain}
Department: ${vacancy.department}
Core Skills: ${vacancy.coreSkills ? vacancy.coreSkills.join(', ') : 'Not specified'}
Secondary Skills: ${vacancy.secondarySkills ? vacancy.secondarySkills.join(', ') : 'Not specified'}
Experience Required: ${vacancy.overallExperiencesFrom || 1}${vacancy.overallExperiencesTo ? `-${vacancy.overallExperiencesTo}` : '+'} years
Education Required: ${vacancy.education ? 'Yes' : 'No'}
Languages: ${vacancy.languages && vacancy.languages.length > 0 ? vacancy.languages.map(lang => typeof lang === 'string' ? lang : `${lang.language} (${lang.level || lang.proficiency})`).join(', ') : 'English (intermediate+)'}
Location Type: ${vacancy.locationType || 'Not specified'}
Employment Type: ${vacancy.employmentType || 'Full-time'}
Salary: ${vacancy.salaryExpectations?.min ? `$${vacancy.salaryExpectations.min}${vacancy.salaryExpectations.max ? `-$${vacancy.salaryExpectations.max}` : '+'} ${vacancy.salaryExpectations.currency || 'USD'}` : 'Competitive salary'}
Test Assignment: ${vacancy.isTestsTask ? 'Yes' : 'No'}
Description: ${vacancy.description || 'Dynamic role with growth opportunities'}
Additional Info: ${vacancy.additionalInformation || 'Great team environment'}

**INSTRUCTIONS:**
1. **Introduction**: Start with an engaging introduction mentioning we're looking for a ${vacancy.title} for our client in the ${vacancy.domain} industry. Highlight the ${vacancy.companyType} company type and exciting opportunities.

2. **Responsibilities**: Create 5-7 key responsibilities based on the core skills and role level. Expand skills logically (e.g., React → React ecosystem, state management, testing).

3. **Requirements**: 
   - Start with general experience requirement
   - Expand each core skill with associated technologies
   - Include soft skills like problem-solving and collaboration
   - Mention education and language requirements

4. **Nice-to-Have**: List 2-3 secondary skills or complementary technologies that would be beneficial.

5. **What We Offer**: Include salary range, work format, and benefits based on the provided data.

**TONE**: Professional yet engaging, attractive to top-tier candidates.

**FORMAT**: Use clear markdown headers (##) and bullet points (-) for easy reading.

Generate the complete job description:`;

        try {
            const response = await this.openaiAPI.callAPI([{ role: 'user', content: prompt }], 1500);
            return response;
        } catch (error) {
            console.error('Job description generation error:', error);
            return `# ${vacancy.title || 'Job Position'}\n\nWe are looking for a specialist with ${vacancy.overallExperiencesFrom || 1}+ years of experience.\n\nRequired skills: ${vacancy.coreSkills ? vacancy.coreSkills.join(', ') : 'to be discussed'}`;
        }
    }

    // Send vacancy data to webhook
    async sendToWebhook(vacancy, jobDescription) {
        const webhookUrl = 'https://api-devel.makehire.ai/webhooks/create/position';
        
        // Prepare payload according to webhook requirements
        const payload = {
            title: vacancy.title,
            description: jobDescription, // Use generated job description
            authorId: vacancy.authorId || "user_2hm9OQpFfHybPE5X2YAKC10dfJW",
            orgId: vacancy.orgId || "org_2hm9FHY47aoA4uB6HZVf64dohbO",
            hiringCompanyId: vacancy.hiringCompanyId || "bac58803-ce02-4fcd-abea-7d89652037aa",
            department: vacancy.department,
            additionalInformation: vacancy.additionalInformation,
            locationType: vacancy.locationType,
            remote: vacancy.remote,
            aiModel: vacancy.aiModel || 'gpt-4o',
            companyType: vacancy.companyType,
            employmentType: vacancy.employmentType,
            domain: vacancy.domain,
            isTestsTask: vacancy.isTestsTask,
            coreSkills: vacancy.coreSkills,
            secondarySkills: vacancy.secondarySkills,
            overallExperiencesFrom: vacancy.overallExperiencesFrom,
            overallExperiencesTo: vacancy.overallExperiencesTo,
            education: vacancy.education,
            languages: vacancy.languages,
            salaryExpectations: vacancy.salaryExpectations
        };

        console.log('📤 Sending to webhook:', JSON.stringify(payload, null, 2));

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Webhook responded with status: ${response.status}`);
            }

            const responseData = await response.json();
            console.log('✅ Webhook success:', responseData);
            return responseData;

        } catch (error) {
            console.error('❌ Webhook request failed:', error);
            throw error;
        }
    }


}

// Initialize the AI recruiter
const aiRecruiter = new IntelligentRecruiterChat();

// Route for chat with AI recruiter
app.post('/api/recruiter/chat', async (req, res) => {
    try {
        const { message, sessionId: currentSessionId } = req.body;
        let session;
        let sessionId = currentSessionId;

        // Получаем или создаем сессию
        if (sessionId && sessions.has(sessionId)) {
            session = sessions.get(sessionId);
        } else {
            sessionId = Date.now().toString();
            session = {
                id: sessionId,
                conversationHistory: [],
                vacancy: getVacancyTemplate(),
                status: 'collecting'
            };
            sessions.set(sessionId, session);
        }

        const { conversationHistory, vacancy } = session;

        // Welcome message for first interaction
        if (conversationHistory.length === 0 && !message) {
            const welcomeMessage = `👋 Hello! I'm an AI recruiter, and I'll help you create the perfect job vacancy.\n\nTell me about the position you're looking for. You can describe everything you know - job title, requirements, skills, experience level. I'll analyze everything and ask follow-up questions to complete the vacancy.`;
            
            conversationHistory.push({ role: 'assistant', content: welcomeMessage });
            
            return res.json({ 
                sessionId, 
                message: welcomeMessage, 
                isComplete: false, 
                vacancy,
                completionPercentage: 0
            });
        }

        if (message) {
            // Add user message to conversation history
            conversationHistory.push({ role: 'user', content: message });
            
            // Analyze message and update vacancy
            const analysisResult = await aiRecruiter.analyzeMessage(message, conversationHistory, vacancy);
            
            if (analysisResult.success) {
                session.vacancy = analysisResult.updatedVacancy;
                console.log('✅ Vacancy updated:', JSON.stringify(analysisResult.updatedVacancy, null, 2));
            } else {
                console.warn('⚠️ Analysis error:', analysisResult.error);
            }
        }

        // Generate AI response
        const aiResponse = await aiRecruiter.generateResponse(message || '', conversationHistory, session.vacancy);
        
        // If collection is complete, generate job description automatically
        if (aiResponse.isComplete) {
            try {
                console.log('🚀 Auto-generating job description...');
                const jobDescription = await aiRecruiter.generateJobDescription(session.vacancy);
                
                // Send data to webhook
                let webhookSuccess = false;
                let webhookResponse = null;
                try {
                    console.log('📡 Sending data to webhook...');
                    webhookResponse = await aiRecruiter.sendToWebhook(session.vacancy, jobDescription);
                    console.log('✅ Webhook response:', webhookResponse);
                    webhookSuccess = true;
                } catch (webhookError) {
                    console.error('❌ Webhook error:', webhookError);
                    // Don't fail the whole process if webhook fails
                }
                
                const webhookStatus = webhookSuccess 
                    ? '\n\n✅ **Position successfully created in the system!**' 
                    : '\n\n⚠️ **Position created locally but failed to sync with main system.**';
                
                const finalMessage = `${aiResponse.message}\n\n**Generated Job Description:**\n\n${jobDescription}${webhookStatus}`;
                
                // Add final response to conversation history
                conversationHistory.push({ role: 'assistant', content: finalMessage });
                
                // Update session status
                session.status = 'completed';
                session.webhookResponse = webhookResponse;
                session.webhookSuccess = webhookSuccess;
                
                return res.json({
                    sessionId: session.id, 
                    message: finalMessage,
                    isComplete: true,
                    vacancy: session.vacancy,
                    jobDescription: jobDescription,
                    webhookSuccess: webhookSuccess,
                    webhookResponse: webhookResponse,
                    completionPercentage: 100
                });
                
            } catch (error) {
                console.error('❌ Auto-generation error:', error);
                // Fall back to normal response if generation fails
                conversationHistory.push({ role: 'assistant', content: aiResponse.message });
                session.status = 'completed';
                
                 return res.json({
                    sessionId: session.id, 
                    message: aiResponse.message + '\n\n⚠️ Job description generation failed. Please try again.',
                    isComplete: true,
                    vacancy: session.vacancy,
                    completionPercentage: aiResponse.completionPercentage || 0
                });
            }
        }

        // Add AI response to conversation history
        conversationHistory.push({ role: 'assistant', content: aiResponse.message });
        
        // Update session status
        session.status = aiResponse.isComplete ? 'completed' : 'collecting';
        
        res.json({
            sessionId: session.id,
            message: aiResponse.message,
            isComplete: aiResponse.isComplete,
            vacancy: session.vacancy,
            completionPercentage: aiResponse.completionPercentage || 0
        });

    } catch (error) {
        console.error(`❌ Error in /api/recruiter/chat:`, error);
        res.status(500).json({ 
            error: "A server error occurred. Please try again.",
            message: "Sorry, a technical error occurred. Would you like to continue the conversation?"
        });
    }
});

// Generate job description
app.post('/api/generate-job', async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(400).json({ error: 'Session not found' });
    }

    try {
        const session = sessions.get(sessionId);
        const { vacancy } = session;

        // Check if there's enough data for generation
        if (!aiRecruiter.isVacancyComplete(vacancy)) {
            return res.status(400).json({ 
                error: 'Insufficient data to create vacancy',
                message: 'Please fill in the required fields: job title, department, domain, skills, and work experience.'
            });
        }

        // Generate job description
        const jobDescription = await aiRecruiter.generateJobDescription(vacancy);

        // Return result
        res.json({
            success: true,
            vacancy,
            jobDescription,
            message: 'Job description successfully created!'
        });

    } catch (error) {
        console.error('❌ Job generation error:', error);
        res.status(500).json({ 
            error: 'Job description creation error',
            message: 'A technical error occurred while creating the job description.'
        });
    }
});

// Get vacancy information by session
app.get('/api/vacancy/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessions.get(sessionId);
    const filledFields = aiRecruiter.vacancyFields.filter(field => {
        const value = getValueByPath(session.vacancy, field.name);
        return value !== null && value !== undefined && 
               (!Array.isArray(value) || value.length > 0);
    }).length;
    
    const completionPercentage = Math.round((filledFields / aiRecruiter.vacancyFields.length) * 100);

    res.json({
        vacancy: session.vacancy,
        isComplete: aiRecruiter.isVacancyComplete(session.vacancy),
        completionPercentage,
        conversationHistory: session.conversationHistory
    });
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