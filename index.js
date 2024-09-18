'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

require('extend-console');

const { name: packageName } = require(path.join(__dirname, 'package.json'));
const configPath = './config/config.json';

let config = JSON.parse(fs.readFileSync(configPath, 'utf8'))[packageName];
if (!config) {
	// load default config
	config = require(configPath)[packageName];
}
const extensionWhitelist = config.extensionWhitelist || ['txt'];
const extensionBlacklist = config.extensionBlacklist || [];
const includeHiddenFiles = config.includeHiddenFiles || false;

function escapeHtml(content) {
    return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cloneRepo(url) {
    const command = `git clone ${url} > NUL 2>&1`;

    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

function rmDir(dir) {
    const command = `rmdir /s /q ${dir}`;

    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function walkDir(dirPath, callback) {
    const files = await fs.readdirSync(dirPath);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.statSync(filePath);
        if (stats.isDirectory()) {
            await walkDir(filePath, callback);
        } else {
            callback(filePath, stats);
        }
    }
}

function buildHtmlTreeFromPath(filePath, stats) {
    try {
        if (!stats.isFile()) return;
        
        const pathParts = filePath.split(path.sep);
        const filename = pathParts.pop();
        const basename = path.parse(filename).name;
        const extname = path.extname(filename).toLowerCase().substring(1);
        let node = this.root;

        if ((filename.startsWith('.') && !includeHiddenFiles) || extensionBlacklist.includes(extname)) return;
        if (!extensionWhitelist.includes(extname)) {
            console.reportWarn(`Did not include ${filePath} (${extname})`);
            return;
        }

        // make sure all the parent nodes exist
        for (let i = 1; i < pathParts.length; i++) {
            const part = pathParts[i];
            let found = false;
            for (const child of node.children) {
                if (child.name === part) {
                    found = true;
                    node = child;
                    break;
                }
            }
            if (found) continue;
            const newNode = {
                type: 'folder',
                name: part,
                size: 0,
                path: node.path + path.sep + part,
                children: [],
            };
            node.children.push(newNode);
            node = newNode;
        }
        
        node.children.push({
            type: 'file',
            name: basename,
            ext: extname,
            size: stats.size,
            path: filePath,
            content: escapeHtml(fs.readFileSync(filePath, 'utf8'))
        });
    } catch (err) {
        console.reportError(err);
    }
}

function generateHTML(root) {
    try {
        const createDiv = (item) => {
            if (item.type === 'folder') {
                return `
                    <div class="folder">
                        <div class="folder-name">${item.name}</div>
                        <div class="folder-children">
                            ${item.children.map(createDiv).join('')}
                        </div>
                    </div>
                `;
            } else if (item.type === 'file') {
                return `
                    <div class="file">
                        <div class="file-name">${item.name}.${item.ext}</div>
                        <div class="file-content">${item.content}</div>
                    </div>
                `;
            }
            return '';
        };
    
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        margin: 0;
                        padding: 20px;
                    }
                    .folder {
                        margin-left: 20px;
                        padding: 5px;
                    }
                    .file {
                        margin-left: 20px;
                        padding: 5px;
                        border-left: 2px solid #ccc;
                    }
                    .folder-name {
                        font-weight: bold;
                        color: #2c3e50;
                    }
                    .file-name {
                        font-weight: bold;
                        color: #16a085;
                    }
                    .file-extension {
                        color: #7f8c8d;
                    }
                    .file-size {
                        color: #95a5a6;
                    }
                    .file-content {
                        margin-left: 20px;
                        margin-top: 5px;
                        color: #34495e;
                        font-family: monospace;
                        white-space: pre-wrap;
                    }
                    .folder-children {
                        margin-left: 20px;
                    }
                </style>
            </head>
            <body>
                ${createDiv(root)}
            </body>
            </html>
        `;
    } catch (err) {
        console.reportError(err);
    }
}

function getFromPath(root, path) {
    try {
        const pathParts = path.split('/');
        if (pathParts[0] === root.name) pathParts.shift();
        let node = root;

        for (const part of pathParts) {
            let found = false;
            for (const child of node.children) {
                if (child.name === part) {
                    node = child;
                    found = true;
                    break;
                }
            }

            if (!found) return null;
        }

        return node;
    } catch (err) {
        console.reportError(err);
    }
}

async function folderToHTML(folderPath, htmlPath) {
    try {
        const dirname = path.basename(folderPath);
        const root = {
            type: 'folder',
            name: dirname,
            size: 0,
            path: dirname,
            children: []
        };
        const boundCallback = buildHtmlTreeFromPath.bind({ root });
        await walkDir(dirname, boundCallback);
        
        fs.writeFileSync(htmlPath, generateHTML(root));
    } catch (err) {
        console.reportError(err);
    }
}

async function main() {
    try {
        const repoUrl = process.argv[2];
        if (!repoUrl) {
            console.error('Usage: node index.js <repo-url>');
            process.exit(1);
        }
        const repoName = path.basename(repoUrl);

        if (!fs.existsSync(repoName)) {
            console.report(`Cloning ${repoUrl}...`);
            await cloneRepo(repoUrl);      
            await rmDir(path.join(repoName, '.git'));
        }
        
        const htmlPath = `${repoName}.html`;
        console.report(`Generating ${htmlPath}...`);
        await folderToHTML(repoName, htmlPath);
    } catch (err) {
        console.reportError(err);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    escapeHtml,
    cloneRepo,
    rmDir,
    walkDir,
    buildHtmlTreeFromPath,
    generateHTML,
    getFromPath,
    folderToHTML
}
