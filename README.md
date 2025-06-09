# masterdev-behind

**masterdev-behind** is de backend van het MasterDev-project. Deze server beheert gebruikersauthenticatie, projectbeheer en API-functionaliteiten voor de frontend van MasterDev.

## 🔧 Features

- ✅ JWT-authenticatie voor beveiligde API-toegang  
- ✅ Ondersteuning voor meerdere gebruikers  
- ✅ Uploaden en beheren van projecten  
- ✅ Feedbacksysteem voor projecten  
- ✅ 2FA (tweefactorauthenticatie) ondersteuning  
- ✅ Opslag in JSON-bestanden
- ✅ E-mailnotificaties mogelijk via SMTP

## 🚀 Installatie

1. Clone de repository:

   ```bash
   git clone https://github.com/Gametech5/masterdev-behind.git
   cd masterdev-behind

2. Installeer de packages:
   ```bash
   npm init
   npm install dotenv express fs child_process os body-parser cors http jsonwebtoken bcrypt nodemailer
3. Run de server:
   ```bash
   node server.js
