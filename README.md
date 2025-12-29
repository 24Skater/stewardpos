<div align="center">

<!-- Hero Section -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=200&section=header&text=stewardPOS&fontSize=80&fontAlignY=35&animation=twinkling&fontColor=ffffff&desc=Modern%20Point%20of%20Sale%20System&descAlignY=55&descSize=20" width="100%"/>

<p align="center">
  <b>Self-Hosted • Open Source • Docker-First • Production Ready</b>
</p>

<!-- Badges -->
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-6366f1?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="License"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Version-1.0.0-22c55e?style=for-the-badge&logo=semver&logoColor=white" alt="Version"/></a>
  <a href="docker-compose.yml"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/></a>
  <a href="#"><img src="https://img.shields.io/badge/PRs-Welcome-ec4899?style=for-the-badge&logo=github&logoColor=white" alt="PRs Welcome"/></a>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind"/></a>
</p>

<!-- Navigation -->
<p align="center">
  <a href="#-quick-start"><b>🚀 Quick Start</b></a> •
  <a href="#-features"><b>✨ Features</b></a> •
  <a href="#-branding--customization"><b>🎨 Branding</b></a> •
  <a href="#-documentation"><b>📖 Docs</b></a> •
  <a href="#-deployment"><b>📦 Deploy</b></a> •
  <a href="#-contributing"><b>🤝 Contribute</b></a>
</p>

<br/>

<!-- Demo Preview -->
<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" width="100%"/>

<table>
<tr>
<td width="50%">

### 💳 Modern POS Interface
Fast, intuitive checkout with barcode scanning, variants, and real-time inventory

</td>
<td width="50%">

### 📊 Analytics Dashboard
Comprehensive reports, sales tracking, and business insights

</td>
</tr>
</table>

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" width="100%"/>

</div>

<br/>

## 📑 Table of Contents

<details open>
<summary><b>Click to expand</b></summary>

