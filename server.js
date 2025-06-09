require('dotenv').config();
const { ftpDownload, ftpUpload } = require('./ftpHelper');
const express = require("express");
const fs = require("fs");
const { execSync } = require('child_process');
const os = require('os');
const bodyParser = require("body-parser");
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require('nodemailer');
const app = express(); // 👈 Moet vóór server komen
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Pas dit aan als je alleen een specifieke frontend toestaat
    methods: ['GET', 'POST']
  }
});

const PORT = 3000;
const SECRET_KEY = process.env.API_KEY;
let codes = {};
let rst_codes = {};
const clients = {};
// Transporter instellen (hier met Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.APP_MAIL, 
    pass: process.env.APP_KEY
  }
});

// Waar zijn alle bestanden?
const USERS_FILE = "users.json";
const CODE_FILE= "code.json";
const PROJECTS_FILE = "projects.json";
const FEEDBACK_FILE = 'feedback.json';

const multer = require('multer');
const path = require('path');
const { use } = require('react');

//Middleware
app.use(bodyParser.json());
app.use(cors());

// Map waar geüploade bestanden worden opgeslagen
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer configuratie
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.array('image', 10), (req, res) => {
  if (!req.files) return res.status(400).json({ error: 'Geen bestanden ontvangen' });
  res.json({ urls: req.files.map(file => '/mnt/hdd/uploads/' + file.filename) });
});

function readFeedback() {
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_FILE));
  } catch {
    return [];
  }
}

function writeFeedback(data) {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2));
}

//  Feedback toevoegen
app.post('/submit-feedback', (req, res) => {
    const { name, email, feedback } = req.body;
    if (!name || !email || !feedback) {
        return res.status(400).json({ error: 'Vul alle velden in' });
    }

    const feedbackData = readFeedback();
    feedbackData.push({ name, email, feedback, time: new Date().toISOString() });
    writeFeedback(feedbackData);

    res.json({ success: true });
});

// Verwijderfunctie
function deleteImage(imageUrl) {
  const filePath = path.join(uploadDir, path.basename(imageUrl)); // Zorgt dat alleen de bestandsnaam gebruikt wordt

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Fout bij verwijderen afbeelding:', err);
    } else {
      console.log('Afbeelding verwijderd:', filePath);
    }
  });
}

// Statische bestanden serveren
app.use('/mnt/hdd/uploads', express.static(uploadDir));

const tmpDir = os.tmpdir();

const readJSON = async (ftpFilePath) => {
    try {
        const localTmpFile = path.join(tmpDir, path.basename(ftpFilePath));
        await ftpDownload(ftpFilePath, localTmpFile);
        const content = fs.readFileSync(localTmpFile, "utf8");
        return JSON.parse(content);
    } catch (err) {
        console.error(`❌ Fout bij lezen van ${ftpFilePath}:`, err);
        return [];
    }
};

const writeJSON = async (ftpFilePath, data) => {
    try {
        const localTmpFile = path.join(tmpDir, path.basename(ftpFilePath));
        fs.writeFileSync(localTmpFile, JSON.stringify(data, null, 2));
        await ftpUpload(localTmpFile, ftpFilePath);
        console.log(`✅ Gegevens opgeslagen in ${ftpFilePath}`);
    } catch (err) {
        console.error(`🚨 Schrijffout in ${ftpFilePath}:`, err);
    }
};


// Check of gebruiker al bestaat
const userExists = (username) => {
    let users = readJSON(USERS_FILE);
    return users.some(user => user.username === username);
};

// Is de server wel levend?

app.get('/health-check', (req, res) => {
    res.status(200).send('Server is up!');
});

// Controleer of gebruikersnaam al bestaat (real-time validatie)
app.post("/check-username", (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Gebruikersnaam is vereist!" });
    }

    if (userExists(username)) {
        return res.status(409).json({ error: "Gebruikersnaam is al in gebruik!" }); // 409 = Conflict
    }

    res.json({ message: "Gebruikersnaam beschikbaar" });
});

// Oude code die klaar is voor bijv publieke projecten

app.get("/user-status", (req, res) => {
    const ipAddress = req.ip;
    let projects = readJSON(PROJECTS_FILE);

    let likedProjects = projects.filter(p => p.likedBy?.includes(ipAddress)).map(p => p.name);
    let dislikedProjects = projects.filter(p => p.dislikedBy?.includes(ipAddress)).map(p => p.name);

    res.json({ liked: likedProjects, disliked: dislikedProjects });
});


