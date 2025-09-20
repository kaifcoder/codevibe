# Contributing to CodeVibe

Thank you for your interest in contributing to CodeVibe! We welcome contributions from developers of all backgrounds and skill levels. This guide will help you get started with contributing to our project.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Git
- Basic knowledge of TypeScript, React, and Next.js

### Setting up the Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/codevibe.git
   cd codevibe
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up the database**:
   ```bash
   npx prisma migrate dev
   ```
5. **Start the development server**:
   ```bash
   npm run dev
   ```
6. **Open [http://localhost:3000](http://localhost:3000)** in your browser

## 🎯 Areas to Contribute

We welcome contributions in various areas:

- **UI/UX improvements**: Enhance the user interface and experience
- **New features and integrations**: Add functionality that benefits users
- **Bug fixes and optimizations**: Help make CodeVibe more stable and performant
- **Documentation and tutorials**: Improve guides, docs, and examples
- **Testing and QA**: Add tests and help identify issues
- **Accessibility**: Make CodeVibe more accessible to all users
- **Performance**: Optimize loading times and resource usage

## 📋 How to Contribute

### 1. Find an Issue

- Browse our [open issues](https://github.com/kaifcoder/codevibe/issues)
- Look for issues labeled `good first issue` if you're new to the project
- Check for issues labeled `help wanted` for areas where we need assistance

### 2. Create a Feature Request

If you have an idea for a new feature:

1. Check if a similar feature request already exists
2. Open a new issue with the `feature request` label
3. Describe the feature, its benefits, and potential implementation approach
4. Wait for maintainer feedback before starting work

### 3. Submit a Pull Request

1. **Create a new branch** for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes** following our coding standards:
   - Write clear, readable code
   - Follow existing code patterns and conventions
   - Add comments for complex logic
   - Ensure your code is properly typed (TypeScript)

3. **Test your changes**:
   ```bash
   npm run lint
   npm run build
   ```

4. **Commit your changes** with a clear message:
   ```bash
   git add .
   git commit -m "feat: add new collaborative editing feature"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Fill out the PR template completely
   - Reference any related issues
   - Add screenshots for UI changes
   - Request review from maintainers

## 🔧 Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing naming conventions
- Use meaningful variable and function names
- Keep functions small and focused
- Use existing ESLint and Prettier configurations

### Component Guidelines

- Use functional components with hooks
- Follow React best practices
- Use Tailwind CSS for styling (no custom CSS files)
- Utilize Shadcn UI components when possible
- Make components accessible (ARIA attributes, keyboard navigation)

### File Structure

- Place new components in `src/components/`
- Add utilities to `src/lib/`
- Follow the existing directory structure
- Use kebab-case for file names
- Use PascalCase for component names

### Commit Messages

Use conventional commits format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `style:` for formatting changes
- `refactor:` for code refactoring
- `test:` for adding tests
- `chore:` for maintenance tasks

## 🧪 Testing

- Add tests for new features when possible
- Ensure existing tests pass: `npm test`
- Test your changes manually in the browser
- Test on different screen sizes and devices

## 📚 Documentation

- Update README.md if you add new features
- Add JSDoc comments for complex functions
- Update relevant documentation files
- Include examples in your documentation

## 🐛 Reporting Bugs

When reporting bugs, please include:

1. **Bug description**: Clear description of the issue
2. **Steps to reproduce**: Step-by-step instructions
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Screenshots**: If applicable
6. **Environment**: OS, browser, Node.js version
7. **Additional context**: Any other relevant information

## 💬 Getting Help

- Join discussions in our [GitHub issues](https://github.com/kaifcoder/codevibe/issues)
- Reach out to [@kaifcoder](https://github.com/kaifcoder) for questions
- Check existing documentation and setup guides

## 📜 Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to ensure a welcoming environment for all contributors.

## 🙏 Recognition

All contributors will be recognized in our project. We appreciate every contribution, no matter how small!

## 📄 License

By contributing to CodeVibe, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

**Thank you for contributing to CodeVibe! Together, we're building the future of collaborative coding.** 🎉