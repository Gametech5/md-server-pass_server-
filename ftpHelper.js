const ftp = require("basic-ftp");
const path = require("path");
const fs = require("fs");

const FTP_HOST = process.env.FTP_HOST;
const FTP_USER = process.env.FTP_USER;
const FTP_PASS = process.env.FTP_PASS;

async function ftpDownload(remotePath, localPath) {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: FTP_HOST,
            user: FTP_USER,
            password: FTP_PASS,
            secure: false,
        });

        await client.cd("/data/user_files"); // Change to the desired remote directory

        const currentDir = await client.pwd();
        console.log("Current FTP directory:", currentDir);
        console.log("Trying to download remote path:", remotePath);
        console.log("Saving to local path:", localPath);

        await client.downloadTo(localPath, remotePath);
    } catch (err) {
        console.error("FTP download error:", err);
        throw err;
    }
    client.close();
}

async function ftpUpload(localPath, remotePath) {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: FTP_HOST,
            user: FTP_USER,
            password: FTP_PASS,
            secure: false,
        });
        await client.cd("/data/user_files"); // Change to the desired remote directory 
        const currentDir = await client.pwd();
        console.log("Current FTP directory:", currentDir);
        console.log("Trying to upload to remote path:", remotePath);
        await client.uploadFrom(localPath, remotePath);
    } catch (err) {
        console.error("FTP upload error:", err);
        throw err;
    }
    client.close();
}

async function ftpUploadFile(localPath, remotePath) {
    const client = new ftp.Client();
    client.ftp.verbose = false; // Turn off verbose in production

    try {
        // 1. Connect to server
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });

        // 2. Ensure correct directory
        await client.cd("/data/user_files");

        // 3. Upload file
        console.log(`📤 Uploading: ${path.basename(localPath)}`);
        await client.uploadFrom(localPath, remotePath);
        
        return {
            success: true,
            remotePath: remotePath
        };
    } catch (err) {
        console.error("❌ Upload failed:", err.message);
        return {
            success: false,
            error: err.message
        };
    } finally {
        if (client && !client.closed) {
            await client.close();
        }
        
        // Optional: Clean up local temp file
        try {
            await fs.promises.unlink(localPath);
        } catch (cleanupErr) {
            console.warn("⚠️ Could not clean up temp file:", cleanupErr.message);
        }
    }
}

module.exports = { ftpDownload, ftpUpload, ftpUploadFile };