// Code voor het bewerken van gebruikers (setting pagina moet nog maken)

app.put("/edit-usr", async (req, res) => {
    const { username, passwd, newUsername, newPassword } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Gebruikersnaam is verplicht!" });
    }

    if (!passwd) {
	return res.status(400).json({ error: "Wachtwoord is verplicht!" });
    }

    const users = readJSON(USERS_FILE);
    const userIndex = users.findIndex(user => user.username === username);

    if (userIndex === -1) {
        return res.status(404).json({ error: "Gebruiker niet gevonden!" });
    }

    const user = users[userIndex];
    const passwordMatch = await bcrypt.compare(passwd, user.passwd);
    if (!passwordMatch) {
	return res.status(401).json({ error: "Wachtwoord klopt niet!" });
    }

    if (newUsername) {
        if (userExists(newUsername)) {
            return res.status(409).json({ error: "Nieuwe gebruikersnaam bestaat al!" });
        }
        user.username = newUsername;
    }

    if (newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
    }

    if (newMentor) {
        user.mentor = newMentor;
    }

    if (newPfpUrl) {
        user.pfpUrl = newPfpUrl;
    }

    writeJSON(USERS_FILE, users);

    res.json({ message: "Gebruiker succesvol bijgewerkt!" });
});

// voor wachtvoord vergeten

app.post("/edit-passwd", async (req, res) => {
const { email, new_password } = req.body;
const users = readJSON(USERS_FILE);
const userIndex = users.findIndex(user => user.email === email);

if (userIndex === -1) {
  return res.status(404).json({ error: "Gebruiker niet gevonden!" });
}

const user = users[userIndex]; // Initialiseer de gebruiker na het vinden van de index

const newPassword = await bcrypt.hash(new_password,10);

user.password = newPassword;

writeJSON(USERS_FILE, users);


res.json({ success: true, message: "YAYYYY" });

});

// Controleer of de gebruikers ingevoerde code legaal is


app.post("/verify-rst-code", (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ success: false, error: "Email en code zijn vereist." });
  }

  const expectedCode = rst_codes[email];
  if (!expectedCode) {
    return res.status(404).json({ success: false, error: "Geen code gevonden voor dit e-mailadres." });
  }

  if (parseInt(code) === parseInt(expectedCode)) {
    delete rst_codes[email]; 
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, error: "Ongeldige code." });
  }
});

// Stuur de resetcode naar de gebruiker

app.post("/send-rst-code", async (req, res) => {
  const { username, email } = req.body;
  const users = readJSON(USERS_FILE);
  const UserIndex = users.findIndex(user => user.email === email);
  if (UserIndex === -1){
     return res.status(404).json({success: false, error: "User not found"});
  }
  const user = users[UserIndex];
  console.log(user.username);
  console.log("⚙️ /send-code payload:", req.body);
  if (!email) {
    console.error("❌ /send-code error: no email provided");
    return res.status(400).json({ success: false, error: "Email is required" });
  }

  const code = Math.floor(Math.random() * 1000000);
  console.log(`✉️  Will send code ${code} to:`, email);

  const mailOptions = {
  from: process.env.APP_MAIL,
  to: email,
  subject: 'Je resetcode',
  html: `
  <div style="
    background-color: white;
    padding: 20px;
    border-radius: 15px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
    max-width: 500px;
    margin: auto;
    font-family: sans-serif;
  ">
    <h1 style="color: #007BFF;">Beste ${user.username}</h1>
    <p style="color: #555555;">
        Uw resetcode is: <strong>${code}</strong>
    </p>
    <p style="color: #555555; margin-top: 20px;">
        Met vriendelijke groet,<br>
        MasterDev
    </p>
  </div>
`};

  try {
    await transporter.sendMail(mailOptions);
    rst_codes[email] = code;
    res.json({ success: true });
  } catch (error) {
    console.error("Fout bij verzenden e-mail:", error);
    res.status(500).json({ success: false, error: "Kon e-mail niet verzenden" });
  }
});

// Stuur code voor account aanmaken


