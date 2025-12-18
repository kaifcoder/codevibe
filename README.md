# CodeVibe

> **Note:** CodeVibe is under active development. Features, APIs, and architecture may change rapidly. We welcome early feedback and contributions!

CodeVibe is an innovative, open-source collaborative coding and chat platform designed to supercharge developer productivity. With a beautiful, modern UI and seamless integration of code editing, file management, and AI-powered chat, CodeVibe empowers teams and individuals to build, learn, and create together in real time.

## Features

- **Live Collaborative Code Editing**: Edit code with your team in real time, with support for TypeScript, JavaScript, and more.
- **AI-Powered Chat**: Integrated Copilot-like chat panel for instant help, code suggestions, and team discussions.
- **File Tree Navigation**: Intuitive file explorer for easy project navigation and file management.
- **Tabbed Interface**: Switch between code, live preview, and chat with a single click.
- **Live Preview**: Instantly see the output of your code in a secure, embedded browser.
- **Modern UI/UX**: Built with Next.js, Tailwind CSS, and Framer Motion for a fast, responsive, and delightful experience.
- **Extensible & Modular**: Easily add new features, integrations, or custom components.

## Full Setup & Codebase Overview

CodeVibe is built with a modular, scalable architecture using the latest web technologies. Here’s how the codebase is structured and how to get started:

### 1. **Project Structure**

- `src/app/` — Main Next.js app directory, including pages, layouts, and API routes.
- `src/components/` — Reusable UI components (including Shadcn UI and custom components).
- `src/lib/` — Utility functions, hooks, and core logic.
- `src/trpc/` — tRPC client/server setup for type-safe API calls.
- `prisma/` — Prisma schema and migrations for database modeling.
- `public/` — Static assets (SVGs, images, etc).
- `sandbox-templates/` — Templates and scripts for sandboxed Next.js environments.

### 2. **Tech Stack**

- **Next.js** (App Router, SSR, API routes)
- **TypeScript** (type safety everywhere)
- **Prisma** (database ORM)
- **Tailwind CSS** (utility-first styling)
- **Shadcn UI** (modern, accessible React components)
- **Framer Motion** (animations)
- **tRPC** (end-to-end typesafe APIs)
- **Inngest** (event-driven serverless workflows)
- **E2B** (sandboxed code execution)
- **LangGraph** (AI agent orchestration with memory)
- **MCP** (Model Context Protocol for tool integration)

### 3. **Agent Memory System**

The AI coding agent features long-term memory powered by LangGraph persistence:
- **Session Isolation**: Each user/project maintains separate memory
- **Context Retention**: Remembers preferences, completed tasks, and project context
- **Automatic Learning**: Recalls user preferences across conversations
- **Smart Recall**: Searches past interactions to answer questions

See the [Agent Memory Guide](docs/AGENT_MEMORY.md) for detailed usage.

### 4. **MCP Integration**

CodeVibe integrates the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to extend the AI coding agent with powerful tools. MCP enables standardized connections to:
- **Next.js Docs** - Official documentation access
- **Playwright** - Browser automation and testing
- **Kubernetes** - Cluster management and monitoring
- **Git** - Version control operations

See the [MCP Integration Guide](docs/MCP_INTEGRATION.md) for setup and usage.

### 4. **Inngest Integration**

CodeVibe uses [Inngest](https://www.inngest.com/) to power event-driven workflows and serverless functions. Inngest enables scalable, reliable background jobs and automation. Learn more about Inngest at [inngest.com](https://www.inngest.com/) or their [GitHub](https://github.com/inngest/inngest-js).

### 6. **Getting Started**

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kaifcoder/codevibe.git
   cd codevibe
   ```
2. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```
3. **Set up the database:**
   ```bash
   npx prisma migrate dev
   ```
4. **Run the development server:**
   ```bash
   npm run dev
   # or
   yarn dev
   ```
5. **Open [http://localhost:3000](http://localhost:3000) in your browser.**

## Contributing

We welcome contributions from developers of all backgrounds and skill levels! To get started:

- Read our [Contributing Guide](CONTRIBUTING.md) (coming soon)
- Check out the [open issues](https://github.com/kaifcoder/codevibe/issues)
- Fork the repo and submit a pull request
- Join discussions and share your ideas

### Areas to Contribute
- UI/UX improvements
- New features and integrations
- Bug fixes and optimizations
- Documentation and tutorials
- Testing and QA

## License

[MIT](LICENSE)

---

**Let's build the future of collaborative coding together!**

For questions or feedback, open an issue or reach out to [@kaifcoder](https://github.com/kaifcoder).
