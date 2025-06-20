# 🤖 AI Recruiter

An intelligent personnel selection system using artificial intelligence and LangChain JS.

## 🚀 Features

- **AI Assistant for Recruiters**: An intelligent chatbot that helps formulate candidate requirements and asks clarifying questions.
- **Candidate Form**: A convenient web form for frontend developers to submit applications.
- **Smart Search**: Search for candidates by position, experience, and skills.
- **History Saving**: All conversations with the AI and application forms are saved in the database.
- **Beautiful Interface**: Modern responsive design.

## 🛠 Technologies

- **Backend**: Node.js, Express.js
- **AI**: LangChain JS + OpenAI GPT-3.5
- **Database**: SQLite
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 5
- **Icons**: Font Awesome

## 📦 Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd AIRecruiter
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp env.example .env
```

Edit the `.env` file and add your OpenAI API key:
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
PORT=3000
```

4. **Run the application**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

5. **Open in browser**
```
http://localhost:3000
```

## 🎯 How to use

### For Candidates:
1. Go to the main page
2. Click "Fill out the form"
3. Enter your details, skills, and experience
4. Submit the form

### For Recruiters:
1. Go to the main page
2. Click "Start searching"
3. Describe the candidate requirements in the AI chat
4. The AI will help clarify the criteria
5. Use the search form for filtering
6. View suitable candidates

## 💬 Example queries for the AI

- "I need a frontend developer with 3+ years of React experience"
- "Looking for a JavaScript developer for a startup"
- "Need a UI/UX developer with Figma knowledge"
- "Need an Angular developer for the banking sector"

The AI will automatically ask additional questions:
- English level?
- Willingness to work remotely?
- Expected salary?
- Additional requirements?

## 📁 Project Structure

```
AIRecruiter/
├── package.json          # Dependencies and scripts
├── server.js             # Main server file
├── .env                  # Environment variables
├── ai_recruiter.db       # SQLite database (created automatically)
└── public/               # Static files
    ├── index.html        # Main page
    ├── candidate-form.html    # Candidate form
    └── recruiter-dashboard.html # Recruiter dashboard
```

## 🗄️ Database Structure

### `candidates` table
- `id` - Unique candidate ID
- `name` - Full name
- `email` - Email address
- `position` - Desired position
- `experience_years` - Years of experience
- `skills` - Skills (comma-separated string)
- `portfolio_url` - Link to portfolio
- `resume_text` - Description of experience
- `created_at` - Creation date

### `recruiter_sessions` table
- `id` - Session ID
- `conversation_history` - Conversation history (JSON)
- `requirements` - Candidate requirements
- `created_at` - Creation date
- `updated_at` - Update date

### `interviews` table
- `id` - Interview ID
- `candidate_id` - Link to candidate
- `session_id` - Link to recruiter session
- `questions` - Interview questions
- `answers` - Candidate's answers
- `ai_evaluation` - AI evaluation
- `score` - Numeric score
- `status` - Interview status

## 🔧 API Endpoints

### Candidates
- `POST /api/candidates` - Create a new candidate
- `GET /api/candidates` - Get all candidates
- `POST /api/search-candidates` - Search for candidates by criteria

### AI Chat
- `POST /api/recruiter/chat` - Send a message to the AI assistant

## 🎨 Interface Customization

The system uses CSS variables for easy color customization:
- Main gradient: `#667eea` → `#764ba2`
- Border radius: `15px`
- Shadows: `0 5px 15px rgba(0,0,0,0.1)`

## 🔒 Security

- Server-side data validation
- User input sanitization
- CORS settings
- Environment variables for API keys

## 📈 Project Development

Planned improvements:
- [ ] Notification system
- [ ] Calendar integration for interviews
- [ ] Automatic AI-based candidate evaluation
- [ ] Report exporting
- [ ] Integration with external job boards
- [ ] Video interviews
- [ ] Skill tests

## 🤝 Contributing

1. Fork the project
2. Create a branch for a new feature
3. Commit your changes
4. Submit a Pull Request

## 📄 License

MIT License

## 🆘 Support

If you have any questions or problems:
1. Check that the OpenAI API key is specified correctly
2. Make sure all dependencies are installed
3. Check the server logs in the console

---

**Created using LangChain JS and OpenAI GPT-3.5** 🤖 