app.post("/send-code", async (req, res) => {
  console.log("⚙️ /send-code payload:", req.body);
  const { username, email } = req.body;
  if (!email) {
    console.error("❌ /send-code error: no email provided");
    return res.status(400).json({ success: false, error: "Email is required" });
  }
  const data = readJSON(USERS_FILE);
  const found = data.some(entry => entry.email === email);
  if (found){
      return res.status(400).json({success: false, error: "email is al in gebruik"});
  }

  const code = Math.floor(Math.random() * 1000000); 
  console.log(`✉️  Will send code ${code} to:`, email);

  const mailOptions = {
    from: process.env.APP_MAIL,
    to: email,
    subject: 'Je verificatiecode',
    html: `
    <div style="
      background-color: white;
      padding: 20px;
      border-radius: 15px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      max-width: 500px;
      margin: auto;
      font-family: sans-serif;
    ">
      <h1 style="color: #007BFF;">Beste ${username}</h1>
      <p style="color: #555555;">
          Uw verficatiecode is: <strong>${code}</strong>
      </p>
      <p style="color: #555555; margin-top: 20px;">
          Met vriendelijke groet,<br>
          MasterDev
      </p>
    </div>
`};

  try {
    await transporter.sendMail(mailOptions);
    codes[email] = code;
    res.json({ success: true });
  } catch (error) {
    console.error("Fout bij verzenden e-mail:", error);
    res.status(500).json({ success: false, error: "Kon e-mail niet verzenden" });
  }
});

// controleer of de code klopt

app.post('/verify-code', (req, res) => {
  const { email, codeEntered } = req.body;

  const storedCode = codes[email];

  if (storedCode) {
    if (storedCode == codeEntered) {
      res.status(200).json({ success: true, message: 'Code geverifieerd' });
    } else {
      res.status(400).json({ success: false, message: 'Onjuiste code' });
    }
  } else {
    res.status(404).json({ success: false, message: 'Geen code gevonden voor dit e-mailadres' });
  }
});

// Maak de account aan

app.post("/sign", async (req, res) => {
    const { username, password, role, mentor, email, pfpUrl } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Gebruikersnaam en wachtwoord zijn verplicht!" });
    }

    if (userExists(username)) {
        return res.status(409).json({ error: "Gebruiker bestaat al!" });
    }



    const hashedPassword = await bcrypt.hash(password, 10);
    let users = await readJSON(USERS_FILE);  

    users.push({ 
        username, 
        password: hashedPassword, 
        rank: "broke",  
        role: role || "user",
        tokens: -1000,
	mentor: mentor || "",
        email,
        pfpUrl
    });


    await writeJSON(USERS_FILE, users);
    res.json({ message: "Account succesvol aangemaakt, log in!" });
});

// Inloggen en aanmaak van JWT-token
app.post("/login", async (req, res) => {
    
    const { username, password } = req.body;
    let users = await readJSON(USERS_FILE);

    if (!Array.isArray(users)) {
        console.error("users is geen array:", users);
        return res.status(500).json({ error: "Serverfout: gebruikersbestand ongeldig." });
    }


    const user = users.find((u) => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Ongeldige inloggegevens!" });
    }
    const token = jwt.sign({ username, mentor: user.mentor, role: user.role, pfpUrl: user.pfpUrl }, SECRET_KEY, { expiresIn: "12h" });
    res.json({ token });
});

// Klopt die JWT token wel?
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(403).json({ error: "Geen token verstrekt" });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Ongeldige token" });

        req.user = decoded;
        next();
    });
};

// Feedback bekijken

app.get('/feedback', authenticate, (req, res) => {
  const role = req.user.role;

  if (role === "admin") {
    const feedback = readFeedback();
    res.json(feedback);
  } else {
    res.status(403).json({ error: "❌ Alleen admins kunnen feedback bekijken." });
  }
});

// Upload profielafbeelding

app.post('/upload-pfp', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Waarom tf bestaat deze hier?
app.put("/edit-user", authenticate, async (req, res) => {
    const { newUsername, newPassword, newMentor, newPfpUrl } = req.body;

    const users = readJSON(USERS_FILE);
    const userIndex = users.findIndex(user => user.username === req.user.username);

    if (userIndex === -1) {
        return res.status(404).json({ error: "Gebruiker niet gevonden!" });
    }

    const user = users[userIndex];

    if (newUsername) {
        if (userExists(newUsername)) {
            return res.status(409).json({ error: "Nieuwe gebruikersnaam bestaat al!" });
        }
        user.username = newUsername;

    }

    if (newPassword) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
    }

    if (newMentor) {
        user.mentor = newMentor;
    }

    if (newPfpUrl) {
        user.pfpUrl = newPfpUrl;
    }

    writeJSON(USERS_FILE, users);

    res.json({ message: "Gebruiker succesvol bijgewerkt!" });
});



