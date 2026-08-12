# Contributing to Loyal

Thank you for your interest in contributing to Loyal! We're building fully private, on-chain AI infrastructure, and we welcome contributions from the community.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming environment for all contributors

## Ways to Contribute

### 🐛 Report Bugs

Found a bug? Help us fix it:

1. Check [existing issues](https://github.com/loyal/loyal-frontend/issues) to avoid duplicates
2. Create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Browser/environment details

### 💡 Suggest Features

Have an idea? We'd love to hear it:

1. Check [existing discussions](https://github.com/loyal/loyal-frontend/discussions)
2. Open a new discussion explaining:
   - The problem your feature solves
   - How it aligns with Loyal's privacy-first mission
   - Potential implementation approach

### 🔧 Submit Code

Ready to contribute code? Follow these steps:

## Development Setup

### Prerequisites

- Node.js 20+
- Bun (recommended) or npm/yarn/pnpm
- Git
- A Solana wallet for testing

### Getting Started

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/loyal-frontend.git
cd loyal-frontend

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Start development server
bun dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the app.

## Code Standards

This project uses **Ultracite** (Biome preset) for code quality:

```bash
# Auto-fix formatting and linting issues
bun run ultracite fix

# Check for issues without fixing
bun run ultracite check
```

### Key Standards

- **TypeScript**: Use explicit types, avoid `any`
- **React 19**: Function components, proper hook usage
- **Accessibility**: Semantic HTML, ARIA attributes, keyboard navigation
- **Security**: No XSS vulnerabilities, proper input validation
- **Performance**: Optimize images, avoid unnecessary re-renders

See [.claude/CLAUDE.md](.claude/CLAUDE.md) for detailed coding standards.

## Contribution Workflow

### 1. Create a Branch

```bash
# Create a feature branch from main
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/bug-description
```

### 2. Make Changes

- Write clean, documented code
- Follow existing code patterns
- Add comments for complex logic
- Update tests if applicable

### 3. Test Your Changes

```bash
# Run linter
bun run ultracite fix

# Build the project
bun run build

# Test in development
bun dev
```

### 4. Commit Your Changes

We use conventional commits:

```bash
git commit -m "feat: add wallet connection retry logic"
git commit -m "fix: resolve ticker loading issue on first load"
git commit -m "docs: update README with new features"
git commit -m "refactor: simplify encryption key derivation"
```

**Commit types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### 5. Push and Create Pull Request

```bash
# Push your branch
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub with:

- **Clear title** following conventional commits format
- **Description** explaining what and why
- **Screenshots** for UI changes
- **Testing notes** for reviewers
- Link to related issue if applicable

## Pull Request Guidelines

### Requirements

✅ Code follows Ultracite standards (run `bun run ultracite fix`)
✅ No console.log statements in production code
✅ TypeScript compiles without errors
✅ Builds successfully (`bun run build`)
✅ New features include comments/documentation
✅ UI changes are accessible (keyboard navigation, screen readers)
✅ No new security vulnerabilities introduced

### Review Process

1. **Automated checks** run on every PR
2. **Code review** by maintainers
3. **Testing** in staging environment
4. **Approval** and merge by maintainers

We aim to review PRs within 5-7 business days.

## Architecture Overview

```
src/
├── app/              # Next.js app router pages
│   ├── page.tsx     # Landing page
│   ├── chat/        # Chat interface
│   └── api/         # API routes
├── components/      # React components
│   ├── ui/          # Reusable UI components
│   └── kibo-ui/     # Design system components
├── lib/             # Core libraries and transport helpers
├── hooks/           # React hooks
└── data/            # Static content
```

## Key Technologies

- **Next.js 15**: App Router, Server Components
- **React 19**: Latest React features
- **Solana**: web3.js, Anchor, wallet adapters
- **Styling**: Tailwind CSS 4, Framer Motion

## Security Considerations

When contributing, keep in mind:

- **Client-side encryption**: All sensitive data must be encrypted before leaving the client
- **No API key exposure**: Never commit API keys or secrets
- **Input validation**: Always validate and sanitize user input
- **XSS prevention**: Use proper escaping, avoid `dangerouslySetInnerHTML`
- **Dependency security**: We scan with Snyk for vulnerabilities

## License

By contributing to Loyal, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE.md).

This means:
- Your code must be open source
- If you run a modified version on a server, you must make the source available
- All modifications must remain AGPL-3.0

## Questions?

- **Discord**: [discord.askloyal.com](https://discord.askloyal.com)
- **Docs**: [docs.askloyal.com](https://docs.askloyal.com)
- **GitHub Discussions**: For feature proposals and questions

---

Thank you for contributing to Loyal! Together we're building the future of private, on-chain AI. 🚀
