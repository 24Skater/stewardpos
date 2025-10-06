# Installation Guide

Quick and easy installation guide for Persona POS on Linux and Windows servers.

---

## 📋 Table of Contents

- [System Requirements](#system-requirements)
- [Quick Install (Recommended)](#quick-install-recommended)
- [Manual Installation](#manual-installation)
- [Docker Installation](#docker-installation)
- [Post-Installation Setup](#post-installation-setup)
- [Troubleshooting](#troubleshooting)

---

## 💻 System Requirements

### Minimum Requirements
- **CPU:** 2 cores
- **RAM:** 2 GB
- **Disk:** 10 GB free space
- **OS:** Ubuntu 20.04+, Debian 11+, CentOS 8+, Windows Server 2019+, or Windows 10/11

### Recommended for Production
- **CPU:** 4+ cores
- **RAM:** 4+ GB
- **Disk:** 50+ GB (SSD recommended)
- **OS:** Ubuntu 22.04 LTS or Windows Server 2022

### Network Requirements
- Port 80 (HTTP) or 443 (HTTPS)
- Port 3000 (Backend API)
- Port 5432 (PostgreSQL, if used)

---

## 🚀 Quick Install (Recommended)

### Linux (Ubuntu/Debian/CentOS/RHEL)

**One-command installation:**

```bash
curl -fsSL https://raw.githubusercontent.com/yourorg/persona-pos/main/install-linux.sh | bash
```

Or download and run:

```bash
wget https://raw.githubusercontent.com/yourorg/persona-pos/main/install-linux.sh
chmod +x install-linux.sh
./install-linux.sh
```

**What it does:**
- ✅ Installs all dependencies (Node.js, PostgreSQL/SQLite, Nginx)
- ✅ Downloads Persona POS
- ✅ Sets up database
- ✅ Configures the application
- ✅ Creates system service
- ✅ Starts the application

**Time:** 5-10 minutes

---

### Windows (Server or Desktop)

**One-command installation:**

1. **Open PowerShell as Administrator**
   - Right-click PowerShell → "Run as Administrator"

2. **Run installation script:**

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; `
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; `
iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/yourorg/persona-pos/main/install-windows.ps1'))
```

Or download and run:

```powershell
# Download
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yourorg/persona-pos/main/install-windows.ps1" -OutFile "install-windows.ps1"

# Run
.\install-windows.ps1
```

**What it does:**
- ✅ Installs Chocolatey package manager
- ✅ Installs all dependencies (Node.js, PostgreSQL/SQLite)
- ✅ Downloads Persona POS
- ✅ Sets up database
- ✅ Configures the application
- ✅ Creates Windows service
- ✅ Starts the application

**Time:** 10-15 minutes

---

## 🛠️ Manual Installation

If you prefer manual installation or the script doesn't work for your system.

### Step 1: Install Prerequisites

#### Ubuntu/Debian

```bash
# Update package list
sudo apt-get update

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Git
sudo apt-get install -y git

# Install PostgreSQL (optional, for production)
sudo apt-get install -y postgresql postgresql-contrib

# Install Nginx (for web server)
sudo apt-get install -y nginx
```

#### CentOS/RHEL

```bash
# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install Git
sudo yum install -y git

# Install PostgreSQL (optional)
sudo yum install -y postgresql-server postgresql-contrib

# Install Nginx
sudo yum install -y nginx
```

#### Windows

**Install Chocolatey first:**

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

**Then install dependencies:**

```powershell
choco install -y git nodejs postgresql
```

---

### Step 2: Download Persona POS

```bash
# Clone repository
git clone https://github.com/yourorg/persona-pos.git
cd persona-pos

# Install dependencies
npm install
```

---

### Step 3: Choose Database

#### Option A: SQLite (Easiest - Single File Database)

**Best for:**
- Small businesses (1-5 users)
- Simple setups
- No database server management

```bash
# Create data directory
mkdir -p data

# Create .env.local file
cat > .env.local << EOF
VITE_DB_ADAPTER=sqlite
VITE_DB_FILENAME=./data/persona-pos.db
VITE_APP_ENV=production
EOF
```

#### Option B: PostgreSQL (Recommended for Production)

**Best for:**
- Multiple users
- Production environments
- Better performance

**Linux:**

```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE persona_pos;
CREATE USER persona_pos WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE persona_pos TO persona_pos;
\q
EOF

# Create .env.local file
cat > .env.local << EOF
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=localhost
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=persona_pos
VITE_DB_PASSWORD=your_secure_password
VITE_APP_ENV=production
EOF
```

**Windows:**

```powershell
# Start PostgreSQL service
Start-Service postgresql-x64-14
Set-Service postgresql-x64-14 -StartupType Automatic

# Create database (using psql)
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -c "CREATE DATABASE persona_pos;"
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -c "CREATE USER persona_pos WITH PASSWORD 'your_secure_password';"
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE persona_pos TO persona_pos;"

# Create .env.local file
@"
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=localhost
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=persona_pos
VITE_DB_PASSWORD=your_secure_password
VITE_APP_ENV=production
"@ | Out-File -FilePath ".env.local" -Encoding UTF8
```

---

### Step 4: Run Database Migrations

```bash
npm run migrate
```

This creates all necessary tables and initial data.

---

### Step 5: Build the Application

```bash
npm run build
```

This creates optimized production files in the `dist/` directory.

---

### Step 6: Start the Application

#### Linux - Using systemd (Recommended)

```bash
# Create systemd service file
sudo tee /etc/systemd/system/persona-pos.service > /dev/null << EOF
[Unit]
Description=Persona POS
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) $(pwd)/backend/dist/server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd, enable and start service
sudo systemctl daemon-reload
sudo systemctl enable persona-pos
sudo systemctl start persona-pos

# Check status
sudo systemctl status persona-pos
```

#### Windows - Using NSSM (Recommended)

```powershell
# Install NSSM (Non-Sucking Service Manager)
choco install -y nssm

# Create Windows service
$exePath = "C:\Program Files\nodejs\node.exe"
$scriptPath = "$(Get-Location)\backend\dist\server.js"

nssm install PersonaPOS $exePath $scriptPath
nssm set PersonaPOS AppDirectory $(Get-Location)
nssm set PersonaPOS DisplayName "Persona POS"
nssm set PersonaPOS Description "Persona POS - Point of Sale System"
nssm set PersonaPOS Start SERVICE_AUTO_START

# Start service
nssm start PersonaPOS

# Check status
nssm status PersonaPOS
```

#### Quick Test (Development Mode)

```bash
# For testing only - not for production
npm run dev
```

---

### Step 7: Configure Web Server (Optional but Recommended)

#### Linux - Nginx

```bash
# Create Nginx configuration
sudo tee /etc/nginx/sites-available/persona-pos > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;
    
    root /var/www/persona-pos;
    index index.html;
    
    # Frontend
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/persona-pos /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Copy built files
sudo mkdir -p /var/www/persona-pos
sudo cp -r dist/* /var/www/persona-pos/
sudo chown -R www-data:www-data /var/www/persona-pos

# Test and restart Nginx
sudo nginx -t
sudo systemctl restart nginx
```

#### Windows - IIS (Alternative)

See detailed guide: [docs/deployment/windows-iis.md](docs/deployment/windows-iis.md)

---

## 🐳 Docker Installation

**Easiest way to run Persona POS with all dependencies.**

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+

**Install Docker:**

**Linux:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in
```

**Windows:**
Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

### Quick Start with Docker

```bash
# Clone repository
git clone https://github.com/yourorg/persona-pos.git
cd persona-pos

# Copy environment file
cp .env.example .env

# Edit .env and set secure passwords
nano .env  # or use any text editor

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

**What's included:**
- ✅ PostgreSQL database
- ✅ Redis (for sessions)
- ✅ MinIO (S3-compatible storage)
- ✅ Backend API
- ✅ Frontend (Nginx)

**Access:**
- Frontend: http://localhost
- Backend API: http://localhost:3000
- MinIO Console: http://localhost:9001

---

### Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f [service_name]

# Update to latest version
git pull
docker-compose pull
docker-compose up -d

# Backup database
docker-compose exec postgres pg_dump -U persona_pos persona_pos > backup.sql

# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U persona_pos persona_pos
```

---

## ✅ Post-Installation Setup

### 1. Access the Application

**Find your server IP:**

**Linux:**
```bash
hostname -I | awk '{print $1}'
```

**Windows:**
```powershell
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*" | Select-Object -First 1).IPAddress
```

**Access in browser:**
- http://YOUR_SERVER_IP
- http://localhost (if on same machine)

---

### 2. First Login

**Default admin credentials:**
```
Email: admin@example.com
Password: admin123
```

**⚠️ IMPORTANT: Change this password immediately!**

1. Log in with default credentials
2. Go to Settings → Users
3. Click on admin user
4. Change password
5. Update email address

---

### 3. Initial Configuration

**Go through the setup wizard:**

1. **Store Information**
   - Store name
   - Contact information
   - Tax rate
   - Currency

2. **Add First User**
   - Create a cashier account
   - Assign appropriate role

3. **Add First Product**
   - Name, price, category
   - Upload image (optional)
   - Set stock level

4. **Test a Sale**
   - Add product to cart
   - Complete checkout
   - Print/email receipt

---

### 4. Configure Backups

**Linux - Automated Daily Backups:**

```bash
# Create backup script
sudo tee /usr/local/bin/persona-pos-backup.sh > /dev/null << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/persona-pos"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Backup database
if [ "$VITE_DB_ADAPTER" = "postgres" ]; then
  pg_dump -U persona_pos persona_pos | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"
elif [ "$VITE_DB_ADAPTER" = "sqlite" ]; then
  cp ./data/persona-pos.db "$BACKUP_DIR/db_$DATE.sqlite"
  gzip "$BACKUP_DIR/db_$DATE.sqlite"
fi

# Delete backups older than 30 days
find "$BACKUP_DIR" -name "*.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/db_$DATE"
EOF

sudo chmod +x /usr/local/bin/persona-pos-backup.sh

# Schedule daily backup at 2 AM
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/persona-pos-backup.sh") | crontab -
```

**Windows - Automated Daily Backups:**

```powershell
# Create backup script
$backupScript = @'
$BackupDir = "C:\Backups\PersonaPOS"
$Date = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Backup database
if ($env:VITE_DB_ADAPTER -eq "postgres") {
    & "C:\Program Files\PostgreSQL\14\bin\pg_dump.exe" -U persona_pos persona_pos | gzip > "$BackupDir\db_$Date.sql.gz"
} elseif ($env:VITE_DB_ADAPTER -eq "sqlite") {
    Copy-Item ".\data\persona-pos.db" "$BackupDir\db_$Date.sqlite"
    Compress-Archive "$BackupDir\db_$Date.sqlite" "$BackupDir\db_$Date.sqlite.zip"
    Remove-Item "$BackupDir\db_$Date.sqlite"
}

# Delete backups older than 30 days
Get-ChildItem $BackupDir -Filter *.gz | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item

Write-Host "Backup completed: $BackupDir\db_$Date"
'@

$backupScript | Out-File -FilePath "C:\PersonaPOS\backup.ps1" -Encoding UTF8

# Schedule daily backup at 2 AM
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-File C:\PersonaPOS\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "PersonaPOS-Backup" -Action $action -Trigger $trigger -Description "Daily backup of Persona POS database"
```

---

## 🔧 Troubleshooting

### Installation Script Fails

**Linux:**
```bash
# Check logs
cat /tmp/persona-pos-install.log

# Check if services are running
sudo systemctl status persona-pos
sudo systemctl status postgresql
sudo systemctl status nginx

# View service logs
sudo journalctl -u persona-pos -n 50
```

**Windows:**
```powershell
# Check service status
nssm status PersonaPOS

# View logs
Get-EventLog -LogName Application -Source PersonaPOS -Newest 50
```

---

### Cannot Access Application

**Check if service is running:**

**Linux:**
```bash
sudo systemctl status persona-pos
curl http://localhost:3000/api/health
```

**Windows:**
```powershell
nssm status PersonaPOS
Invoke-WebRequest -Uri "http://localhost:3000/api/health"
```

**Check firewall:**

**Linux:**
```bash
sudo ufw allow 80
sudo ufw allow 3000
```

**Windows:**
```powershell
New-NetFirewallRule -DisplayName "Persona POS" -Direction Inbound -LocalPort 80,3000 -Protocol TCP -Action Allow
```

---

### Database Connection Errors

**PostgreSQL:**

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -U persona_pos -d persona_pos -h localhost

# Check credentials in .env.local
cat .env.local | grep DB_
```

**SQLite:**

```bash
# Check if database file exists
ls -lh data/persona-pos.db

# Check file permissions
chmod 664 data/persona-pos.db
```

---

### Port Already in Use

**Find what's using the port:**

**Linux:**
```bash
sudo lsof -i :80
sudo lsof -i :3000
```

**Windows:**
```powershell
Get-NetTCPConnection -LocalPort 80
Get-NetTCPConnection -LocalPort 3000
```

**Change port in configuration:**

Edit `.env.local`:
```bash
BACKEND_PORT=3001  # Change from 3000
FRONTEND_PORT=8080  # Change from 80
```

---

### Out of Memory

**Increase Node.js memory limit:**

**Linux (systemd):**
```bash
sudo systemctl edit persona-pos

# Add:
[Service]
Environment="NODE_OPTIONS=--max-old-space-size=4096"
```

**Windows (NSSM):**
```powershell
nssm set PersonaPOS AppEnvironmentExtra NODE_OPTIONS=--max-old-space-size=4096
nssm restart PersonaPOS
```

---

### Slow Performance

**Check system resources:**

```bash
# Linux
htop
df -h
free -h

# Windows
taskmgr
```

**Optimize database:**

**PostgreSQL:**
```sql
VACUUM ANALYZE;
REINDEX DATABASE persona_pos;
```

**SQLite:**
```bash
sqlite3 data/persona-pos.db "VACUUM;"
```

---

### Need More Help?

- 📚 **Documentation:** https://docs.persona-pos.dev
- 💬 **Discord:** https://discord.gg/persona-pos
- 🐛 **GitHub Issues:** https://github.com/yourorg/persona-pos/issues
- 📧 **Email:** support@persona-pos.dev

---

## 🔄 Updating Persona POS

### Linux

```bash
cd persona-pos
git pull
npm install
npm run build
sudo systemctl restart persona-pos
```

### Windows

```powershell
cd C:\PersonaPOS
git pull
npm install
npm run build
nssm restart PersonaPOS
```

### Docker

```bash
cd persona-pos
git pull
docker-compose pull
docker-compose up -d
```

---

## 🗑️ Uninstalling

### Linux

```bash
# Stop and disable service
sudo systemctl stop persona-pos
sudo systemctl disable persona-pos
sudo rm /etc/systemd/system/persona-pos.service

# Remove files
rm -rf ~/persona-pos

# Remove database (optional)
sudo -u postgres psql -c "DROP DATABASE persona_pos;"
sudo -u postgres psql -c "DROP USER persona_pos;"

# Remove Nginx config
sudo rm /etc/nginx/sites-enabled/persona-pos
sudo rm /etc/nginx/sites-available/persona-pos
sudo systemctl restart nginx
```

### Windows

```powershell
# Stop and remove service
nssm stop PersonaPOS
nssm remove PersonaPOS confirm

# Remove files
Remove-Item -Recurse -Force C:\PersonaPOS

# Remove database (optional)
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -c "DROP DATABASE persona_pos;"
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -c "DROP USER persona_pos;"
```

### Docker

```bash
# Stop and remove containers
docker-compose down -v

# Remove files
rm -rf persona-pos
```

---

**Installation complete! 🎉**

Enjoy using Persona POS!