// Verwijder de gebruiker
app.post("/delete-user", authenticate, async (req, res) => {
    let users = await readJSON(USERS_FILE);  
    const username = req.user.username; // Get logged-in user

    // Filter out the current user
    const filteredUsers = users.filter(user => user.username !== username);

    if (filteredUsers.length === users.length) {
        return res.status(404).json({ error: "User not found" });
    }

    await writeJSON(USERS_FILE, filteredUsers);
    res.json({ message: "User deleted" });
});

app.post("/show-rank", authenticate, (req, res) => {
    let users = readJSON(USERS_FILE);
    const user = users.find((u) => u.username === req.user.username);

    if (!user) {
        return res.status(404).json({ error: "Gebruiker niet gevonden" });
    }

    res.status(200).json({ rank: user.rank });  // 🔥 Geef de echte rank terug
});

app.get("/show-public", (req, res) => {
    let projects = readJSON(PROJECTS_FILE);
    let publicProjects = projects.filter(p => p.adver === true);
    res.json(publicProjects);
});

app.get('/projects-mentored', authenticate, (req, res) => {
    let projects = readJSON(PROJECTS_FILE);
    let shared = projects.filter(p => p.sharedWith?.includes(req.user.username));
    res.json(shared);
});


app.post("/buy-rank", authenticate, (req, res) => {
    let users = readJSON(USERS_FILE);
    let ranks = readJSON("ranks.json");

    const user = users.find((u) => u.username === req.user.username);
    if (!user) {
        return res.status(404).json({ error: "Gebruiker niet gevonden!" });
    }

    const { newRank } = req.body;
    
    if (!ranks[newRank]) {
        return res.status(400).json({ error: "Ongeldige rang gekozen!" });
    }

    const rankPrice = ranks[newRank];

    if (user.tokens < rankPrice) {
        return res.status(400).json({ error: "Niet genoeg tokens!" });
    }

    // Check of de nieuwe rank hoger is dan de huidige rank
    const rankList = Object.keys(ranks);
    if (rankList.indexOf(newRank) <= rankList.indexOf(user.rank)) {
        return res.status(400).json({ error: "Je kunt alleen een hogere rang kopen!" });
    }

    // Update tokens en rank
    user.tokens -= rankPrice;
    user.rank = newRank;
    writeJSON(USERS_FILE, users);

    res.json({ message: `Gefeliciteerd! Je bent nu ${newRank}`, tokens: user.tokens });
});

// Hele oude code voor bijv publieke projecten

app.get("/check-rank", authenticate, (req, res) => {
    let users = readJSON(USERS_FILE);
    let ranks = readJSON("ranks.json");

    const user = users.find((u) => u.username === req.user.username);
    if (!user) {
        return res.status(404).json({ error: "Gebruiker niet gevonden!" });
    }

    const rankList = Object.keys(ranks);
    let currentRankIndex = rankList.indexOf(user.rank);

    if (currentRankIndex === -1 || currentRankIndex >= rankList.length - 1) {
        return res.json({ message: "Je hebt de hoogste rang!", rank: user.rank });
    }

    // Zoek de goedkoopste upgrade die de gebruiker zich kan veroorloven
    for (let i = currentRankIndex + 1; i < rankList.length; i++) {
        let nextRank = rankList[i];
        let price = ranks[nextRank];

        if (user.tokens >= price) {
            user.tokens -= price;
            user.rank = nextRank;
            writeJSON(USERS_FILE, users);

            return res.json({ message: `Gefeliciteerd! Je bent geüpgraded naar ${nextRank}`, rank: user.rank, tokens: user.tokens });
        }
    }

    res.json({ message: "Nog niet genoeg tokens voor een upgrade!", rank: user.rank, tokens: user.tokens });
});

// OOk hele oude code voor bijv publieke projecten
app.post("/buy-tokens", authenticate, (req, res) => {
    let users = readJSON(USERS_FILE);
    let amount = parseInt(req.body.amount, 10); // 👈 Zet om naar een integer

    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Ongeldig aantal tokens!" });
    }

    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ error: "Gebruiker niet gevonden!" });

    user.tokens = (parseInt(user.tokens, 10) || 0) + amount; // 👈 Zet bestaande waarde om naar een integer

    writeJSON(USERS_FILE, users);

    res.json({ message: "Tokens toegevoegd!", tokens: user.tokens });
});

