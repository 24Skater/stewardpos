# Persona POS (Steward POS)

**Open-source, self-hosted Point of Sale system for small to medium businesses.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](docker-compose.yml)

---

## 🎯 Overview

Persona POS is a modern, production-ready point of sale system that you can run on your own servers. No vendor lock-in, no monthly fees, complete control over your data.

**Perfect for:**
- Retail stores
- Restaurants & cafes
- Service businesses
- Small to medium enterprises
- Anyone who wants to own their POS system

---

## ✨ Features

### 💰 Point of Sale
- Fast, intuitive checkout interface
- Barcode scanning support
- Product variants (size, color)
- Multiple payment methods
- Receipt printing & email
- Customer lookup
- Discount management

### 📦 Inventory Management
- Product catalog with categories
- Stock tracking
- Low stock alerts
- Bulk import/export (CSV)
- Product images
- Variant management

### 👥 Customer Management
- Customer database
- Purchase history
- Contact information
- Custom fields

### 🛠️ Services Module
- Service catalog
- Quote generation
- Hourly/flat rate pricing
- Quote to order conversion

### 📊 Reports & Analytics
- Sales reports
- Revenue analytics
- Product performance
- Export to CSV/PDF
- Date range filtering

### 🔐 Security & Access Control
- Role-based permissions (RBAC)
- 4 built-in roles + custom roles
- Granular permissions per module
- Audit logging
- Session management
- bcrypt password hashing

### 🔌 Flexible Architecture
- **Pluggable adapters** - swap databases, auth providers, email services
- **Multiple database options** - IndexedDB (browser), SQLite, PostgreSQL
- **Authentication options** - Local, Google OAuth, OIDC (Azure AD, Okta)
- **Email providers** - Console (dev), SMTP, Resend
- **Storage options** - LocalStorage, S3, Azure Blob
- **SMS providers** - Console (dev), Twilio

---

## 🚀 Quick Start

### One-Command Installation

**Linux (Ubuntu/Debian/CentOS/RHEL):**
```bash
curl -fsSL https://raw.githubusercontent.com/yourorg/persona-pos/main/install-linux.sh | bash
```

**Windows (PowerShell as Administrator):**
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/yourorg/persona-pos/main/install-windows.ps1'))
```

**Docker:**
```bash
git clone https://github.com/yourorg/persona-pos.git
cd persona-pos
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

**Default Login:**
- Email: `admin@example.com`
- Password: `admin123`
- ⚠️ **Change immediately after first login!**

📖 **Full installation guide:** [INSTALL.md](INSTALL.md)

---

## 📋 System Requirements

**Minimum:**
- 2 CPU cores
- 2 GB RAM
- 10 GB disk space
- Ubuntu 20.04+, Debian 11+, CentOS 8+, Windows Server 2019+, or Windows 10/11

**Recommended:**
- 4+ CPU cores
- 4+ GB RAM
- 50+ GB SSD
- Ubuntu 22.04 LTS or Windows Server 2022

---

## 🛠️ Tech Stack

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- shadcn/ui (UI components)
- Tailwind CSS
- TanStack Query
- React Router

**Backend:**
- Node.js + Express (planned)
- TypeScript
- PostgreSQL / SQLite
- Redis (sessions)
- JWT authentication

**Architecture:**
- Clean Architecture (Hexagonal)
- Ports and Adapters pattern
- Dependency Injection
- Configuration-driven

---

## 📚 Documentation

- **[Installation Guide](INSTALL.md)** - Step-by-step installation for Linux, Windows, and Docker
- **[Configuration Guide](CONFIGURATION.md)** - Complete configuration reference
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute to the project
- **[Security Policy](SECURITY.md)** - Security best practices and reporting
- **[Development Roadmap](ROADMAP.md)** - Future plans and timeline

---

## 🗺️ Development Roadmap

We're actively working towards a production-ready v1.0 release. See our [detailed roadmap](ROADMAP.md) for the complete plan.

**Current Status:** Beta (v0.9.x)

**v1.0 Goals (Target: Q2 2025):**
- ✅ Complete backend API
- ✅ PostgreSQL & SQLite adapters
- ✅ Database migrations
- ✅ One-command installers
- ✅ Production hardening
- ✅ Comprehensive documentation
- ✅ Automated testing

**Future Plans:**
- Mobile app (iOS/Android)
- Offline-first PWA
- Multi-location support
- Advanced reporting
- Third-party integrations (QuickBooks, Xero)
- Plugin marketplace

---

## 🤝 Contributing

