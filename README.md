<div align="center">
  <img src="branding/svg/stewardpos-logo-lockup.svg" alt="StewardPOS Logo" width="400">
</div>

# StewardPOS

**StewardPOS is an open-source POS built originally for a church use case.** A modern, production-ready point of sale system that you can run on your own servers. No vendor lock-in, no monthly fees, complete control over your data.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](docker-compose.yml)

---

## 🔗 Quick Links

- **[Website](https://stewardpos.dev)** *(Coming Soon)*
- **[Documentation](https://docs.stewardpos.dev)** *(Coming Soon)*
- **[Demo](https://demo.stewardpos.dev)** *(Coming Soon)*
- **[GitHub Issues](https://github.com/24Skater/stewardpos/issues)** - Report bugs or request features
- **[Branding Guidelines](branding/README.md)** - Logo usage and brand assets

---

## 🎯 Overview

StewardPOS is a modern, production-ready point of sale system that you can run on your own servers. No vendor lock-in, no monthly fees, complete control over your data.

**Perfect for:**
- Churches and faith-based organizations
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
- **Multiple database options** - ✅ SQLite (production-ready), ✅ PostgreSQL (production-ready), IndexedDB (browser)
- **Authentication options** - ✅ Local (production-ready), Google OAuth, OIDC (Azure AD, Okta)
- **Email providers** - Console (dev), SMTP, Resend
- **Storage options** - LocalStorage, S3, Azure Blob
- **SMS providers** - Console (dev), Twilio

### 🎯 Development Status
- ✅ **Phase 1**: Backend API Foundation (Complete)
- ✅ **Phase 2**: Database Implementation (Complete)
  - PostgreSQL & SQLite adapters fully functional
  - Complete CRUD operations for all entities
  - Migrations and seed data
  - Full API integration
- 🔄 **Phase 3**: Installation & Deployment (In Progress)

---

## 🚀 Quick Start

### Backend API (5 minutes)

```bash
# Clone the repository
git clone https://github.com/24Skater/stewardpos.git
cd stewardpos/backend

# Install dependencies
npm install

# Configure environment
cp env.example .env
# Edit .env (SQLite works out of the box)

# Setup database (migrations + seed data)
npm run setup-db

# Start the server
npm run dev
```

Server runs at: `http://localhost:3001`

**Default Login:**
- Email: `admin@example.com`
- Password: `admin123`
- ⚠️ **Change immediately after first login!**

### Frontend (Development)

```bash
# In the project root
npm install
npm run dev
```

Frontend runs at: `http://localhost:5173`

### Docker (Full Stack)

```bash
git clone https://github.com/24Skater/stewardpos.git
cd stewardpos
docker-compose up -d
```

📖 **Full guides:** [Backend Quick Start](backend/PHASE2-QUICKSTART.md) | [Installation Guide](INSTALL.md)

---

## 🔌 API Endpoints

The backend API is fully functional with the following endpoints:

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/session` - Get current session
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh JWT token

### Products
- `GET /api/products` - List all products with variants
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create new product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `GET /api/orders` - List all orders
- `GET /api/orders/:id` - Get order with items
- `POST /api/orders` - Create new order

### Customers
- `GET /api/customers` - List all customers
- `POST /api/customers` - Create new customer

### Health
- `GET /api/health` - API health check

📖 **Full API documentation:** [Backend README](backend/README.md) | [Testing Guide](backend/TESTING-PHASE2.md)

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
- ✅ Node.js + Express
- ✅ TypeScript
- ✅ PostgreSQL / SQLite (production-ready)
- ✅ JWT authentication
- ✅ bcrypt password hashing
- Winston logging
- Redis (sessions - planned)

**Architecture:**
- Clean Architecture (Hexagonal)
- Ports and Adapters pattern
- Dependency Injection
- Configuration-driven

---

## 📚 Documentation

### User Guides
- **[Installation Guide](INSTALL.md)** - Step-by-step installation for Linux, Windows, and Docker
- **[Configuration Guide](CONFIGURATION.md)** - Complete configuration reference
- **[Quick Start](backend/PHASE2-QUICKSTART.md)** - Get started in 5 minutes

### Developer Guides
- **[Backend README](backend/README.md)** - Backend API documentation
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute to the project
- **[Development Roadmap](ROADMAP.md)** - Future plans and timeline
- **[Testing Guide](backend/TESTING-PHASE2.md)** - How to test the application

### Reference
- **[Security Policy](SECURITY.md)** - Security best practices and reporting
- **[Changelog](CHANGELOG.md)** - Version history and changes
- **[Phase 2 Complete](PHASE2-COMPLETE.md)** - Database implementation details
- **[Branding Guidelines](branding/README.md)** - Logo usage, colors, typography, and brand assets

---

## 🗺️ Development Roadmap

We're actively working towards a production-ready v1.0 release. See our [detailed roadmap](ROADMAP.md) for the complete plan.

**Current Status:** Beta (v0.9.x) - ~40% complete to v1.0

**Completed (Phase 1 & 2):**
- ✅ Backend API foundation (Express + TypeScript)
- ✅ PostgreSQL & SQLite adapters (production-ready)
- ✅ Database migrations system
- ✅ Authentication (JWT + bcrypt)
- ✅ Products, Orders, Customers APIs
- ✅ Seed data and setup scripts
- ✅ Security hardening (rate limiting, input validation)
- ✅ Comprehensive documentation

**In Progress (Phase 3):**
- 🔄 One-command installers (Linux/Windows)
- 🔄 Docker improvements
- 🔄 Backup utilities
- 🔄 API documentation (Swagger)

**Planned (Phase 4-7):**
- 📋 Automated testing suite
- 📋 Frontend-backend integration
- 📋 Production deployment guides
- 📋 Performance optimization

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
2. Check [open issues](https://github.com/24Skater/stewardpos/issues)
3. Join our [Discord community](https://discord.gg/stewardpos)

**Quick contribution guide:**
```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/stewardpos.git
cd stewardpos

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Setup backend database
npm run setup-db

# Start backend (in backend/)
npm run dev

# Start frontend (in root)
cd ..
npm run dev

# Create a branch
git checkout -b feature/your-feature-name

# Make changes and test
npm run lint
npm run typecheck

# Commit and push
git commit -m "feat: your feature description"
git push origin feature/your-feature-name

# Open a Pull Request
```

---

## 🏗️ Architecture

StewardPOS uses **Clean Architecture** with the **Ports and Adapters** pattern:

```
┌─────────────────────────────────────────────┐
│           Frontend (React)                  │
│     • Vite + TypeScript                     │
│     • shadcn/ui + Tailwind                  │
├─────────────────────────────────────────────┤
│           Backend API (Express)             │
│     • Node.js + TypeScript                  │
│     • JWT Authentication                    │
│     • Input Validation (Zod)                │
├─────────────────────────────────────────────┤
│         Core Business Logic                 │
│         (Domain Models & Ports)             │
├─────────────────────────────────────────────┤
│              Adapters (Pluggable)           │
│  ┌──────────┬──────────┬──────────────┐   │
│  │ Database │   Auth   │    Email     │   │
│  │          │          │              │   │
│  │ ✅ Postgres│ ✅ Local │ • Console   │   │
│  │ ✅ SQLite  │ • Google │ • SMTP      │   │
│  │ • IndexDB│ • OIDC   │ • Resend    │   │
│  └──────────┴──────────┴──────────────┘   │
└─────────────────────────────────────────────┘

✅ = Production Ready
• = Planned
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

**Found a vulnerability?** Please report it privately to security@stewardpos.dev

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

- 💬 **Discord:** [Join our community](https://discord.gg/stewardpos)
- 🐛 **Issues:** [GitHub Issues](https://github.com/24Skater/stewardpos/issues)
- 💡 **Discussions:** [GitHub Discussions](https://github.com/24Skater/stewardpos/discussions)
- 📧 **Email:** support@stewardpos.dev
- 🐦 **Twitter:** [@StewardPOS](https://twitter.com/StewardPOS)

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

Special thanks to all our [contributors](https://github.com/24Skater/stewardpos/graphs/contributors)!

---

## 🌟 Star History

If you find this project useful, please consider giving it a star! ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=24Skater/stewardpos&type=Date)](https://star-history.com/#24Skater/stewardpos&Date)

---

## 📊 Project Status

- **Version:** 0.9.x (Beta)
- **Status:** Active Development
- **Progress:** ~40% to v1.0
- **Target v1.0:** Q2 2025
- **Backend API:** ✅ Production Ready
- **Database Layer:** ✅ Production Ready
- **Frontend:** 🔄 In Development
- **Deployment:** 🔄 In Progress

### What's Working Now
- ✅ Complete backend API with PostgreSQL/SQLite
- ✅ Authentication and authorization
- ✅ Product, order, and customer management
- ✅ Database migrations and seed data
- ✅ Security features (JWT, bcrypt, rate limiting)
- ✅ Comprehensive API documentation

### What's Next
- 🔄 Automated installation scripts
- 🔄 Frontend-backend integration
- 🔄 Complete testing suite
- 🔄 Production deployment guides

---

**Made with ❤️ by the StewardPOS community**

[Website](https://stewardpos.dev) • [Documentation](https://docs.stewardpos.dev) • [Demo](https://demo.stewardpos.dev)