// OOk hele oude code voor bijv publieke projecten
app.get("/check-tokens", authenticate, (req, res) => {
    let users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === req.user.username);

    if (!user) return res.status(404).json({ error: "Gebruiker niet gevonden!" });

    res.json({ tokens: user.tokens || 0 });
});


// Voeg project toe
app.post("/add-project", authenticate, (req, res) => {
    const { name, description, full_des, status, adver, files } = req.body;
    if (!name || !description || !full_des || !status) {
        return res.status(400).json({ error: "Alle velden zijn verplicht!" });
    }

    let projects = readJSON(PROJECTS_FILE);
    projects.push({ name, description, full_des, status, owner: req.user.username,sharedWith: [req.user.mentor], adver, files: files || [], UID: Math.floor(Math.random() * 1000001)});

    writeJSON(PROJECTS_FILE, projects);
    res.json({ message: "Project toegevoegd" });
});


// Voeg code toe
app.post("/add-code", authenticate, (req, res) => {
    const { name, description, full_des, status, adver } = req.body;
    if (!name || !description || !full_des || !status) {
        return res.status(400).json({ error: "Alle velden zijn verplicht!" });
    }

    let projects = readJSON(CODE_FILE);
    projects.push({ name, description, full_des, status, owner: req.user.username, adver });

    writeJSON(CODE_FILE, projects);
    res.json({ message: "Project toegevoegd" });
});

// Projecten ophalen
app.get("/projects", authenticate, async (req, res) => {
    try {
        let projects = await readJSON(PROJECTS_FILE);

        let userProjects = projects.filter((p) => p.owner === req.user.username);
        res.json(userProjects);
    } catch (err) {
        console.error("❌ Fout bij laden van projecten:", err);
        res.status(500).json({ error: "Serverfout bij ophalen van projecten." });
    }
});

// Projecten ophalen van een andere gebruiker voor admin's
app.get("/project/:uid", authenticate, (req, res) => {
  const uid = Number(req.params.uid);
  if (isNaN(uid)) {
    return res.status(400).json({ error: "Ongeldig UID-formaat" });
  }

  const projects = readJSON(PROJECTS_FILE);
  const project = projects.find(p => p.UID === uid);

  if (!project) {
    return res.status(404).json({ error: "Project niet gevonden" });
  }

  if (!project.adver && project.owner !== req.user.username && !project.sharedWith?.includes(req.user.username) && req.user.role !== "admin") {
    return res.status(403).json({ error: "Geen toegang tot dit project" });
  }

  res.json(project);
});

// Project verwijderen
app.post("/delete-project", authenticate, async (req, res) => {
    let projects = await readJSON(PROJECTS_FILE);
    const { name, UID } = req.body;

    const projectToDelete = projects.find(
        (p) => p.name === name && p.owner === req.user.username && p.UID === Number(UID)
    );

    if (!projectToDelete) {
        return res.status(345).json({ error: "Project niet gevonden of geen rechten" });
    }

    // Verwijder alle bestanden die bij het project horen
    if (projectToDelete.files && Array.isArray(projectToDelete.files)) {
        projectToDelete.files.forEach(file => {
            const filePath = file;

            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error(`Fout bij verwijderen bestand ${file}:`, err);
                } else if (err && err.code === 'ENOENT') {
                    console.warn(`Bestand niet gevonden: ${file}, maar verdergaan.`);
                } else {
                    console.log(`Bestand ${file} succesvol verwijderd.`);
                }
            });
        });
    }

    const filteredProjects = projects.filter(
        (p) => !(p.name === name && p.owner === req.user.username && p.UID === Number(UID))
    );

    await writeJSON(PROJECTS_FILE, filteredProjects);

    res.json({ message: "Project verwijderd" });
});

// Code voor nieuwe delete (nog niet klaar voor productie)

