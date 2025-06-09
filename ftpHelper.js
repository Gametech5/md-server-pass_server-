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

module.exports = { ftpDownload, ftpUpload };