We welcome contributions! Whether it's:
- 🐛 Bug reports
- 💡 Feature requests
- 📝 Documentation improvements
- 🔧 Code contributions
- 🌍 Translations

**Get started:**
1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Check [open issues](https://github.com/yourorg/persona-pos/issues)
3. Join our [Discord community](https://discord.gg/persona-pos)

**Quick contribution guide:**
```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/persona-pos.git
cd persona-pos

# Install dependencies
npm install

# Create a branch
git checkout -b feature/your-feature-name

# Make changes and test
npm run dev
npm run lint
npm run typecheck

# Commit and push
git commit -m "feat: your feature description"
git push origin feature/your-feature-name

# Open a Pull Request
```

---

## 🏗️ Architecture

Persona POS uses **Clean Architecture** with the **Ports and Adapters** pattern:

```
┌─────────────────────────────────────────────┐
│           Frontend (React)                  │
├─────────────────────────────────────────────┤
│           Backend API (Express)             │
├─────────────────────────────────────────────┤
│         Core Business Logic                 │
│         (Domain Models & Ports)             │
├─────────────────────────────────────────────┤
│              Adapters                       │
│  ┌──────────┬──────────┬──────────────┐   │
│  │ Database │   Auth   │    Email     │   │
│  │          │          │              │   │
│  │ • IndexDB│ • Local  │ • Console    │   │
│  │ • Postgres│ • Google │ • SMTP      │   │
│  │ • SQLite │ • OIDC   │ • Resend    │   │
│  └──────────┴──────────┴──────────────┘   │
└─────────────────────────────────────────────┘
```

**Benefits:**
- Swap implementations without changing business logic
- Easy to test and maintain
- Add new providers by implementing interfaces
- Configuration-driven (no code changes)

---

## 🔐 Security

Security is a top priority. We follow industry best practices:

- ✅ bcrypt password hashing
- ✅ JWT authentication
- ✅ Role-based access control
- ✅ Audit logging
- ✅ Input validation (Zod)
- ✅ SQL injection prevention
- ✅ XSS protection
- ✅ Security headers
- ✅ Rate limiting

**Found a vulnerability?** Please report it privately to security@persona-pos.dev

See [SECURITY.md](SECURITY.md) for details.

---

## 📦 Deployment Options

### 1. Linux Server (Recommended)
- Ubuntu, Debian, CentOS, RHEL
- One-command installation
- systemd service
- Nginx reverse proxy
- [Full guide](INSTALL.md#linux)

### 2. Windows Server
- Windows Server 2019+, Windows 10/11
- PowerShell installation script
- Windows Service (NSSM)
- [Full guide](INSTALL.md#windows)

### 3. Docker
- Docker Compose setup
- Includes PostgreSQL, Redis, MinIO
- Easy scaling
- [Full guide](INSTALL.md#docker)

### 4. Cloud Providers
- AWS, Azure, Google Cloud
- DigitalOcean, Linode, Vultr
- Deploy as VPS or container
- [Cloud deployment guide](docs/deployment/cloud.md)

---

## 💬 Community & Support

- 💬 **Discord:** [Join our community](https://discord.gg/persona-pos)
- 🐛 **Issues:** [GitHub Issues](https://github.com/yourorg/persona-pos/issues)
- 💡 **Discussions:** [GitHub Discussions](https://github.com/yourorg/persona-pos/discussions)
- 📧 **Email:** support@persona-pos.dev
- 🐦 **Twitter:** [@PersonaPOS](https://twitter.com/PersonaPOS)

---

## 📄 License

This project is licensed under the **MIT License** - see [LICENSE](LICENSE) for details.

**TL;DR:** You can use this software for free, modify it, and even sell it. Just keep the copyright notice.

---

## 🙏 Acknowledgments

Built with amazing open-source technologies:
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [Node.js](https://nodejs.org/)

Special thanks to all our [contributors](https://github.com/yourorg/persona-pos/graphs/contributors)!

---

## 🌟 Star History

If you find this project useful, please consider giving it a star! ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=yourorg/persona-pos&type=Date)](https://star-history.com/#yourorg/persona-pos&Date)

---

## 📊 Project Status

- **Version:** 0.9.x (Beta)
- **Status:** Active Development
- **Target v1.0:** Q2 2025
- **Production Ready:** Not yet (see [roadmap](ROADMAP.md))

---

**Made with ❤️ by the Persona POS community**

[Website](https://persona-pos.dev) • [Documentation](https://docs.persona-pos.dev) • [Demo](https://demo.persona-pos.dev)