app.post("/new-delete-project", authenticate, (req, res) => {
    let projects = readJSON(PROJECTS_FILE);
    const { name, UID } = req.body;

    const projectToDelete = projects.find(
        (p) => p.name === name && p.owner === req.user.username && p.UID === Number(UID)
    );

    if (!projectToDelete) {
        return res.status(404).json({ error: "Project niet gevonden of geen rechten" });
    }

    // Markeer project voor verwijdering
    projectToDelete.delete = true;

    // Voeg tijd van uitvoering toe (bijvoorbeeld 30 dagen later)
    let executionDate = new Date();
    executionDate.setDate(executionDate.getDate() + 30);  // Voeg 30 dagen toe aan de huidige datum

    // Log de tijd van uitvoering om te zien of de datum goed wordt ingesteld
    console.log(`Tijd van uitvoering: ${executionDate.toISOString()}`);

    // Gebruik de juiste naam: 'timeOfExecution' in plaats van 'timeOfExcecution'
    projectToDelete.timeOfExecution = executionDate.toISOString(); 

    // Schrijf de wijzigingen terug naar het bestand
    writeJSON(PROJECTS_FILE, projects);

    res.json({ message: "Project gemarkeerd voor verwijdering" });
});

// Share-projecten met een andere gebruiker

app.post("/get-shared-projects", authenticate, async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Geen gebruikersnaam opgegeven" });
    }

    try {
        const projects = await readJSON(PROJECTS_FILE);

        if (!Array.isArray(projects)) {
            return res.status(500).json({ error: "Projectbestand is ongeldig" });
        }

        const sharedProjects = projects.filter(p => p.sharedWith?.includes(username));

        if (sharedProjects.length === 0) {
            return res.status(404).json({ error: "Geen gedeelde projecten gevonden" });
        }

        res.json(sharedProjects);
    } catch (err) {
        console.error("❌ Fout bij ophalen gedeelde projecten:", err);
        res.status(500).json({ error: "Interne serverfout" });
    }
});

// Project delen met een andere gebruiker

app.post("/share-project", authenticate, async (req, res) => {
    const { name, username, UID } = req.body;
    if (!name || !username || !UID) {
        return res.status(400).json({ error: "Projectnaam en gebruikersnaam zijn verplicht!" });
    }

    try {
        const projects = await readJSON(PROJECTS_FILE);
        const project = projects.find(p => p.name === name && p.owner === req.user.username && p.UID === Number(UID));

        const users = await readJSON(USERS_FILE);
        const user = users.find(u => u.username === username);

        if (!user) {
            return res.status(406).json({ error: "Gebruiker niet gevonden" });
        }

        if (!project) {
            return res.status(404).json({ error: "Project niet gevonden of geen rechten" });
        }

        if (!Array.isArray(project.sharedWith)) {
            project.sharedWith = [];
        }

        if (project.sharedWith.includes(username)) {
            return res.status(409).json({ error: "Project al gedeeld met deze gebruiker" });
        }

        project.sharedWith.push(username);
        await writeJSON(PROJECTS_FILE, projects);

        res.json({ message: "Project gedeeld" });
    } catch (err) {
        console.error("❌ Fout bij delen van project:", err);
        res.status(500).json({ error: "Interne serverfout" });
    }
});


// Projecten unshare met een andere gebruiker

app.post("/unshare-project", authenticate, async (req, res) => {
    const { name, username, UID } = req.body;	
    if (!name || !username || !UID) {
        return res.status(400).json({ error: "Projectnaam en gebruikersnaam zijn verplicht!" });
    }
    try {
        const projects = await readJSON(PROJECTS_FILE);
        const project = projects.find(p => p.name === name && p.owner === req.user.username && p.UID === Number(UID));
        if (!project) {
            return res.status(404).json({ error: "Project niet gevonden of geen rechten" });
        }
        if (!project.sharedWith) {
            return res.status(404).json({ error: "Project niet gedeeld met deze gebruiker" });
        }
        const userIndex = project.sharedWith.indexOf(username);
        if (userIndex === -1) {
            return res.status(404).json({ error: "Project niet gedeeld met deze gebruiker" });
        }
        project.sharedWith.splice(userIndex, 1);
        await writeJSON(PROJECTS_FILE, projects);
        res.json({ message: "Project niet meer gedeeld" });
    }
    catch (err) {
        console.error("❌ Fout bij unshare van project:", err);
        res.status(500).json({ error: "Interne serverfout" });
    }
}
);

// Show projects that are deleted per user

app.get("/deleted-projects", authenticate, async (req, res) => {
  const username = req.user.username;
  console.log(username);
  console.log(req.user.username);
  if (!username) {
    return res.status(400).json({ error: "Geen gebruikersnaam opgegeven" });
  }
  const projects = await readJSON(PROJECTS_FILE);
  const deletedProjects = projects.filter(p => p.delete === true && p.owner === username);
  if (deletedProjects.length === 0) {
    return res.status(404).json({ error: "Geen verwijderde projecten gevonden" });
  }
  res.json(deletedProjects);
}
);