- [🚀 Quick Start](#-quick-start)
  - [Docker (Recommended)](#-docker-recommended)
  - [Local Development](#-local-development)
- [✨ Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🛠️ Tech Stack](#️-tech-stack)
- [📖 Documentation](#-documentation)
- [📦 Deployment](#-deployment)
- [🎨 Branding & Customization](#-branding--customization)
- [🔐 Security](#-security)
- [🤝 Contributing](#-contributing)
- [📊 Roadmap](#-roadmap)
- [📄 License](#-license)

</details>

<br/>

---

<br/>

## 🚀 Quick Start

### 🐳 Docker (Recommended)

The fastest way to get started - everything you need in one command!

```bash
# Clone the repository
git clone https://github.com/yourorg/stewardpos.git
cd stewardpos

# Start all services
docker-compose up -d

# 🎉 That's it! Open http://localhost:8080
```

<details>
<summary><b>📋 First Time Setup</b></summary>

1. Open `http://localhost:8080`
2. Complete the setup wizard:
   - Create admin account
   - Configure database
   - Set authentication methods
3. Login with your credentials
4. Start selling!

**Default Demo Credentials:**
```
Email: admin@demo.local
Password: admin123
```

</details>

<br/>

### 💻 Local Development

<details>
<summary><b>Backend Setup</b></summary>

```bash
cd backend
npm install
cp env.example .env    # Configure your settings
npm run setup-db       # Run migrations
npm run dev            # Start server at :3001
```

</details>

<details>
<summary><b>Frontend Setup</b></summary>

```bash
npm install
npm run dev            # Start dev server at :5173
```

</details>

<br/>

---

<br/>

## ✨ Features

<table>
<tr>
<td width="33%" valign="top">

### 💰 Point of Sale
- ⚡ Fast checkout interface
- 📷 Barcode scanning
- 🎨 Product variants
- 💳 Multiple payment methods
- 🧾 Receipt printing/email
- 💰 Discounts & promotions
- 🔄 Quick returns from POS

</td>
<td width="33%" valign="top">

### 📦 Inventory
- 📚 Product catalog
- 📊 Real-time stock tracking
- ⚠️ Low stock alerts
- 📥 CSV import/export
- 🖼️ Product images
- 🔄 Variant management

</td>
<td width="33%" valign="top">

### 👥 Customers
- 📇 Customer database
- 📈 Purchase history
- 📞 Contact management
- 🏷️ Tags & custom fields
- 💎 Lifetime value
- 📧 Email notifications

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 📊 Reports & Exports
- 📈 Sales & service analytics
- 💵 Revenue tracking
- 🏆 Product performance
- 📤 Export PDF/Excel/CSV
- 📅 Date filtering
- 📉 Trend analysis

</td>
<td width="33%" valign="top">

### 🔐 Security
- 🛡️ Role-based access (RBAC)
- 👔 Custom roles
- 🔒 Granular permissions
- 📝 Audit logging
- 🔑 API key management
- 🔐 bcrypt hashing

</td>
<td width="33%" valign="top">

### 🛠️ Services
- 🔧 Service catalog
- 📝 Quote generation
- ⏱️ Flexible pricing
- 🔄 Quote → Order workflow
- 📋 Customer booking
- 📅 Scheduling

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🎨 Branding
- 🏪 Store identity config
- 🎨 Custom brand colors
- 📷 Logo everywhere
- 🧾 Receipt customization
- 📝 Custom header/footer
- 🌈 Live color preview

</td>
<td width="33%" valign="top">

### 💸 Discounts & Promos
- 🏷️ Quick discount buttons
- 🎟️ Promo code system
- 👔 Employee discounts
- ✍️ Manual discounts
- 📊 Usage tracking
- 🔒 Approval workflow

</td>
<td width="33%" valign="top">

### 🔄 Returns & Refunds
- 🧾 Receipt lookup
- 📦 Item-level returns
- 💵 Multiple refund methods
- ⚡ Quick POS returns
- 📝 Return reasons
- 🔄 Auto restock option

</td>
</tr>
</table>

<br/>

---

<br/>

## 🏗️ Architecture

stewardPOS uses **Clean Architecture** with the **Ports and Adapters** pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│       React 18  •  TypeScript  •  Vite  •  shadcn/ui            │
├─────────────────────────────────────────────────────────────────┤
│                           API                                    │
│          Express  •  JWT Auth  •  Zod Validation                │
├─────────────────────────────────────────────────────────────────┤
│                      BUSINESS LOGIC                              │
│              Domain Models  •  Use Cases  •  Ports              │
├─────────────────────────────────────────────────────────────────┤
│                    ADAPTERS (Pluggable)                          │
│  ┌────────────┬────────────┬────────────┬────────────┐          │
│  │  Database  │    Auth    │   Email    │  Storage   │          │
│  ├────────────┼────────────┼────────────┼────────────┤          │
│  │ PostgreSQL │   Local    │   SMTP     │    S3      │          │
│  │   SQLite   │   Google   │  Resend    │   Azure    │          │
│  │ IndexedDB  │   OIDC     │  Console   │   Local    │          │
│  └────────────┴────────────┴────────────┴────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

<details>
<summary><b>🎯 Why This Architecture?</b></summary>

| Benefit | Description |
|---------|-------------|
| **Swappable** | Change databases/auth without touching business logic |
| **Testable** | Mock adapters for comprehensive unit tests |
| **Extensible** | Add new providers by implementing interfaces |
| **Configurable** | Switch adapters via environment variables |

</details>

<br/>

---

<br/>

## 🛠️ Tech Stack

<table>
<tr>
<td valign="top" width="50%">

### Frontend
| Tech | Purpose |
|------|---------|
| ![React](https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black) | UI Framework |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | Type Safety |
| ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) | Build Tool |
| ![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) | Styling |
| ![shadcn/ui](https://img.shields.io/badge/shadcn/ui-000000?style=flat-square&logo=shadcnui&logoColor=white) | Components |

</td>
<td valign="top" width="50%">

### Backend
| Tech | Purpose |
|------|---------|
| ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white) | Runtime |
| ![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white) | Framework |
| ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) | Database |
| ![JWT](https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white) | Auth |
| ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white) | Container |

</td>
</tr>
</table>

<br/>

---

<br/>

## 📖 Documentation

<table>
<tr>
<td width="50%">

### 🚀 Getting Started
- [Setup Wizard Guide](ENVIRONMENT-SETUP.md)
- [Demo Quick Start](README-DEMO.md)
- [Deployment Guide](DEPLOYMENT.md)

### 👨‍💻 Development
- [Backend README](backend/README.md)
- [Component Management](COMPONENT-MANAGEMENT.md)
- [Code Review](CODE-REVIEW-SUMMARY.md)

</td>
<td width="50%">

### 📚 API Reference
- Products API: `/api/products`
- Orders API: `/api/orders`
- Customers API: `/api/customers`
- Services API: `/api/services`
- Quotes API: `/api/quotes`
- Returns API: `/api/returns`
- Discounts API: `/api/discounts`
- Receipts API: `/api/receipts`
- Admin API: `/api/admin/*`
- API Keys: `/api/admin/api-keys`

### 🔧 Configuration
- Environment variables: `.env`
- Docker config: `docker-compose.yml`

</td>
</tr>
</table>

<br/>

---

<br/>

## 📦 Deployment

<table>
<tr>
<td align="center" width="25%">

### 🐳 Docker
**Recommended**

```bash
docker-compose up -d
```

[📖 Guide](DEPLOYMENT.md)

</td>
<td align="center" width="25%">

### 🐧 Linux
Ubuntu • Debian • CentOS

systemd service
nginx proxy

[📖 Guide](DEPLOYMENT.md#linux)

</td>
<td align="center" width="25%">

### 🪟 Windows
Server 2019+ • Win10/11

PowerShell script
IIS support

[📖 Guide](DEPLOYMENT.md#windows)

</td>
<td align="center" width="25%">

### ☁️ Cloud
AWS • Azure • GCP
DigitalOcean • more

Container ready
Auto-scaling

[📖 Guide](DEPLOYMENT.md#cloud)

</td>
</tr>
</table>

<br/>

---

<br/>

## 🎨 Branding & Customization

Make stewardPOS your own with comprehensive branding options:

<table>
<tr>
<td width="50%">

### 🏪 Store Identity
Configure your business details that appear across the system:
- **Store Name** - Displayed in POS header
- **Store Number** - For multi-location tracking
- **Contact Info** - Phone, email
- **Address** - Full location details

### 🎨 Visual Branding
- **Logo** - Appears in POS header
- **Favicon** - Browser tab icon
- **Brand Color** - Applied to buttons, links, accents
- **Live Preview** - See changes instantly!

</td>
<td width="50%">

### 🧾 Receipt Customization
Create professional, branded receipts:
- **Receipt Logo** - Separate from main logo
- **Store Info** - Name, address, phone
- **Header Message** - Welcome text
- **Footer Message** - Return policy, social media
- **Barcode** - For easy scanning
- **Print & Email** - Multiple delivery options

### 🌈 Theme Support
Brand color automatically updates:
- Primary buttons
- Links and accents
- Focus rings
- Gradients and glows

</td>
</tr>
</table>

> **Tip:** Go to **Admin → Branding** to customize all these options with a live preview!

<br/>

---

<br/>

## 🔐 Security

<table>
<tr>
<td width="50%">

### ✅ Security Features
- 🔐 bcrypt password hashing
- 🎫 JWT authentication
- 🛡️ Role-based access control
- 📝 Complete audit logging
- ✅ Zod schema validation
- 🚫 SQL injection prevention
- 🛡️ XSS protection
- 🔒 Security headers (Helmet)
- ⏱️ Rate limiting
- 🔐 CORS configuration

</td>
<td width="50%">

### 🚨 Report Vulnerabilities

Found a security issue? Please report privately:

📧 **Email:** security@stewardpos.dev

**Do not** open public issues for security vulnerabilities.

See [SECURITY.md](SECURITY.md) for details.

</td>
</tr>
</table>

<br/>

---

<br/>

## 🤝 Contributing

We welcome contributions! Here's how to get started:

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/stewardpos.git

# 2. Install dependencies
npm install && cd backend && npm install

# 3. Create a branch
git checkout -b feature/amazing-feature

# 4. Make changes, then commit
git commit -m "feat: add amazing feature"

# 5. Push and open a PR
git push origin feature/amazing-feature
```

<details>
<summary><b>📋 Contribution Guidelines</b></summary>

1. Check [open issues](https://github.com/yourorg/stewardpos/issues) first
2. Follow our code style (ESLint + Prettier)
3. Write tests for new features
4. Update documentation as needed
5. Use [conventional commits](https://www.conventionalcommits.org/)

</details>

<br/>

---

<br/>

## 📊 Roadmap

<table>
<tr>
<td>

### ✅ Completed
- Full REST API
- PostgreSQL & SQLite
- JWT authentication
- Role-based access
- Docker support
- Setup wizard
- Reports & analytics
- **Discounts & promotions**
- **Returns & refunds**
- **Custom branding**
- **Receipt customization**
- **PDF/Excel exports**
- **API key management**
- **Service quotes workflow**

</td>
<td>

### 🔄 In Progress
- Google OAuth integration
- OIDC/SSO providers
- Mobile responsive
- Performance tuning
- Loyalty programs

</td>
<td>

### 📋 Planned
- Mobile app (iOS/Android)
- Offline-first PWA
- Multi-location support
- Plugin marketplace
- QuickBooks integration
- Hardware integrations
- Inventory alerts
- Customer loyalty points

</td>
</tr>
</table>

<br/>

---

<br/>

## 📄 License

This project is licensed under the **MIT License** - see [LICENSE](LICENSE) for details.

<table>
<tr>
<td>✅ Commercial use</td>
<td>✅ Modification</td>
<td>✅ Distribution</td>
<td>✅ Private use</td>
</tr>
</table>

<br/>

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:667eea,100:764ba2&height=120&section=footer" width="100%"/>

### ⭐ Star this repo if you find it useful!

<p>
  <b>Made with ❤️ by the stewardPOS community</b>
</p>

<p>
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Documentation</a> •
  <a href="#-contributing">Contribute</a> •
  <a href="#-stewardpos">Back to Top ↑</a>
</p>

</div>
