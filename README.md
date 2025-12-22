<div align="center">

# 🛒 stewardPOS

**Modern, Open-Source Point of Sale System**

*Self-hosted • Production-Ready • Docker-First*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [🏗️ Architecture](#️-architecture) • [🤝 Contributing](#-contributing)

---

</div>

## 📑 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
  - [🐳 Docker (Recommended)](#-docker-recommended)
  - [💻 Local Development](#-local-development)
- [📖 Documentation](#-documentation)
- [🏗️ Architecture](#️-architecture)
- [🛠️ Tech Stack](#️-tech-stack)
- [🔐 Security](#-security)
- [📦 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)
- [📊 Project Status](#-project-status)
- [💬 Community & Support](#-community--support)
- [📄 License](#-license)

---

## ✨ Features

### 💰 **Point of Sale**
- ⚡ Fast, intuitive checkout interface
- 📷 Barcode scanning support
- 🎨 Product variants (size, color, SKU)
- 💳 Multiple payment methods
- 🧾 Receipt printing & email
- 👤 Customer lookup & history
- 💰 Discount & promotion management

### 📦 **Inventory Management**
- 📚 Product catalog with categories
- 📊 Real-time stock tracking
- ⚠️ Low stock alerts
- 📥 Bulk import/export (CSV)
- 🖼️ Product images
- 🔄 Variant management

### 👥 **Customer Management**
- 📇 Comprehensive customer database
- 📈 Purchase history tracking
- 📞 Contact information management
- 🏷️ Custom tags and fields
- 💎 Lifetime value tracking

### 🛠️ **Services Module**
- 🔧 Service catalog management
- 📝 Quote generation
- ⏱️ Hourly/flat rate pricing
- 🔄 Quote to order conversion

### 📊 **Reports & Analytics**
- 📈 Sales reports & analytics
- 💵 Revenue tracking
- 🏆 Product performance metrics
- 📤 Export to CSV/PDF
- 📅 Date range filtering
- 📉 Trend analysis

### 🔐 **Security & Access Control**
- 🛡️ Role-based permissions (RBAC)
- 👔 4 built-in roles + custom roles
- 🔒 Granular permissions per module
- 📝 Audit logging
- 🔑 Session management
- 🔐 bcrypt password hashing

### ⚙️ **Production Setup Wizard**
- 🎯 **First-Time Setup** - Guided configuration wizard
- 👤 **Admin Account Creation** - Root user setup
- 🗄️ **Database Configuration** - PostgreSQL or SQLite
- 🔐 **Authentication Setup** - Local, Google OAuth, OIDC
- 🌍 **Environment Configuration** - Dev/Staging/Production
- 🎮 **Demo Mode** - Quick setup with sample data
- 🔄 **Data Replication** - Multi-environment support

### 🔌 **Flexible Architecture**
- 🔌 **Pluggable Adapters** - Swap implementations without code changes
- 🗄️ **Multiple Databases** - ✅ PostgreSQL, ✅ SQLite, IndexedDB
- 🔐 **Auth Providers** - ✅ Local, Google OAuth, OIDC (Azure AD, Okta)
- 📧 **Email Services** - Console, SMTP, Resend
- 💾 **Storage Options** - LocalStorage, S3, Azure Blob
- 📱 **SMS Providers** - Console, Twilio

---

## 🚀 Quick Start

### 🐳 Docker (Recommended)

**The fastest way to get started - includes everything you need!**

```bash
# Clone the repository
git clone https://github.com/yourorg/stewardpos.git
cd stewardpos

# Start all services (PostgreSQL, Backend, Frontend)
docker-compose up -d

# Access the application
# Frontend: http://localhost:8080
# Backend API: http://localhost:3001
```

**First Time Setup:**
1. Visit `http://localhost:8080`
2. Complete the setup wizard:
   - Create your admin account
   - Configure database (or use demo mode)
   - Set authentication methods
   - Choose environment settings
3. Login with your admin credentials

📖 **Full Docker Guide:** [Docker Setup Documentation](DOCKER-SETUP.md)

---

### 💻 Local Development

#### Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Configure environment
cp env.example .env
# Edit .env with your database settings

# Setup database (runs migrations + seeds data)
npm run setup-db

# Start development server
npm run dev
```

**Backend runs at:** `http://localhost:3001`

#### Frontend Setup

```bash
# In project root
npm install

# Start development server
npm run dev
```

**Frontend runs at:** `http://localhost:5173`

#### Default Credentials (Development)

- **Email:** `admin@demo.local`
- **Password:** `DemoPass!1`

⚠️ **Important:** Change these immediately in production!

---

## 📖 Documentation

### 🚀 Getting Started
- **[Setup Wizard Guide](SETUP-WIZARD-DOCUMENTATION.md)** - Production setup wizard
- **[Docker Setup](DOCKER-SETUP.md)** - Complete Docker deployment guide
- **[Quick Start (Backend)](backend/PHASE2-QUICKSTART.md)** - Backend API quick start
- **[Installation Guide](INSTALL.md)** - Step-by-step installation for all platforms

### 📚 User Guides
- **[Configuration Guide](CONFIGURATION.md)** - Complete configuration reference
- **[Code Review Report](CODE-REVIEW-REPORT.md)** - Comprehensive code review findings

### 👨‍💻 Developer Guides
- **[Backend README](backend/README.md)** - Backend API documentation
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute
- **[Testing Guide](backend/TESTING-PHASE2.md)** - Testing documentation
- **[Implementation Guardrail](IMPLEMENTATION-GUARDRAIL.md)** - Development guidelines

### 📋 Architecture & Planning
- **[Phase 0: Inventory](PHASE0-INVENTORY.md)** - Complete codebase inventory
- **[Phase 1: File Mapping](PHASE1-FILE-MAPPING.md)** - File-by-file analysis
- **[Phase 2: Stack Assessment](PHASE2-STACK-ASSESSMENT.md)** - Technology stack evaluation
- **[Phase 3: Path Forward](PHASE3-PATH-FORWARD.md)** - Recommended architecture
- **[Phase 4: Docker & Self-Hosting](PHASE4-DOCKER-SELF-HOSTING.md)** - Deployment strategy
- **[Phase 5: Best Practices](PHASE5-BEST-PRACTICES.md)** - Development, DevOps, Security
- **[Phase 6: Execution Plan](PHASE6-EXECUTION-PLAN.md)** - Step-by-step implementation plan

### 🔒 Security
- **[Security Policy](SECURITY.md)** - Security best practices and reporting

---

## 🏗️ Architecture

stewardPOS uses **Clean Architecture** with the **Ports and Adapters** pattern for maximum flexibility:

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend Layer                        │
│  React 18 + TypeScript • Vite • shadcn/ui • Tailwind   │
├─────────────────────────────────────────────────────────┤
│                    API Layer                             │
│  Express + TypeScript • JWT Auth • Zod Validation       │
├─────────────────────────────────────────────────────────┤
│                 Core Business Logic                      │
│         Domain Models • Ports (Interfaces)              │
├─────────────────────────────────────────────────────────┤
│              Adapters (Pluggable)                        │
│  ┌──────────┬──────────┬──────────┬──────────┐        │
│  │ Database │   Auth    │  Email   │ Storage  │        │
│  ├──────────┼──────────┼──────────┼──────────┤        │
│  │PostgreSQL│  Local    │  SMTP    │   S3    │        │
│  │ SQLite   │  Google  │ Resend   │ Azure   │        │
│  │IndexedDB │  OIDC    │ Console  │ Local   │        │
│  └──────────┴──────────┴──────────┴──────────┘        │
└─────────────────────────────────────────────────────────┘
```

### 🎯 Key Benefits

- ✅ **Swappable Implementations** - Change databases/auth without touching business logic
- ✅ **Easy Testing** - Mock adapters for unit tests
- ✅ **Extensible** - Add new providers by implementing interfaces
- ✅ **Configuration-Driven** - Switch adapters via environment variables
- ✅ **Production-Ready** - Battle-tested patterns

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose | Status |
|------------|---------|--------|
| **React 18** | UI Framework | ✅ Production Ready |
| **TypeScript** | Type Safety | ✅ Production Ready |
| **Vite** | Build Tool | ✅ Production Ready |
| **shadcn/ui** | UI Components | ✅ Production Ready |
| **Tailwind CSS** | Styling | ✅ Production Ready |
| **TanStack Query** | Data Fetching | ✅ Production Ready |
| **React Router** | Routing | ✅ Production Ready |

### Backend
| Technology | Purpose | Status |
|------------|---------|--------|
| **Node.js** | Runtime | ✅ Production Ready |
| **Express** | Web Framework | ✅ Production Ready |
| **TypeScript** | Type Safety | ✅ Production Ready |
| **PostgreSQL** | Database | ✅ Production Ready |
| **SQLite** | Database | ✅ Production Ready |
| **JWT** | Authentication | ✅ Production Ready |
| **bcrypt** | Password Hashing | ✅ Production Ready |
| **Winston** | Logging | ✅ Production Ready |
| **Zod** | Validation | ✅ Production Ready |

### DevOps & Infrastructure
| Technology | Purpose | Status |
|------------|---------|--------|
| **Docker** | Containerization | ✅ Production Ready |
| **Docker Compose** | Orchestration | ✅ Production Ready |
| **Nginx** | Reverse Proxy | ✅ Production Ready |
| **PostgreSQL** | Database Server | ✅ Production Ready |
| **MinIO** | S3 Storage | ✅ Production Ready |

---

## 🔐 Security

Security is our top priority. We follow industry best practices:

### ✅ Implemented Security Features

- 🔐 **bcrypt Password Hashing** - Industry-standard password security
- 🎫 **JWT Authentication** - Secure token-based auth
- 🛡️ **Role-Based Access Control** - Granular permissions
- 📝 **Audit Logging** - Track all system changes
- ✅ **Input Validation** - Zod schema validation
- 🚫 **SQL Injection Prevention** - Parameterized queries
- 🛡️ **XSS Protection** - React's built-in escaping
- 🔒 **Security Headers** - Helmet.js middleware
- ⏱️ **Rate Limiting** - Prevent abuse
- 🔐 **CORS Configuration** - Controlled cross-origin access

### 🚨 Reporting Vulnerabilities

Found a security issue? Please report it privately:

- 📧 **Email:** security@stewardpos.dev
- 🔒 **PGP Key:** [Available on website]

**Do not** open public GitHub issues for security vulnerabilities.

📖 **Full Security Policy:** [SECURITY.md](SECURITY.md)

---

## 📦 Deployment

### 🐳 Docker (Recommended)

**Best for:** Most users, easiest setup

```bash
docker-compose up -d
```

Includes:
- ✅ PostgreSQL database
- ✅ Backend API server
- ✅ Frontend web app
- ✅ MinIO storage
- ✅ Automatic migrations
- ✅ Health checks

📖 **Guide:** [Docker Setup](DOCKER-SETUP.md)

### 🐧 Linux Server

**Best for:** Production deployments, VPS hosting

- Ubuntu 20.04+, Debian 11+, CentOS 8+
- One-command installation script
- systemd service management
- Nginx reverse proxy
- Automated backups

📖 **Guide:** [Installation Guide - Linux](INSTALL.md#linux)

### 🪟 Windows Server

**Best for:** Windows-based infrastructure

- Windows Server 2019+, Windows 10/11
- PowerShell installation script
- Windows Service (NSSM)
- IIS reverse proxy support

📖 **Guide:** [Installation Guide - Windows](INSTALL.md#windows)

### ☁️ Cloud Providers

**Supported Platforms:**
- AWS (EC2, ECS, Lightsail)
- Azure (VM, Container Instances)
- Google Cloud (Compute Engine, Cloud Run)
- DigitalOcean, Linode, Vultr, Hetzner

📖 **Guide:** [Cloud Deployment](docs/deployment/cloud.md)

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### 🎯 Ways to Contribute

- 🐛 **Bug Reports** - Help us find and fix issues
- 💡 **Feature Requests** - Suggest new features
- 📝 **Documentation** - Improve our docs
- 🔧 **Code Contributions** - Submit PRs
- 🌍 **Translations** - Help translate the app
- 🧪 **Testing** - Test and report issues

### 🚀 Quick Contribution Guide

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/stewardpos.git
cd stewardpos

# 2. Install dependencies
npm install
cd backend && npm install && cd ..

# 3. Setup backend database
cd backend
npm run setup-db
cd ..

# 4. Start development servers
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
npm run dev

# 5. Create a feature branch
git checkout -b feature/your-feature-name

# 6. Make changes and test
npm run lint
npm run typecheck

# 7. Commit and push
git commit -m "feat: your feature description"
git push origin feature/your-feature-name

# 8. Open a Pull Request
```

### 📋 Contribution Guidelines

1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Check [open issues](https://github.com/yourorg/stewardpos/issues)
3. Follow our code style (ESLint + Prettier)
4. Write tests for new features
5. Update documentation

---

## 📊 Project Status

### 🎯 Current Version: **v1.0.0-beta**

**Status:** ✅ Production Ready (Beta)

### ✅ Completed Features

- ✅ **Backend API** - Complete REST API with all CRUD operations
- ✅ **Database Layer** - PostgreSQL & SQLite adapters
- ✅ **Authentication** - JWT-based auth with RBAC
- ✅ **Frontend** - React-based POS interface
- ✅ **Inventory Management** - Full product & variant management
- ✅ **Order Processing** - Complete checkout flow
- ✅ **Reports** - Sales analytics and reporting
- ✅ **Setup Wizard** - Production-ready first-time setup
- ✅ **Docker Support** - Full containerization
- ✅ **Security** - Industry-standard security practices

### 🔄 In Progress

- 🔄 Additional authentication providers (Google, OIDC)
- 🔄 Advanced reporting features
- 🔄 Mobile-responsive improvements
- 🔄 Performance optimizations

### 📋 Planned Features

- 📋 Automated testing suite expansion
- 📋 API documentation (Swagger/OpenAPI)
- 📋 Mobile app (iOS/Android)
- 📋 Offline-first PWA
- 📋 Multi-location support
- 📋 Third-party integrations (QuickBooks, Xero)
- 📋 Plugin marketplace

---

## 💬 Community & Support

### 📞 Get Help

- 💬 **Discord:** [Join our community](https://discord.gg/stewardpos)
- 🐛 **GitHub Issues:** [Report bugs](https://github.com/yourorg/stewardpos/issues)
- 💡 **Discussions:** [Ask questions](https://github.com/yourorg/stewardpos/discussions)
- 📧 **Email:** support@stewardpos.dev

### 📱 Follow Us

- 🐦 **Twitter:** [@StewardPOS](https://twitter.com/StewardPOS)
- 📺 **YouTube:** [Tutorials & Demos](https://youtube.com/@stewardpos)
- 📰 **Blog:** [Latest updates](https://blog.stewardpos.dev)

---

## 📄 License

This project is licensed under the **MIT License**.

See [LICENSE](LICENSE) for the full license text.

**TL;DR:** 
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Private use
- ✅ Patent use
- ❌ No liability
- ❌ No warranty

---

## 🙏 Acknowledgments

Built with amazing open-source technologies:

- [React](https://react.dev/) - UI Framework
- [TypeScript](https://www.typescriptlang.org/) - Type Safety
- [Vite](https://vitejs.dev/) - Build Tool
- [shadcn/ui](https://ui.shadcn.com/) - UI Components
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Node.js](https://nodejs.org/) - Runtime
- [Express](https://expressjs.com/) - Web Framework

**Special thanks to all our [contributors](https://github.com/yourorg/stewardpos/graphs/contributors)!**

---

<div align="center">

### ⭐ Star us on GitHub if you find this project useful!

**Made with ❤️ by the stewardPOS community**

[Website](https://stewardpos.dev) • [Documentation](https://docs.stewardpos.dev) • [Demo](https://demo.stewardpos.dev) • [Discord](https://discord.gg/stewardpos)

---

[⬆ Back to Top](#-stewardpos)

</div>