// Projecten terug brengen van delete: true
app.post("/restore-project", authenticate, async (req, res) => {
    console.log("ABOMB");
    const { name, UID } = req.body;
    if (!name || !UID) {
        console.log("ABOMB2");
        return res.status(400).json({ error: "Projectnaam en UID zijn verplicht!" });
    }

    let projects = await readJSON(PROJECTS_FILE);
    let project = projects.find(p => p.name === name && p.owner === req.user.username && p.UID === Number(UID));
    console.log("ABOMB3");
    if (!project || !project.delete) {
        console.log("ABOMB4");
        return res.status(404).json({ error: "Project niet gevonden of niet verwijderd" });
    }
    console.log("ABOMB5");
    project.delete = false; // Zet delete terug naar false
    project.timeOfExecution = null; // Verwijder de timeOfExecution
    console.log("ABOMB6");
    await writeJSON(PROJECTS_FILE, projects);
    res.json({ message: "Project hersteld" });
}
);

// Project bewerken
app.post("/edit-project", authenticate, (req, res) => {
    let projects = readJSON(PROJECTS_FILE);
    const { name, description, full_des, status, files } = req.body;

    let project = projects.find((p) => p.name === name && p.owner === req.user.username);
    if (!project) {
        return res.status(404).json({ error: "Project niet gevonden of geen rechten" });
    }

    project.description = description;
    project.full_des = full_des;
    project.status = status;
    project.files = files;

    writeJSON(PROJECTS_FILE, projects);
    res.json({ message: "Project bijgewerkt" });
});

// Return the amount of people project is shared with and the persons username
app.post("/get-shared-with", authenticate, (req, res) => {
    const { name, UID } = req.body;
    if (!name || !UID) {
        return res.status(400).json({ error: "Projectnaam en UID zijn verplicht!" });
    }

    let projects = readJSON(PROJECTS_FILE);
    let project = projects.find(p => p.name === name && p.UID === Number(UID));

    if (!project) {
        return res.status(404).json({ error: "Project niet gevonden" });
    }

    if (!project.sharedWith || project.sharedWith.length === 0) {
        return res.status(404).json({ error: "Geen gedeelde gebruikers gevonden" });
    }

    res.json({ sharedWith: project.sharedWith });
});
// Project verwijderen als timeOfExecution is geraakt

async function checkAndDeleteExpiredProjects() {
    try {
        const projects = await readJSON(PROJECTS_FILE);
        const now = new Date();

        const projectsToKeep = [];
        const projectsToDelete = [];

        // Splits projecten in bewaren en verwijderen
        for (const project of projects) {
            if (project.timeOfExecution) {
                const execTime = new Date(project.timeOfExecution);
                if (now >= execTime) {
                    console.log(`Verwijdert project: ${project.name} van ${project.owner}`);
                    projectsToDelete.push(project);
                    continue; // niet toevoegen aan keep lijst
                }
            }
            projectsToKeep.push(project);
        }

        // Bestanden van te verwijderen projecten verwijderen
        for (const project of projectsToDelete) {
            if (project.files && Array.isArray(project.files)) {
                for (const filePath of project.files) {
                    fs.unlink(filePath, (err) => {
                        if (err && err.code !== 'ENOENT') {
                            console.error(`Fout bij verwijderen bestand ${filePath}:`, err);
                        } else if (err && err.code === 'ENOENT') {
                            console.warn(`Bestand niet gevonden: ${filePath}, maar verdergaan.`);
                        } else {
                            console.log(`Bestand ${filePath} succesvol verwijderd.`);
                        }
                    });
                }
            }
        }

        if (projectsToKeep.length !== projects.length) {
            writeJSON(PROJECTS_FILE, projectsToKeep);
            console.log("Verlopen projecten verwijderd.");
        }
    } catch (err) {
        console.error("Fout in checkAndDeleteExpiredProjects:", err);
    }
}


// Controleer elke 6 sec
setInterval(checkAndDeleteExpiredProjects, 6 * 1000); // 6 * 1000 ms = 6 seconden

// 🚀 **Server starten**
app.listen(PORT, () => {
    console.log(`🚀 Server draait op poort ${PORT}`);
    console.log(Math.floor(Math.random() * 10001));
});