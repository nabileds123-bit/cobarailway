var crypto = require('crypto');
var fs = require('fs');
var net = require('net');
var path = require('path');
var tls = require('tls');

var dbPath = path.join(__dirname, '..', 'data', 'users.json');
var memorySessions = {};
var mysqlPool = null;
var mysqlReady = null;
var premiumExpiryTimer = null;
var BUY_PREMIUM_COST = 2;
var PREMIUM_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
var EMAIL_VERIFICATION_REWARD = 6;
var UPLOAD_SKIN_COST = 150;
var CREATE_GUILD_COST = 50;
var PLAYER_SKIN_UPLOAD_SIZE = 500 * 1024;
var GUILD_SKIN_UPLOAD_SIZE = 200 * 1024;
var allowedCellColors = [
    '#6FCA36',
    '#4379EF',
    '#98B6FD',
    '#36D2D6',
    '#6DE5B7',
    '#41B136',
    '#FBD348',
    '#FFAE6A',
    '#D61017',
    '#D9A5FC'
];

function hasMysqlConfig() {
    return !!(process.env.MYSQL_URL || process.env.MYSQLHOST || process.env.MYSQL_HOST);
}

function getMysqlPool() {
    if (!hasMysqlConfig()) {
        return null;
    }

    if (mysqlPool) {
        return mysqlPool;
    }

    var mysql = require('mysql2/promise');

    if (process.env.MYSQL_URL) {
        mysqlPool = mysql.createPool(process.env.MYSQL_URL);
    } else {
        mysqlPool = mysql.createPool({
            host: process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
            user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
            password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
            database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
            port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
            waitForConnections: true,
            connectionLimit: 10
        });
    }

    return mysqlPool;
}

function ensureMysql() {
    var pool = getMysqlPool();
    if (!pool) {
        return Promise.resolve(false);
    }

    if (mysqlReady) {
        return mysqlReady;
    }

    mysqlReady = Promise.resolve()
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS users (' +
                'id VARCHAR(32) PRIMARY KEY,' +
                'username VARCHAR(15) NOT NULL UNIQUE,' +
                'email VARCHAR(255) NOT NULL UNIQUE,' +
                'salt VARCHAR(64) NOT NULL,' +
                'password_hash VARCHAR(256) NOT NULL,' +
                'account_type VARCHAR(20) NOT NULL DEFAULT \'Free\',' +
                'premium_activated_at DATETIME NULL,' +
                'premium_expires_at DATETIME NULL,' +
                'level INT NOT NULL DEFAULT 1,' +
                'xp INT NOT NULL DEFAULT 0,' +
                'points DECIMAL(12,2) NOT NULL DEFAULT 0,' +
                'guild VARCHAR(32) NULL,' +
                'guild_name VARCHAR(32) NULL,' +
                'guild_description VARCHAR(240) NULL,' +
                'guild_type VARCHAR(16) NULL,' +
                'guild_role VARCHAR(16) NULL,' +
                'admin_role VARCHAR(20) NULL,' +
                'skin_url VARCHAR(255) NULL,' +
                'guild_skin_url VARCHAR(255) NULL,' +
                'cell_color VARCHAR(7) NOT NULL DEFAULT \'#6FCA36\',' +
                'email_verified TINYINT(1) NOT NULL DEFAULT 0,' +
                'verification_reward_claimed TINYINT(1) NOT NULL DEFAULT 0,' +
                'verification_token VARCHAR(64) NULL,' +
                'last_login DATETIME NULL,' +
                'reset_token VARCHAR(64) NULL,' +
                'reset_requested_at DATETIME NULL,' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' +
                ')'
            );
        })
        .then(function() {
            var alters = [
                'ALTER TABLE users ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT \'Free\'',
                'ALTER TABLE users MODIFY COLUMN account_type VARCHAR(20) NOT NULL DEFAULT \'Free\'',
                'ALTER TABLE users ADD COLUMN premium_activated_at DATETIME NULL',
                'ALTER TABLE users ADD COLUMN premium_expires_at DATETIME NULL',
                'ALTER TABLE users ADD COLUMN level INT NOT NULL DEFAULT 1',
                'ALTER TABLE users ADD COLUMN xp INT NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN points DECIMAL(12,2) NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN guild VARCHAR(32) NULL',
                'ALTER TABLE users ADD COLUMN guild_name VARCHAR(32) NULL',
                'ALTER TABLE users ADD COLUMN guild_description VARCHAR(240) NULL',
                'ALTER TABLE users ADD COLUMN guild_type VARCHAR(16) NULL',
                'ALTER TABLE users ADD COLUMN guild_role VARCHAR(16) NULL',
                'ALTER TABLE users ADD COLUMN admin_role VARCHAR(20) NULL',
                'ALTER TABLE users ADD COLUMN skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN guild_skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN cell_color VARCHAR(7) NOT NULL DEFAULT \'#6FCA36\'',
                'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN verification_reward_claimed TINYINT(1) NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN verification_token VARCHAR(64) NULL',
                'ALTER TABLE users ADD COLUMN last_login DATETIME NULL'
            ];

            return Promise.all(alters.map(function(sql) {
                return pool.query(sql).catch(function(error) {
                    if (error && error.code == 'ER_DUP_FIELDNAME') {
                        return;
                    }
                    throw error;
                });
            }));
        })
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS sessions (' +
                'token VARCHAR(128) PRIMARY KEY,' +
                'user_id VARCHAR(32) NOT NULL,' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
                'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE' +
                ')'
            );
        })
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS highscores (' +
                'id INT AUTO_INCREMENT PRIMARY KEY,' +
                'player_id VARCHAR(32) NOT NULL,' +
                'player_name VARCHAR(32) NOT NULL,' +
                'game_mode VARCHAR(24) NOT NULL,' +
                'region VARCHAR(32) NOT NULL DEFAULT \'global\',' +
                'top1_time BIGINT NOT NULL DEFAULT 0,' +
                'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
                'INDEX idx_highscores_mode_region_time (game_mode, region, top1_time)' +
                ')'
            );
        })
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS top1_history (' +
                'id INT AUTO_INCREMENT PRIMARY KEY,' +
                'player_id VARCHAR(32) NOT NULL,' +
                'player_name VARCHAR(32) NOT NULL,' +
                'game_mode VARCHAR(24) NOT NULL,' +
                'server_name VARCHAR(64) NOT NULL,' +
                'top1_time BIGINT NOT NULL DEFAULT 0,' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
                'INDEX idx_top1_history_player_time (player_id, created_at)' +
                ')'
            );
        })
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS battle_match_history (' +
                'id INT AUTO_INCREMENT PRIMARY KEY,' +
                'player_id VARCHAR(32) NOT NULL,' +
                'player_name VARCHAR(32) NOT NULL,' +
                'battle_type VARCHAR(8) NOT NULL,' +
                'server_name VARCHAR(64) NOT NULL,' +
                'result VARCHAR(16) NULL,' +
                'duration BIGINT NOT NULL DEFAULT 0,' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
                'INDEX idx_battle_history_player_type_time (player_id, battle_type, created_at)' +
                ')'
            );
        })
        .then(function() {
            return pool.query(
                'CREATE TABLE IF NOT EXISTS guild_invites (' +
                'id INT AUTO_INCREMENT PRIMARY KEY,' +
                'guild VARCHAR(32) NOT NULL,' +
                'guild_name VARCHAR(32) NOT NULL,' +
                'inviter_id VARCHAR(32) NOT NULL,' +
                'target_user_id VARCHAR(32) NOT NULL,' +
                'status VARCHAR(16) NOT NULL DEFAULT \'pending\',' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
                'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
                'INDEX idx_guild_invites_target_status (target_user_id, status),' +
                'INDEX idx_guild_invites_guild_target (guild, target_user_id)' +
                ')'
            );
        })
        .then(function() {
            console.log('[Auth] Using MySQL storage');
            return true;
        });

    return mysqlReady;
}

function ensureJsonDb() {
    var dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({ users: [] }, null, 2));
    }
}

function readJsonDb() {
    ensureJsonDb();
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        return { users: [] };
    }
}

function writeJsonDb(db) {
    ensureJsonDb();
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function normalizeName(name) {
    return String(name || '').trim();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
}

function makeToken() {
    return crypto.randomBytes(32).toString('hex');
}

function getBaseUrl(req) {
    var configuredUrl = process.env.PUBLIC_URL || process.env.APP_URL || process.env.BASE_URL || '';
    if (configuredUrl) {
        return String(configuredUrl).replace(/\/+$/, '');
    }

    var protocol = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    var host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    return protocol + '://' + host;
}

function getMailFrom() {
    return process.env.EMAIL_FROM || process.env.MAIL_FROM || 'Bubble.am <noreply@bubblev2.site>';
}

function getMailAddress(value) {
    var text = String(value || '').trim();
    var match = text.match(/<([^>]+)>/);
    return match ? match[1].trim() : text;
}

function escapeMailHeader(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function dotStuff(value) {
    return String(value || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function readSmtpResponse(socket) {
    return new Promise(function(resolve, reject) {
        var buffer = '';

        function cleanup() {
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
        }

        function onError(error) {
            cleanup();
            reject(error);
        }

        function onData(chunk) {
            buffer += chunk.toString('utf8');
            var lines = buffer.split(/\r?\n/).filter(function(line) {
                return line.length;
            });
            if (lines.length && /^[0-9]{3} /.test(lines[lines.length - 1])) {
                cleanup();
                resolve(buffer);
            }
        }

        socket.on('data', onData);
        socket.on('error', onError);
    });
}

function smtpCommand(socket, command, expectedCode) {
    socket.write(command + '\r\n');
    return readSmtpResponse(socket).then(function(response) {
        if (expectedCode && response.indexOf(String(expectedCode)) !== 0) {
            throw new Error('SMTP command failed: ' + response.trim());
        }
        return response;
    });
}

function sendSmtpEmail(to, subject, html, text) {
    var host = process.env.SMTP_HOST || '';
    var port = Number(process.env.SMTP_PORT || 587);
    var user = process.env.SMTP_USER || '';
    var pass = process.env.SMTP_PASS || '';
    var from = getMailFrom();
    var fromAddress = getMailAddress(from);

    if (!host || !user || !pass || !fromAddress) {
        console.log('[Auth] Email skipped; SMTP env is incomplete. To: %s Subject: %s', to, subject);
        return Promise.resolve(false);
    }

    var socket = net.createConnection({ host: host, port: port });
    var secureSocket = null;

    function activeSocket() {
        return secureSocket || socket;
    }

    function closeSocket() {
        try {
            activeSocket().end();
        } catch (e) {}
    }

    return readSmtpResponse(socket)
        .then(function(response) {
            if (response.indexOf('220') !== 0) {
                throw new Error('SMTP connect failed: ' + response.trim());
            }
            return smtpCommand(socket, 'EHLO bubblev2.site', 250);
        })
        .then(function() {
            return smtpCommand(socket, 'STARTTLS', 220);
        })
        .then(function() {
            secureSocket = tls.connect({
                socket: socket,
                servername: host
            });

            return new Promise(function(resolve, reject) {
                secureSocket.once('secureConnect', resolve);
                secureSocket.once('error', reject);
            });
        })
        .then(function() {
            return smtpCommand(activeSocket(), 'EHLO bubblev2.site', 250);
        })
        .then(function() {
            return smtpCommand(activeSocket(), 'AUTH LOGIN', 334);
        })
        .then(function() {
            return smtpCommand(activeSocket(), Buffer.from(user).toString('base64'), 334);
        })
        .then(function() {
            return smtpCommand(activeSocket(), Buffer.from(pass).toString('base64'), 235);
        })
        .then(function() {
            return smtpCommand(activeSocket(), 'MAIL FROM:<' + fromAddress + '>', 250);
        })
        .then(function() {
            return smtpCommand(activeSocket(), 'RCPT TO:<' + getMailAddress(to) + '>', 250);
        })
        .then(function() {
            return smtpCommand(activeSocket(), 'DATA', 354);
        })
        .then(function() {
            var boundary = 'bubble-' + crypto.randomBytes(8).toString('hex');
            var body = [
                'From: ' + escapeMailHeader(from),
                'To: ' + escapeMailHeader(to),
                'Subject: ' + escapeMailHeader(subject),
                'MIME-Version: 1.0',
                'Content-Type: multipart/alternative; boundary="' + boundary + '"',
                '',
                '--' + boundary,
                'Content-Type: text/plain; charset=UTF-8',
                '',
                dotStuff(text),
                '--' + boundary,
                'Content-Type: text/html; charset=UTF-8',
                '',
                dotStuff(html),
                '--' + boundary + '--',
                '.'
            ].join('\r\n');

            activeSocket().write(body + '\r\n');
            return readSmtpResponse(activeSocket());
        })
        .then(function(response) {
            if (response.indexOf('250') !== 0) {
                throw new Error('SMTP send failed: ' + response.trim());
            }
            return smtpCommand(activeSocket(), 'QUIT', 221).catch(function() {});
        })
        .then(function() {
            closeSocket();
            return true;
        })
        .catch(function(error) {
            closeSocket();
            throw error;
        });
}

function sendResendEmail(to, subject, html, text) {
    var resendKey = process.env.RESEND_API_KEY || '';
    var from = getMailFrom();

    if (!resendKey) {
        console.log('[Auth] Email skipped; RESEND_API_KEY is not configured. To: %s Subject: %s', to, subject);
        return Promise.resolve(false);
    }

    return fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + resendKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: from,
            to: [to],
            subject: subject,
            html: html,
            text: text
        })
    }).then(function(response) {
        if (!response.ok) {
            return response.text().then(function(body) {
                throw new Error(body || 'Email send failed.');
            });
        }

        return true;
    });
}

function sendEmail(to, subject, html, text) {
    if (process.env.SMTP_HOST) {
        return sendSmtpEmail(to, subject, html, text);
    }

    return sendResendEmail(to, subject, html, text);
}

function sendVerificationEmail(user, req) {
    var verifyUrl = getBaseUrl(req) + '/api/verify-email?token=' + encodeURIComponent(user.verificationToken);
    var subject = 'Verifikasi email Bubble.am';
    var text = 'Halo ' + user.username + ', buka link ini untuk verifikasi email Anda: ' + verifyUrl;
    var html = '' +
        '<p>Halo <b>' + user.username + '</b>,</p>' +
        '<p>Klik tombol di bawah ini untuk verifikasi email Bubble.am.</p>' +
        '<p><a href="' + verifyUrl + '" style="display:inline-block;padding:10px 14px;background:#337ab7;color:#fff;text-decoration:none;border-radius:4px;">Verifikasi email</a></p>' +
        '<p>Jika tombol tidak bisa dibuka, salin link ini:</p>' +
        '<p>' + verifyUrl + '</p>';

    return sendEmail(user.email, subject, html, text);
}

function getNextLevelXp(level) {
    return Math.max(1, (Number(level || 1) * 400) + 50);
}

function normalizeCellColor(color) {
    var value = String(color || '').trim().toUpperCase();
    return allowedCellColors.indexOf(value) != -1 ? value : '#6FCA36';
}

function isAllowedCellColor(color) {
    return allowedCellColors.indexOf(String(color || '').trim().toUpperCase()) != -1;
}

function parseDateValue(value) {
    if (!value) {
        return null;
    }

    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

function toMysqlDate(date) {
    if (!date) {
        return null;
    }

    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function toPublicDate(value) {
    var date = parseDateValue(value);
    return date ? date.toISOString() : null;
}

function isPremiumActive(user, now) {
    var expiresAt = parseDateValue(user && user.premiumExpiresAt);
    return !!expiresAt && expiresAt.getTime() > (now || Date.now());
}

function applyPremiumState(user, now) {
    if (!user) {
        return user;
    }

    if (isPremiumActive(user, now)) {
        user.accountType = 'Premium';
    } else {
        if (String(user.accountType || '').toLowerCase() == 'premium' && user.premiumExpiresAt && parseDateValue(user.premiumExpiresAt) && parseDateValue(user.premiumExpiresAt).getTime() <= (now || Date.now())) {
            user._premiumExpired = true;
        }
        user.accountType = 'Free';
        if (user.premiumExpiresAt && parseDateValue(user.premiumExpiresAt) && parseDateValue(user.premiumExpiresAt).getTime() <= (now || Date.now())) {
            user.premiumExpiresAt = null;
            user.premiumActivatedAt = null;
        }
    }

    return user;
}

function publicUser(user) {
    applyPremiumState(user);
    var level = Number(user.level || 1);
    var xp = Number(user.xp || 0);
    var premiumExpiresAt = toPublicDate(user.premiumExpiresAt);
    var premiumActivatedAt = toPublicDate(user.premiumActivatedAt);
    var premiumRemainingMs = premiumExpiresAt ? Math.max(0, parseDateValue(premiumExpiresAt).getTime() - Date.now()) : 0;

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        accountType: user.accountType || 'Free',
        premiumStatus: isPremiumActive(user) ? 'Active' : 'Inactive',
        premiumActivatedAt: premiumActivatedAt,
        premiumExpiresAt: premiumExpiresAt,
        premiumRemainingMs: premiumRemainingMs,
        premiumExpired: !!user._premiumExpired,
        level: level,
        xp: xp,
        nextLevelXp: getNextLevelXp(level),
        points: Number(user.points || 0),
        guild: user.guild || '',
        guildName: user.guildName || user.guild || '',
        guildDescription: user.guildDescription || '',
        guildType: user.guildType || '',
        guildRole: user.guildRole || '',
        adminRole: user.adminRole || user.role || '',
        skinUrl: user.skinUrl || '',
        guildSkinUrl: user.guildSkinUrl || '',
        cellColor: normalizeCellColor(user.cellColor),
        lastLogin: user.lastLogin || null
    };
}

function mysqlUser(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        username: row.username,
        email: row.email,
        salt: row.salt,
        passwordHash: row.password_hash,
        accountType: row.account_type,
        premiumActivatedAt: row.premium_activated_at,
        premiumExpiresAt: row.premium_expires_at,
        level: row.level,
        xp: row.xp,
        points: row.points,
        guild: row.guild,
        guildName: row.guild_name,
        guildDescription: row.guild_description,
        guildType: row.guild_type,
        guildRole: row.guild_role,
        adminRole: row.admin_role,
        skinUrl: row.skin_url,
        guildSkinUrl: row.guild_skin_url,
        cellColor: row.cell_color,
        lastLogin: row.last_login,
        createdAt: row.created_at,
        emailVerified: row.email_verified,
        verificationRewardClaimed: row.verification_reward_claimed,
        verificationToken: row.verification_token
    };
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(JSON.stringify(payload));
}

function readBody(req, callback) {
    var body = '';

    req.on('data', function(chunk) {
        body += chunk;
        if (body.length > 1024 * 32) {
            req.connection.destroy();
        }
    });

    req.on('end', function() {
        try {
            callback(null, body ? JSON.parse(body) : {});
        } catch (e) {
            callback(e);
        }
    });
}

function readRawBody(req, maxSize, callback, sizeErrorMessage) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;

    req.on('data', function(chunk) {
        if (tooLarge) {
            return;
        }

        size += chunk.length;
        if (size > maxSize) {
            tooLarge = true;
            chunks = [];
            return;
        }

        chunks.push(chunk);
    });

    req.on('end', function() {
        if (tooLarge) {
            callback(new Error(sizeErrorMessage || 'File terlalu besar.'));
            return;
        }

        callback(null, Buffer.concat(chunks));
    });
}

function parseMultipartFile(req, body) {
    var contentType = req.headers['content-type'] || '';
    var boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
        return null;
    }

    var boundary = Buffer.from('--' + (boundaryMatch[1] || boundaryMatch[2]));
    var start = body.indexOf(boundary);
    while (start !== -1) {
        var next = body.indexOf(boundary, start + boundary.length);
        if (next === -1) {
            break;
        }

        var part = body.slice(start + boundary.length + 2, next - 2);
        var headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd !== -1) {
            var headers = part.slice(0, headerEnd).toString('utf8');
            var content = part.slice(headerEnd + 4);
            if (/name="skin"/i.test(headers) && /filename="/i.test(headers)) {
                var filenameMatch = headers.match(/filename="([^"]*)"/i);
                var typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
                return {
                    filename: filenameMatch ? filenameMatch[1] : 'skin.png',
                    contentType: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream',
                    buffer: content
                };
            }
        }

        start = next;
    }

    return null;
}

function getSkinExtension(contentType) {
    if (contentType == 'image/png') {
        return 'png';
    }

    return null;
}

function isPngSkin(file) {
    return !!(file && String(file.contentType || '').toLowerCase() == 'image/png');
}

function uploadSkinObject(user, file, bucket, folder) {
    var supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    var extension = getSkinExtension(file.contentType);

    if (!supabaseUrl || !serviceKey) {
        return Promise.reject(new Error('Supabase storage belum dikonfigurasi.'));
    }

    if (!extension) {
        return Promise.reject(new Error('Skin must be a PNG file.'));
    }

    var objectPath = folder + '/' + user.id + '-' + Date.now() + '.' + extension;
    var uploadUrl = supabaseUrl + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + objectPath;

    return fetch(uploadUrl, {
        method: 'POST',
        headers: {
            apikey: serviceKey,
            Authorization: 'Bearer ' + serviceKey,
            'Content-Type': file.contentType,
            'x-upsert': 'true'
        },
        body: file.buffer
    }).then(function(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                throw new Error(text || 'Upload Supabase gagal.');
            });
        }

        return supabaseUrl + '/storage/v1/object/public/' + bucket + '/' + objectPath;
    });
}

function uploadPlayerSkin(user, file) {
    return uploadSkinObject(user, file, process.env.SUPABASE_BUCKET || 'skins', 'players');
}

function uploadGuildSkin(user, file) {
    return uploadSkinObject(user, file, process.env.SUPABASE_GUILD_BUCKET || 'guilds', 'skins');
}

function getAuthToken(req) {
    var header = req.headers.authorization || '';
    return header.replace(/^Bearer\s+/i, '');
}

function requireUser(req, res) {
    var token = getAuthToken(req);

    if (!token) {
        sendJson(res, 401, { ok: false, error: 'Belum login.' });
        return Promise.resolve(null);
    }

    return findUserByToken(token).then(function(user) {
        if (!user) {
            sendJson(res, 401, { ok: false, error: 'Session tidak valid.' });
            return null;
        }

        return expirePremiumIfNeeded(user);
    });
}

function optionalUser(req) {
    var token = getAuthToken(req);
    if (!token) {
        return Promise.resolve(null);
    }
    return findUserByToken(token).then(expirePremiumIfNeeded);
}

function handleError(res, err) {
    console.error('[Auth] Error:', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'Server auth error.' });
}

function handleUploadError(res, error, fallback) {
    var message = error && error.message ? String(error.message) : fallback;
    console.error('[Auth] Upload error:', message);
    sendJson(res, 400, { ok: false, error: message || fallback || 'Upload gagal.' });
}

function findJsonUserByLogin(db, login) {
    var value = String(login || '').trim().toLowerCase();

    for (var i = 0; i < db.users.length; i++) {
        var user = db.users[i];
        if (user.username.toLowerCase() == value || user.email.toLowerCase() == value) {
            return user;
        }
    }

    return null;
}

function findJsonUserByUsername(db, username) {
    var value = String(username || '').trim().toLowerCase();

    for (var i = 0; i < db.users.length; i++) {
        var user = db.users[i];
        if (user.username && user.username.toLowerCase() == value) {
            return user;
        }
    }

    return null;
}

function findUserByLogin(login) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1', [
                    String(login || '').trim().toLowerCase(),
                    String(login || '').trim().toLowerCase()
                ])
                .then(function(result) {
                    return mysqlUser(result[0][0]);
                });
        }

        return findJsonUserByLogin(readJsonDb(), login);
    });
}

function findUserByUsername(username) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT * FROM users WHERE LOWER(username) = ? LIMIT 1', [
                    String(username || '').trim().toLowerCase()
                ])
                .then(function(result) {
                    return mysqlUser(result[0][0]);
                });
        }

        return findJsonUserByUsername(readJsonDb(), username);
    });
}

function findUserById(id) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
                .then(function(result) {
                    return mysqlUser(result[0][0]);
                });
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == id) {
                return db.users[i];
            }
        }

        return null;
    });
}

function createUser(user) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query(
                    'INSERT INTO users (id, username, email, salt, password_hash, email_verified, verification_reward_claimed, verification_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [user.id, user.username, user.email, user.salt, user.passwordHash, Number(user.emailVerified || 0), Number(user.verificationRewardClaimed || 0), user.verificationToken || null]
                )
                .then(function() {
                    return user;
                });
        }

        var db = readJsonDb();
        db.users.push(user);
        writeJsonDb(db);
        return user;
    });
}

function createSession(token, userId) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId])
                .then(function() {
                    return token;
                });
        }

        memorySessions[token] = userId;
        return token;
    });
}

function updateLastLogin(userId) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool().query('UPDATE users SET last_login = NOW() WHERE id = ?', [userId]);
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == userId) {
                db.users[i].lastLogin = new Date().toISOString();
                writeJsonDb(db);
                return;
            }
        }
    });
}

function findUserByToken(token) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query(
                    'SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ? LIMIT 1',
                    [token]
                )
                .then(function(result) {
                    return mysqlUser(result[0][0]);
                });
        }

        return findUserById(memorySessions[token]);
    });
}

function setResetToken(userId, token) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE users SET reset_token = ?, reset_requested_at = NOW() WHERE id = ?', [token, userId]);
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == userId) {
                db.users[i].resetToken = token;
                db.users[i].resetRequestedAt = new Date().toISOString();
                writeJsonDb(db);
                return;
            }
        }
    });
}

function savePasswordCredentials(userId, salt, passwordHash) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?', [salt, passwordHash, userId]);
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == userId) {
                db.users[i].salt = salt;
                db.users[i].passwordHash = passwordHash;
                writeJsonDb(db);
                return;
            }
        }
    });
}

function verifyEmailToken(token) {
    token = String(token || '').trim();
    if (!token) {
        return Promise.resolve(null);
    }

    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT * FROM users WHERE verification_token = ? LIMIT 1', [token])
                .then(function(result) {
                    var user = mysqlUser(result[0][0]);
                    if (!user) {
                        return null;
                    }

                    var shouldReward = Number(user.verificationRewardClaimed || 0) !== 1;
                    var rewardPoints = shouldReward ? EMAIL_VERIFICATION_REWARD : 0;
                    return getMysqlPool()
                        .query(
                            'UPDATE users SET email_verified = 1, verification_token = NULL, verification_reward_claimed = 1, points = points + ? WHERE id = ?',
                            [rewardPoints, user.id]
                        )
                        .then(function() {
                            user.emailVerified = 1;
                            user.verificationToken = null;
                            user.verificationRewardClaimed = 1;
                            user.points = Number(user.points || 0) + rewardPoints;
                            user.verificationRewardPoints = rewardPoints;
                            return user;
                        });
                });
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].verificationToken == token) {
                var shouldReward = Number(db.users[i].verificationRewardClaimed || 0) !== 1;
                var rewardPoints = shouldReward ? EMAIL_VERIFICATION_REWARD : 0;
                db.users[i].emailVerified = 1;
                db.users[i].verificationRewardClaimed = 1;
                db.users[i].points = Number(db.users[i].points || 0) + rewardPoints;
                db.users[i].verificationToken = null;
                writeJsonDb(db);
                db.users[i].verificationRewardPoints = rewardPoints;
                return db.users[i];
            }
        }

        return null;
    });
}

function applyXp(user, amount) {
    var gained = Math.max(0, Math.floor(Number(amount || 0)));
    var level = Math.max(1, Number(user.level || 1));
    var xp = Math.max(0, Number(user.xp || 0)) + gained;

    while (xp >= getNextLevelXp(level)) {
        xp -= getNextLevelXp(level);
        level++;
    }

    user.level = level;
    user.xp = xp;
    return user;
}

function saveUserXp(user) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE users SET level = ?, xp = ? WHERE id = ?', [user.level, user.xp, user.id])
                .then(function() {
                    return user;
                });
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == user.id) {
                db.users[i].level = user.level;
                db.users[i].xp = user.xp;
                writeJsonDb(db);
                return user;
            }
        }

        return user;
    });
}

function awardXp(userId, amount, reason) {
    if (!userId) {
        return Promise.resolve(null);
    }

    return findUserById(userId)
        .then(function(user) {
            if (!user) {
                return null;
            }

            applyXp(user, amount);
            return saveUserXp(user).then(function(savedUser) {
                if (amount > 0) {
                    console.log('[Auth] XP +%d for %s (%s)', Math.floor(Number(amount || 0)), savedUser.username, reason || 'xp');
                }
                return publicUser(savedUser);
            });
        });
}

function adjustPoints(userId, amount, reason) {
    if (!userId || !amount) {
        return Promise.resolve(null);
    }

    var delta = Number(amount || 0);
    return findUserById(userId)
        .then(function(user) {
            if (!user) {
                return null;
            }

            user.points = Math.max(0, Number(user.points || 0) + delta);
            return saveAccountFields(user).then(function(savedUser) {
                console.log('[Auth] Points %s%s for %s (%s)', delta >= 0 ? '+' : '', delta, savedUser.username, reason || 'points');
                return publicUser(savedUser);
            });
        });
}

function grantPointsByUsername(username, amount, reason) {
    var delta = Number(amount || 0);
    if (!username || !delta) {
        return Promise.resolve(null);
    }

    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE users SET points = GREATEST(0, points + ?) WHERE LOWER(username) = ?', [
                    delta,
                    String(username || '').trim().toLowerCase()
                ])
                .then(function(result) {
                    if (!result[0] || !result[0].affectedRows) {
                        return null;
                    }

                    return findUserByUsername(username).then(function(savedUser) {
                        console.log('[Auth] Points %s%s for %s (%s)', delta >= 0 ? '+' : '', delta, savedUser.username, reason || 'points');
                        return publicUser(savedUser);
                    });
                });
        }

        var user = findJsonUserByUsername(readJsonDb(), username);
        if (!user) {
            return null;
        }

        user.points = Math.max(0, Number(user.points || 0) + delta);
        return saveAccountFields(user).then(function(savedUser) {
            console.log('[Auth] Points %s%s for %s (%s)', delta >= 0 ? '+' : '', delta, savedUser.username, reason || 'points');
            return publicUser(savedUser);
        });
    });
}

function handleRegister(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var username = normalizeName(body.username);
        var email = normalizeEmail(body.email);
        var password = String(body.password || '');

        if (!username || username.length > 15) {
            sendJson(res, 400, { ok: false, error: 'Username wajib diisi, maksimal 15 karakter.' });
            return;
        }

        if (!/^[A-Za-z0-9]+$/.test(username)) {
            sendJson(res, 400, { ok: false, error: 'Username hanya boleh huruf A-Z dan angka 0-9.' });
            return;
        }

        if (!email || email.indexOf('@') == -1) {
            sendJson(res, 400, { ok: false, error: 'Email tidak valid.' });
            return;
        }

        if (password.length < 4) {
            sendJson(res, 400, { ok: false, error: 'Password minimal 4 karakter.' });
            return;
        }

        Promise.all([findUserByLogin(username), findUserByLogin(email)])
            .then(function(results) {
                if (results[0]) {
                    sendJson(res, 409, { ok: false, error: 'Username sudah dipakai.' });
                    return null;
                }

                if (results[1]) {
                    sendJson(res, 409, { ok: false, error: 'Email sudah dipakai.' });
                    return null;
                }

                var salt = crypto.randomBytes(16).toString('hex');
                var verificationToken = makeToken();
                return createUser({
                    id: crypto.randomBytes(12).toString('hex'),
                    username: username,
                    email: email,
                    salt: salt,
                    passwordHash: hashPassword(password, salt),
                    accountType: 'Free',
                    premiumActivatedAt: null,
                    premiumExpiresAt: null,
                    level: 1,
                    xp: 0,
                    points: 0,
                    guild: '',
                    skinUrl: '',
                    guildSkinUrl: '',
                    cellColor: '#6FCA36',
                    emailVerified: 0,
                    verificationRewardClaimed: 0,
                    verificationToken: verificationToken,
                    lastLogin: null,
                    createdAt: new Date().toISOString()
                });
            })
            .then(function(user) {
                if (user) {
                    console.log('[Auth] Verification token for %s: %s', user.email, user.verificationToken);
                    return sendVerificationEmail(user, req).then(function(sent) {
                        sendJson(res, 201, {
                            ok: true,
                            message: sent
                                ? 'Register berhasil. Silakan cek email Anda untuk verifikasi.'
                                : 'Register berhasil, tetapi email belum terkirim karena konfigurasi email belum aktif.',
                            user: publicUser(user)
                        });
                    });
                }
            })
            .catch(function(error) {
                if (error && error.code == 'ER_DUP_ENTRY') {
                    sendJson(res, 409, { ok: false, error: 'Username atau email sudah dipakai.' });
                    return;
                }
                handleError(res, error);
            });
    });
}

function handleLogin(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var login = normalizeName(body.login || body.username);
        var password = String(body.password || '');

        findUserByLogin(login)
            .then(function(user) {
                if (!user || hashPassword(password, user.salt) != user.passwordHash) {
                    sendJson(res, 401, { ok: false, error: 'Username/email atau password salah.' });
                    return null;
                }

                if (Number(user.emailVerified || 0) !== 1) {
                    sendJson(res, 403, {
                        ok: false,
                        error: 'Email belum diverifikasi. Silakan cek email Anda.'
                    });
                    return null;
                }

                var token = makeToken();
                user.lastLogin = new Date().toISOString();
                return updateLastLogin(user.id).then(function() {
                    return createSession(token, user.id);
                }).then(function() {
                    sendJson(res, 200, { ok: true, token: token, user: publicUser(user) });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function handleForgotPassword(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var email = normalizeEmail(body.email);

        findUserByLogin(email)
            .then(function(user) {
                if (!user) {
                    sendJson(res, 200, { ok: true, message: 'Jika email terdaftar, instruksi reset sudah dibuat.' });
                    return null;
                }

                var token = crypto.randomBytes(16).toString('hex');
                return setResetToken(user.id, token).then(function() {
                    console.log('[Auth] Reset password token for %s: %s', user.email, token);
                    sendJson(res, 200, { ok: true, message: 'Jika email terdaftar, instruksi reset sudah dibuat.' });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function sendHtml(res, statusCode, body) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function handleVerifyEmail(req, res) {
    var parsedUrl = new URL(req.url, 'http://localhost');
    var token = parsedUrl.searchParams.get('token') || '';

    verifyEmailToken(token)
        .then(function(user) {
            if (!user) {
                sendHtml(res, 400, '<h2>Verifikasi gagal</h2><p>Token verifikasi tidak valid atau sudah digunakan.</p>');
                return;
            }

            var rewardPoints = Number(user.verificationRewardPoints || 0);
            var rewardText = rewardPoints > 0
                ? '<h2>Congratulations!</h2><p>Your email has been verified.</p><p>You received ' + rewardPoints + ' Points.</p>'
                : '<h2>Email sudah diverifikasi</h2><p>Akun ini sudah terverifikasi dan reward verifikasi sudah pernah diklaim.</p>';
            sendHtml(res, 200, rewardText + '<p>Silakan kembali ke game dan login.</p><p><a href="/">Kembali ke Bubble.am</a></p>');
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function handleMe(req, res) {
    requireUser(req, res)
        .then(function(user) {
            if (!user) {
                return;
            }

            sendJson(res, 200, { ok: true, user: publicUser(user) });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function saveAccountColor(userId, color) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE users SET cell_color = ? WHERE id = ?', [color, userId]);
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == userId) {
                db.users[i].cellColor = color;
                writeJsonDb(db);
                return;
            }
        }
    });
}

function saveAccountFields(user) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query(
                    'UPDATE users SET account_type = ?, premium_activated_at = ?, premium_expires_at = ?, points = ?, guild = ?, guild_name = ?, guild_description = ?, guild_type = ?, guild_role = ?, skin_url = ?, guild_skin_url = ? WHERE id = ?',
                    [user.accountType || 'Free', toMysqlDate(parseDateValue(user.premiumActivatedAt)), toMysqlDate(parseDateValue(user.premiumExpiresAt)), Number(user.points || 0), user.guild || null, user.guildName || null, user.guildDescription || null, user.guildType || null, user.guildRole || null, user.skinUrl || null, user.guildSkinUrl || null, user.id]
                )
                .then(function() {
                    return user;
                });
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == user.id) {
                db.users[i].accountType = user.accountType || 'Free';
                db.users[i].premiumActivatedAt = user.premiumActivatedAt || null;
                db.users[i].premiumExpiresAt = user.premiumExpiresAt || null;
                db.users[i].points = Number(user.points || 0);
                db.users[i].guild = user.guild || '';
                db.users[i].guildName = user.guildName || user.guild || '';
                db.users[i].guildDescription = user.guildDescription || '';
                db.users[i].guildType = user.guildType || '';
                db.users[i].guildRole = user.guildRole || '';
                db.users[i].skinUrl = user.skinUrl || '';
                db.users[i].guildSkinUrl = user.guildSkinUrl || '';
                writeJsonDb(db);
                return user;
            }
        }

        return user;
    });
}

function expirePremiumIfNeeded(user) {
    if (!user) {
        return Promise.resolve(user);
    }

    var wasPremium = String(user.accountType || '').toLowerCase() == 'premium';
    var expiresAt = parseDateValue(user.premiumExpiresAt);
    if (wasPremium && (!expiresAt || expiresAt.getTime() <= Date.now())) {
        user.accountType = 'Free';
        user.premiumActivatedAt = null;
        user.premiumExpiresAt = null;
        user._premiumExpired = true;
        return saveAccountFields(user).then(function(savedUser) {
            savedUser._premiumExpired = true;
            return savedUser;
        });
    }

    applyPremiumState(user);
    return Promise.resolve(user);
}

function expirePremiumAccounts() {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query(
                    'UPDATE users SET account_type = ?, premium_activated_at = NULL, premium_expires_at = NULL WHERE account_type = ? AND premium_expires_at IS NOT NULL AND premium_expires_at <= NOW()',
                    ['Free', 'Premium']
                )
                .then(function(result) {
                    var changed = result && result[0] ? Number(result[0].affectedRows || 0) : 0;
                    if (changed > 0) {
                        console.log('[Auth] Expired Premium accounts:', changed);
                    }
                });
        }

        var db = readJsonDb();
        var changed = 0;
        (db.users || []).forEach(function(user) {
            var expiresAt = parseDateValue(user.premiumExpiresAt);
            if (String(user.accountType || '').toLowerCase() == 'premium' && (!expiresAt || expiresAt.getTime() <= Date.now())) {
                user.accountType = 'Free';
                user.premiumActivatedAt = null;
                user.premiumExpiresAt = null;
                changed++;
            }
        });
        if (changed > 0) {
            writeJsonDb(db);
            console.log('[Auth] Expired Premium accounts:', changed);
        }
    }).catch(function(error) {
        console.error('[Auth] Premium expiry sweep failed:', error && error.message ? error.message : error);
    });
}

function startPremiumExpiryRuntime() {
    if (premiumExpiryTimer) {
        return;
    }

    expirePremiumAccounts();
    premiumExpiryTimer = setInterval(expirePremiumAccounts, 60 * 1000);
}

function normalizeGuildTag(tag) {
    return String(tag || '').trim().toUpperCase();
}

function normalizeGuildName(name, fallback) {
    name = String(name || '').trim();
    return name || fallback;
}

function normalizeGuildType(type) {
    type = String(type || '').trim().toLowerCase();
    return type == 'public' ? 'public' : 'private';
}

function normalizeGuildRole(role) {
    role = String(role || '').trim().toLowerCase();
    if (role == 'leader') {
        return 'Leader';
    }
    if (role == 'staff') {
        return 'Staff';
    }
    return 'Member';
}

function guildKey(user) {
    return normalizeGuildTag(user.guild || user.guildTag || '');
}

function summarizeGuildUsers(users) {
    var map = {};

    users.forEach(function(user) {
        var tag = guildKey(user);
        if (!tag) {
            return;
        }

        if (!map[tag]) {
            map[tag] = {
                id: tag,
                name: normalizeGuildName(user.guildName, tag),
                tag: tag,
                description: user.guildDescription || '',
                logo: user.guildSkinUrl || '',
                members: 0,
                status: user.guildType ? String(user.guildType).charAt(0).toUpperCase() + String(user.guildType).slice(1) : '-'
            };
        }

        map[tag].members++;
        if (!map[tag].logo && user.guildSkinUrl) {
            map[tag].logo = user.guildSkinUrl;
        }
        if (!map[tag].description && user.guildDescription) {
            map[tag].description = user.guildDescription;
        }
        if (user.guildName && user.guildName.length > map[tag].name.length) {
            map[tag].name = user.guildName;
        }
        if (user.guildType && map[tag].status == '-') {
            map[tag].status = String(user.guildType).charAt(0).toUpperCase() + String(user.guildType).slice(1);
        }
    });

    return Object.keys(map).sort(function(a, b) {
        return map[a].name.localeCompare(map[b].name);
    }).map(function(key) {
        return map[key];
    });
}

function listGuilds() {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT guild, guild_name, guild_description, guild_type, guild_skin_url FROM users WHERE guild IS NOT NULL AND guild <> \'\'')
                .then(function(result) {
                    return summarizeGuildUsers(result[0].map(function(row) {
                        return {
                            guild: row.guild,
                            guildName: row.guild_name,
                            guildDescription: row.guild_description,
                            guildType: row.guild_type,
                            guildSkinUrl: row.guild_skin_url
                        };
                    }));
                });
        }

        return summarizeGuildUsers(readJsonDb().users || []);
    });
}

function guildRoleRank(role) {
    role = normalizeGuildRole(role);
    return role == 'Leader' ? 0 : (role == 'Staff' ? 1 : 2);
}

function publicGuildMember(user) {
    return {
        id: user.id,
        nick: user.username,
        level: Number(user.level || 1),
        role: normalizeGuildRole(user.guildRole || 'Member')
    };
}

function listGuildMembers(tag) {
    tag = normalizeGuildTag(tag);
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT id, username, level, guild_role FROM users WHERE guild = ?', [tag])
                .then(function(result) {
                    return result[0].map(function(row) {
                        return publicGuildMember({
                            id: row.id,
                            username: row.username,
                            level: row.level,
                            guildRole: row.guild_role
                        });
                    });
                });
        }

        return (readJsonDb().users || []).filter(function(user) {
            return normalizeGuildTag(user.guild) == tag;
        }).map(publicGuildMember);
    }).then(function(members) {
        members = members.sort(function(a, b) {
            var roleDiff = guildRoleRank(a.role) - guildRoleRank(b.role);
            if (roleDiff) {
                return roleDiff;
            }
            return String(a.nick || '').localeCompare(String(b.nick || ''));
        });
        var hasLeader = members.some(function(member) {
            return member.role == 'Leader';
        });
        if (!hasLeader && members.length) {
            members[0].role = 'Leader';
        }
        return members;
    });
}

function userHasPendingGuildInvite(userId, tag) {
    tag = normalizeGuildTag(tag);
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT id FROM guild_invites WHERE target_user_id = ? AND guild = ? AND status = ? LIMIT 1', [userId, tag, 'pending'])
                .then(function(result) {
                    return result[0].length > 0;
                });
        }

        var invites = readJsonDb().guildInvites || [];
        return invites.some(function(invite) {
            return String(invite.targetUserId || invite.target_user_id) == String(userId) &&
                normalizeGuildTag(invite.guild) == tag &&
                String(invite.status || 'pending') == 'pending';
        });
    });
}

function listGuildInviteNotifications(userId) {
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('SELECT id, guild, guild_name, created_at FROM guild_invites WHERE target_user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50', [userId, 'pending'])
                .then(function(result) {
                    return result[0].map(function(row) {
                        return {
                            id: row.id,
                            type: 'guild_invite',
                            guild: row.guild,
                            guildName: row.guild_name,
                            createdAt: row.created_at
                        };
                    });
                });
        }

        return (readJsonDb().guildInvites || []).filter(function(invite) {
            return String(invite.targetUserId || invite.target_user_id) == String(userId) &&
                String(invite.status || 'pending') == 'pending';
        }).sort(function(a, b) {
            return new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0);
        }).slice(0, 50).map(function(invite) {
            return {
                id: invite.id,
                type: 'guild_invite',
                guild: normalizeGuildTag(invite.guild),
                guildName: invite.guildName || invite.guild_name || invite.guild,
                createdAt: invite.createdAt || invite.created_at || null
            };
        });
    });
}

function createGuildInvite(actor, target, guild) {
    var tag = normalizeGuildTag(guild.tag || actor.guild);
    var guildName = normalizeGuildName(guild.name || actor.guildName, tag);
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE guild_invites SET status = ? WHERE target_user_id = ? AND guild = ? AND status = ?', ['cancelled', target.id, tag, 'pending'])
                .then(function() {
                    return getMysqlPool().query(
                        'INSERT INTO guild_invites (guild, guild_name, inviter_id, target_user_id, status) VALUES (?, ?, ?, ?, ?)',
                        [tag, guildName, actor.id, target.id, 'pending']
                    );
                });
        }

        var db = readJsonDb();
        db.guildInvites = db.guildInvites || [];
        db.guildInvites.forEach(function(invite) {
            if (String(invite.targetUserId) == String(target.id) && normalizeGuildTag(invite.guild) == tag && String(invite.status || 'pending') == 'pending') {
                invite.status = 'cancelled';
            }
        });
        db.guildInvites.push({
            id: 'invite_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            guild: tag,
            guildName: guildName,
            inviterId: actor.id,
            targetUserId: target.id,
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        writeJsonDb(db);
    });
}

function acceptGuildInvite(userId, tag) {
    tag = normalizeGuildTag(tag);
    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            return getMysqlPool()
                .query('UPDATE guild_invites SET status = ? WHERE target_user_id = ? AND guild = ? AND status = ?', ['accepted', userId, tag, 'pending']);
        }

        var db = readJsonDb();
        db.guildInvites = db.guildInvites || [];
        db.guildInvites.forEach(function(invite) {
            if (String(invite.targetUserId || invite.target_user_id) == String(userId) && normalizeGuildTag(invite.guild) == tag && String(invite.status || 'pending') == 'pending') {
                invite.status = 'accepted';
            }
        });
        writeJsonDb(db);
    });
}

function normalizeHighscoreMode(mode) {
    mode = String(mode || '').trim().toLowerCase();
    var aliases = {
        ffa: 'ffa',
        hardcore: 'hardcore',
        hc: 'hardcore',
        x5: 'x5',
        exp: 'x5',
        'battle-1v1': 'battle_1v1',
        'battle_1v1': 'battle_1v1',
        '1v1': 'battle_1v1',
        'battle-2v2': 'battle_2v2',
        'battle_2v2': 'battle_2v2',
        '2v2': 'battle_2v2'
    };
    return aliases[mode] || 'ffa';
}

function normalizeHighscoreRegion(region) {
    region = String(region || '').trim().toLowerCase();
    var aliases = {
        global: 'global',
        indonesia: 'indonesia',
        asia: 'asia',
        europe: 'europe',
        america: 'america'
    };
    return aliases[region] || 'global';
}

function listHighscores(mode, region) {
    mode = normalizeHighscoreMode(mode);
    region = normalizeHighscoreRegion(region);

    return ensureMysql().then(function(usingMysql) {
        if (usingMysql) {
            var sql = 'SELECT player_id, player_name, game_mode, region, top1_time FROM highscores WHERE game_mode = ?';
            var params = [mode];
            if (region != 'global') {
                sql += ' AND region = ?';
                params.push(region);
            }
            sql += ' ORDER BY top1_time DESC LIMIT 100';

            return getMysqlPool().query(sql, params).then(function(result) {
                return result[0].map(function(row) {
                    return {
                        playerId: row.player_id,
                        playerName: row.player_name,
                        gameMode: row.game_mode,
                        region: row.region,
                        top1Time: Number(row.top1_time || 0)
                    };
                });
            });
        }

        var rows = readJsonDb().highscores || [];
        return rows.filter(function(row) {
            var rowMode = normalizeHighscoreMode(row.game_mode || row.gameMode);
            var rowRegion = normalizeHighscoreRegion(row.region);
            return rowMode == mode && (region == 'global' || rowRegion == region);
        }).sort(function(a, b) {
            return Number(b.top1_time || b.top1Time || 0) - Number(a.top1_time || a.top1Time || 0);
        }).slice(0, 100).map(function(row) {
            return {
                playerId: row.player_id || row.playerId || '',
                playerName: row.player_name || row.playerName || '',
                gameMode: normalizeHighscoreMode(row.game_mode || row.gameMode),
                region: normalizeHighscoreRegion(row.region),
                top1Time: Number(row.top1_time || row.top1Time || 0)
            };
        });
    });
}

function publicPlayerProfile(user) {
    applyPremiumState(user);
    return {
        id: user.id,
        name: user.username,
        level: Number(user.level || 1),
        points: Number(user.points || 0),
        guild: user.guild || '',
        game: user.lastLogin || null,
        status: user.accountType || 'Free',
        guildSkinUrl: user.guildSkinUrl || '',
        playerSkinUrl: user.skinUrl || ''
    };
}

function mapTop1HistoryRow(row) {
    return {
        createdAt: row.created_at || row.createdAt || null,
        server: row.server_name || row.server || row.game_mode || row.gameMode || '',
        top1Time: Number(row.top1_time || row.top1Time || 0)
    };
}

function mapBattleHistoryRow(row) {
    return {
        createdAt: row.created_at || row.createdAt || null,
        server: row.server_name || row.server || '',
        result: row.result || '',
        duration: Number(row.duration || 0)
    };
}

function getPlayerProfile(search) {
    return findUserByLogin(search).then(function(user) {
        if (!user) {
            return null;
        }

        return ensureMysql().then(function(usingMysql) {
            if (usingMysql) {
                return Promise.all([
                    getMysqlPool().query('SELECT created_at, server_name, top1_time FROM top1_history WHERE player_id = ? ORDER BY created_at DESC LIMIT 100', [user.id]),
                    getMysqlPool().query('SELECT created_at, server_name, result, duration FROM battle_match_history WHERE player_id = ? AND battle_type = ? ORDER BY created_at DESC LIMIT 100', [user.id, '2v2']),
                    getMysqlPool().query('SELECT created_at, server_name, result, duration FROM battle_match_history WHERE player_id = ? AND battle_type = ? ORDER BY created_at DESC LIMIT 100', [user.id, '1v1'])
                ]).then(function(result) {
                    return {
                        player: publicPlayerProfile(user),
                        top1: result[0][0].map(mapTop1HistoryRow),
                        battle2v2: result[1][0].map(mapBattleHistoryRow),
                        battle1v1: result[2][0].map(mapBattleHistoryRow)
                    };
                });
            }

            var db = readJsonDb();
            var top1 = (db.top1History || []).filter(function(row) {
                return String(row.player_id || row.playerId || '') == String(user.id);
            }).sort(function(a, b) {
                return new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0);
            }).slice(0, 100).map(mapTop1HistoryRow);

            function battleRows(type) {
                return (db.battleMatchHistory || []).filter(function(row) {
                    return String(row.player_id || row.playerId || '') == String(user.id) &&
                        String(row.battle_type || row.battleType || '').toLowerCase() == type;
                }).sort(function(a, b) {
                    return new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0);
                }).slice(0, 100).map(mapBattleHistoryRow);
            }

            return {
                player: publicPlayerProfile(user),
                top1: top1,
                battle2v2: battleRows('2v2'),
                battle1v1: battleRows('1v1')
            };
        });
    });
}

function spendPoints(user, cost) {
    var points = Number(user.points || 0);
    if (points < cost) {
        return false;
    }

    user.points = points - cost;
    return true;
}

function handleAccountColor(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var color = String(body.color || '').trim().toUpperCase();
        if (!isAllowedCellColor(color)) {
            sendJson(res, 400, { ok: false, error: 'Warna cell tidak valid.' });
            return;
        }

        requireUser(req, res)
            .then(function(user) {
                if (!user) {
                    return null;
                }

                user.cellColor = color;
                return saveAccountColor(user.id, color).then(function() {
                    sendJson(res, 200, { ok: true, user: publicUser(user) });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function handleChangePassword(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var currentPassword = String(body.currentPassword || body.oldPassword || '');
        var newPassword = String(body.newPassword || body.password || '');

        if (!currentPassword) {
            sendJson(res, 400, { ok: false, error: 'Current password wajib diisi.' });
            return;
        }

        if (newPassword.length < 4) {
            sendJson(res, 400, { ok: false, error: 'New password minimal 4 karakter.' });
            return;
        }

        requireUser(req, res)
            .then(function(user) {
                if (!user) {
                    return;
                }

                if (hashPassword(currentPassword, user.salt) != user.passwordHash) {
                    sendJson(res, 401, { ok: false, error: 'Current password salah.' });
                    return;
                }

                var salt = crypto.randomBytes(16).toString('hex');
                var passwordHash = hashPassword(newPassword, salt);
                return savePasswordCredentials(user.id, salt, passwordHash).then(function() {
                    user.salt = salt;
                    user.passwordHash = passwordHash;
                    sendJson(res, 200, { ok: true, message: 'Password berhasil diubah.', user: publicUser(user) });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function handleBuyPremium(req, res) {
    requireUser(req, res)
        .then(function(user) {
            if (!user) {
                return;
            }

            if (!spendPoints(user, BUY_PREMIUM_COST)) {
                sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Buy Premium membutuhkan 2 point.' });
                return;
            }

            var now = new Date();
            var currentExpiry = parseDateValue(user.premiumExpiresAt);
            var baseTime = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry.getTime() : now.getTime();
            var newExpiry = new Date(baseTime + PREMIUM_DURATION_MS);

            user.accountType = 'Premium';
            user.premiumActivatedAt = now.toISOString();
            user.premiumExpiresAt = newExpiry.toISOString();
            return saveAccountFields(user).then(function(savedUser) {
                sendJson(res, 200, {
                    ok: true,
                    message: 'Premium Activated Successfully! Your Premium membership is valid for 7 days.',
                    user: publicUser(savedUser)
                });
            });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function handleUploadSkin(req, res) {
    var contentType = req.headers['content-type'] || '';

    if (contentType.indexOf('multipart/form-data') === 0) {
        readRawBody(req, PLAYER_SKIN_UPLOAD_SIZE, function(err, body) {
            if (err) {
                sendJson(res, 400, { ok: false, error: err.message || 'Upload gagal.' });
                return;
            }

            var file = parseMultipartFile(req, body);
            if (!file || !file.buffer || !file.buffer.length) {
                sendJson(res, 400, { ok: false, error: 'File skin wajib dipilih.' });
                return;
            }

            if (!isPngSkin(file)) {
                sendJson(res, 400, { ok: false, error: 'Player skin must be a PNG file.' });
                return;
            }

            requireUser(req, res)
                .then(function(user) {
                    if (!user) {
                        return;
                    }

                    if (Number(user.points || 0) < UPLOAD_SKIN_COST) {
                        sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Upload skin membutuhkan 150 point.' });
                        return;
                    }

                    return uploadPlayerSkin(user, file).then(function(skinUrl) {
                        spendPoints(user, UPLOAD_SKIN_COST);
                        user.skinUrl = skinUrl;
                        return saveAccountFields(user).then(function(savedUser) {
                            sendJson(res, 200, { ok: true, message: 'Skin berhasil diupload.', user: publicUser(savedUser) });
                        });
                    });
                })
                .catch(function(error) {
                    handleUploadError(res, error, 'Upload skin gagal.');
                });
        }, 'Player skin size must not exceed 500 KB.');
        return;
    }

    sendJson(res, 400, { ok: false, error: 'Player skin must be a PNG file.' });
}

function handleGuildList(req, res) {
    listGuilds()
        .then(function(guilds) {
            sendJson(res, 200, { ok: true, guilds: guilds });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function handleGuildDetail(req, res) {
    var query = parseQuery(req);
    var tag = normalizeGuildTag(query.tag || query.guild || '');
    if (!tag) {
        sendJson(res, 400, { ok: false, error: 'Guild tidak valid.' });
        return;
    }

    Promise.all([listGuilds(), listGuildMembers(tag), optionalUser(req)])
        .then(function(result) {
            var guild = null;
            for (var i = 0; i < result[0].length; i++) {
                if (normalizeGuildTag(result[0][i].tag) == tag) {
                    guild = result[0][i];
                    break;
                }
            }
            if (!guild) {
                sendJson(res, 404, { ok: false, error: 'Guild tidak ditemukan.' });
                return;
            }

            var currentUser = result[2];
            var viewer = null;
            if (currentUser && normalizeGuildTag(currentUser.guild) == tag) {
                for (var m = 0; m < result[1].length; m++) {
                    if (result[1][m].id == currentUser.id) {
                        viewer = { id: currentUser.id, role: result[1][m].role };
                        break;
                    }
                }
            }
            var isPublicGuild = String(guild.status || '').toLowerCase() == 'public';
            return (currentUser && !currentUser.guild ? userHasPendingGuildInvite(currentUser.id, tag) : Promise.resolve(false)).then(function(hasInvite) {
                sendJson(res, 200, {
                    ok: true,
                    guild: guild,
                    members: result[1],
                    viewer: viewer,
                    canJoin: !!(currentUser && !currentUser.guild && (isPublicGuild || hasInvite))
                });
            });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function clearGuildMembership(user) {
    user.guild = '';
    user.guildName = '';
    user.guildDescription = '';
    user.guildType = '';
    user.guildRole = '';
    user.guildSkinUrl = '';
}

function canKickMember(actorRole, targetRole) {
    actorRole = normalizeGuildRole(actorRole);
    targetRole = normalizeGuildRole(targetRole);
    if (actorRole == 'Leader') {
        return targetRole != 'Leader';
    }
    return actorRole == 'Staff' && targetRole == 'Member';
}

function getEffectiveGuildRole(user) {
    if (!user || !user.guild) {
        return Promise.resolve('');
    }
    return listGuildMembers(user.guild).then(function(members) {
        for (var i = 0; i < members.length; i++) {
            if (members[i].id == user.id) {
                return members[i].role;
            }
        }
        return normalizeGuildRole(user.guildRole || 'Member');
    });
}

function handleGuildKick(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var targetId = String(body.userId || '').trim();
        requireUser(req, res).then(function(actor) {
            if (!actor || !actor.guild) {
                return null;
            }

            return Promise.all([findUserById(targetId), getEffectiveGuildRole(actor)]).then(function(result) {
                var target = result[0];
                var actorRole = result[1];
                if (!target || target.id == actor.id || normalizeGuildTag(target.guild) != normalizeGuildTag(actor.guild)) {
                    sendJson(res, 404, { ok: false, error: 'Member tidak ditemukan.' });
                    return null;
                }

                if (!canKickMember(actorRole, target.guildRole)) {
                    sendJson(res, 403, { ok: false, error: 'Tidak punya izin kick member ini.' });
                    return null;
                }

                clearGuildMembership(target);
                return saveAccountFields(target).then(function() {
                    return listGuildMembers(actor.guild).then(function(members) {
                        sendJson(res, 200, { ok: true, members: members });
                    });
                });
            });
        }).catch(function(error) {
            handleError(res, error);
        });
    });
}

function handleGuildRoleUpdate(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var targetId = String(body.userId || '').trim();
        var role = normalizeGuildRole(body.role);
        requireUser(req, res).then(function(actor) {
            return Promise.all([findUserById(targetId), getEffectiveGuildRole(actor)]).then(function(result) {
                var target = result[0];
                var actorRole = result[1];
                if (!actor || actorRole != 'Leader') {
                    sendJson(res, 403, { ok: false, error: 'Hanya Leader yang dapat mengubah role.' });
                    return null;
                }
                if (!target || target.id == actor.id || normalizeGuildTag(target.guild) != normalizeGuildTag(actor.guild) || normalizeGuildRole(target.guildRole) == 'Leader') {
                    sendJson(res, 404, { ok: false, error: 'Member tidak ditemukan.' });
                    return null;
                }

                target.guildRole = role == 'Staff' ? 'Staff' : 'Member';
                return saveAccountFields(target).then(function() {
                    return listGuildMembers(actor.guild).then(function(members) {
                        sendJson(res, 200, { ok: true, members: members });
                    });
                });
            });
        }).catch(function(error) {
            handleError(res, error);
        });
    });
}

function handleGuildLeave(req, res) {
    requireUser(req, res).then(function(user) {
        if (!user) {
            return null;
        }
        if (!user.guild) {
            sendJson(res, 400, { ok: false, error: 'Account belum memiliki guild.' });
            return null;
        }
        return getEffectiveGuildRole(user).then(function(role) {
            if (role == 'Leader') {
                sendJson(res, 400, { ok: false, error: 'Leader tidak bisa leave. Gunakan Delete Guild.' });
                return null;
            }
            clearGuildMembership(user);
            return saveAccountFields(user).then(function(savedUser) {
                sendJson(res, 200, { ok: true, user: publicUser(savedUser) });
            });
        });
    }).catch(function(error) {
        handleError(res, error);
    });
}

function handleGuildEdit(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var description = String(body.description || '').trim();
        if (description.length > 240) {
            description = description.slice(0, 240);
        }

        requireUser(req, res).then(function(actor) {
            if (!actor) {
                return null;
            }
            if (!actor.guild) {
                sendJson(res, 400, { ok: false, error: 'Account belum memiliki guild.' });
                return null;
            }

            return getEffectiveGuildRole(actor).then(function(role) {
                if (role != 'Leader') {
                    sendJson(res, 403, { ok: false, error: 'Hanya Leader yang dapat edit guild.' });
                    return null;
                }

                var tag = normalizeGuildTag(actor.guild);
                return ensureMysql().then(function(usingMysql) {
                    if (usingMysql) {
                        return getMysqlPool()
                            .query('UPDATE users SET guild_description = ? WHERE guild = ?', [description || null, tag]);
                    }

                    var db = readJsonDb();
                    (db.users || []).forEach(function(user) {
                        if (normalizeGuildTag(user.guild) == tag) {
                            user.guildDescription = description;
                        }
                    });
                    writeJsonDb(db);
                }).then(function() {
                    actor.guildDescription = description;
                    sendJson(res, 200, { ok: true, description: description, user: publicUser(actor) });
                });
            });
        }).catch(function(error) {
            handleError(res, error);
        });
    });
}

function handleGuildDelete(req, res) {
    requireUser(req, res).then(function(actor) {
        if (!actor) {
            return null;
        }
        if (!actor.guild) {
            sendJson(res, 400, { ok: false, error: 'Account belum memiliki guild.' });
            return null;
        }

        return getEffectiveGuildRole(actor).then(function(role) {
            if (role != 'Leader') {
                sendJson(res, 403, { ok: false, error: 'Hanya Leader yang dapat delete guild.' });
                return null;
            }

            var tag = normalizeGuildTag(actor.guild);
            return ensureMysql().then(function(usingMysql) {
                if (usingMysql) {
                    return getMysqlPool()
                        .query('UPDATE users SET guild = NULL, guild_name = NULL, guild_description = NULL, guild_type = NULL, guild_role = NULL, guild_skin_url = NULL WHERE guild = ?', [tag])
                        .then(function() {
                            return getMysqlPool()
                                .query('UPDATE guild_invites SET status = ? WHERE guild = ? AND status = ?', ['cancelled', tag, 'pending']);
                        });
                }

                var db = readJsonDb();
                (db.users || []).forEach(function(user) {
                    if (normalizeGuildTag(user.guild) == tag) {
                        clearGuildMembership(user);
                    }
                });
                (db.guildInvites || []).forEach(function(invite) {
                    if (normalizeGuildTag(invite.guild) == tag && String(invite.status || 'pending') == 'pending') {
                        invite.status = 'cancelled';
                    }
                });
                writeJsonDb(db);
            }).then(function() {
                clearGuildMembership(actor);
                sendJson(res, 200, { ok: true, user: publicUser(actor) });
            });
        });
    }).catch(function(error) {
        handleError(res, error);
    });
}

function handleGuildInvite(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var playerName = String(body.playerName || body.username || '').trim();
        requireUser(req, res).then(function(actor) {
            if (!actor || !actor.guild) {
                return null;
            }

            return getEffectiveGuildRole(actor).then(function(role) {
                if (role != 'Leader' && role != 'Staff') {
                    sendJson(res, 403, { ok: false, error: 'Tidak punya izin invite.' });
                    return null;
                }

                return findUserByLogin(playerName).then(function(target) {
                    if (!target) {
                        sendJson(res, 404, { ok: false, error: 'Player not found.' });
                        return null;
                    }

                    if (target.guild) {
                        sendJson(res, 400, { ok: false, error: 'Player sudah memiliki guild.' });
                        return null;
                    }

                    return listGuilds().then(function(guilds) {
                        var guild = null;
                        for (var i = 0; i < guilds.length; i++) {
                            if (normalizeGuildTag(guilds[i].tag) == normalizeGuildTag(actor.guild)) {
                                guild = guilds[i];
                                break;
                            }
                        }
                        guild = guild || { tag: actor.guild, name: actor.guildName || actor.guild };
                        return createGuildInvite(actor, target, guild).then(function() {
                            sendJson(res, 200, { ok: true, message: 'Invite berhasil dikirim.' });
                        });
                    });
                });
            });
        }).catch(function(error) {
            handleError(res, error);
        });
    });
}

function handleNotificationList(req, res) {
    requireUser(req, res).then(function(user) {
        if (!user) {
            return null;
        }

        return listGuildInviteNotifications(user.id).then(function(notifications) {
            sendJson(res, 200, { ok: true, notifications: notifications });
        });
    }).catch(function(error) {
        handleError(res, error);
    });
}

function handleGuildJoin(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var tag = normalizeGuildTag(body.guild || body.tag || '');
        requireUser(req, res).then(function(user) {
            if (!user) {
                return null;
            }

            if (user.guild) {
                sendJson(res, 400, { ok: false, error: 'Account sudah memiliki guild.' });
                return null;
            }

            return listGuilds().then(function(guilds) {
                    var guild = null;
                    for (var i = 0; i < guilds.length; i++) {
                        if (normalizeGuildTag(guilds[i].tag) == tag) {
                            guild = guilds[i];
                            break;
                        }
                    }
                    if (!guild) {
                        sendJson(res, 404, { ok: false, error: 'Guild tidak ditemukan.' });
                        return null;
                    }

                    var guildType = String(guild.status || '').toLowerCase() == 'public' ? 'public' : 'private';
                    return userHasPendingGuildInvite(user.id, tag).then(function(hasInvite) {
                        if (guildType != 'public' && !hasInvite) {
                            sendJson(res, 403, { ok: false, error: 'Guild private hanya bisa join lewat invite.' });
                            return null;
                        }

                        user.guild = tag;
                        user.guildName = guild.name || tag;
                        user.guildDescription = guild.description || '';
                        user.guildType = guildType;
                        user.guildRole = 'Member';
                        user.guildSkinUrl = guild.logo || '';
                        return saveAccountFields(user).then(function(savedUser) {
                            if (!hasInvite) {
                                sendJson(res, 200, { ok: true, user: publicUser(savedUser) });
                                return null;
                            }
                            return acceptGuildInvite(user.id, tag).then(function() {
                                sendJson(res, 200, { ok: true, user: publicUser(savedUser) });
                            });
                        });
                    });
            });
        }).catch(function(error) {
            handleError(res, error);
        });
    });
}

function handleHighscoreList(req, res) {
    var query = {};
    var parts = String(req.url || '').split('?');
    if (parts[1]) {
        parts[1].split('&').forEach(function(part) {
            var pair = part.split('=');
            query[decodeURIComponent(pair[0] || '')] = decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
        });
    }

    var mode = normalizeHighscoreMode(query.mode);
    var region = normalizeHighscoreRegion(query.region);
    listHighscores(mode, region)
        .then(function(highscores) {
            sendJson(res, 200, { ok: true, mode: mode, region: region, highscores: highscores });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function parseQuery(req) {
    var query = {};
    var parts = String(req.url || '').split('?');
    if (parts[1]) {
        parts[1].split('&').forEach(function(part) {
            var pair = part.split('=');
            query[decodeURIComponent(pair[0] || '')] = decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
        });
    }
    return query;
}

function handlePlayerProfile(req, res) {
    var query = parseQuery(req);
    var name = String(query.name || '').trim();

    if (!name) {
        sendJson(res, 400, { ok: false, error: 'Player name wajib diisi.' });
        return;
    }

    getPlayerProfile(name)
        .then(function(profile) {
            if (!profile) {
                sendJson(res, 404, { ok: false, error: 'Player not found.' });
                return;
            }

            sendJson(res, 200, { ok: true, profile: profile });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function handleCreateGuild(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var guild = normalizeGuildTag(body.tag || body.guild || '');
        var guildName = normalizeGuildName(body.name, guild);
        var description = String(body.description || '').trim().slice(0, 240);
        var guildType = normalizeGuildType(body.type);
        if (!/^[A-Za-z0-9]{1,4}$/.test(guild)) {
            sendJson(res, 400, { ok: false, error: 'Prefix guild wajib A-Z atau 0-9, maksimal 4 karakter, tanpa spasi atau emoji.' });
            return;
        }

        if (!guildName || guildName.length > 32) {
            sendJson(res, 400, { ok: false, error: 'Nama guild wajib diisi, maksimal 32 karakter.' });
            return;
        }

        requireUser(req, res)
            .then(function(user) {
                if (!user) {
                    return;
                }

                if (user.guild) {
                    sendJson(res, 400, { ok: false, error: 'Account sudah memiliki guild.' });
                    return;
                }

                return listGuilds().then(function(guilds) {
                    for (var i = 0; i < guilds.length; i++) {
                        if (normalizeGuildTag(guilds[i].tag) == guild) {
                            sendJson(res, 409, { ok: false, error: 'Tag guild sudah dipakai.' });
                            return null;
                        }
                    }

                    if (!spendPoints(user, CREATE_GUILD_COST)) {
                        sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Membuat guild membutuhkan 50 point.' });
                        return null;
                    }

                    user.guild = guild;
                    user.guildName = guildName;
                    user.guildDescription = description;
                    user.guildType = guildType;
                    user.guildRole = 'Leader';
                    return saveAccountFields(user).then(function(savedUser) {
                        sendJson(res, 200, { ok: true, message: 'Guild berhasil dibuat.', user: publicUser(savedUser) });
                    });
                });
            })
            .catch(function(error) {
                handleUploadError(res, error, 'Upload skin guild gagal.');
            });
    });
}

function handleUploadGuildSkin(req, res) {
    var contentType = req.headers['content-type'] || '';

    if (contentType.indexOf('multipart/form-data') !== 0) {
        sendJson(res, 400, { ok: false, error: 'Upload skin guild harus berupa gambar.' });
        return;
    }

    readRawBody(req, GUILD_SKIN_UPLOAD_SIZE, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: err.message || 'Upload skin guild gagal.' });
            return;
        }

        var file = parseMultipartFile(req, body);
        if (!file || !file.buffer || !file.buffer.length) {
            sendJson(res, 400, { ok: false, error: 'File skin guild wajib dipilih.' });
            return;
        }

        if (!isPngSkin(file)) {
            sendJson(res, 400, { ok: false, error: 'Guild skin must be a PNG file.' });
            return;
        }

        requireUser(req, res)
            .then(function(user) {
                if (!user) {
                    return;
                }

                if (!user.guild) {
                    sendJson(res, 400, { ok: false, error: 'Buat guild dulu sebelum upload skin guild.' });
                    return;
                }

                return uploadGuildSkin(user, file).then(function(skinUrl) {
                    user.guildSkinUrl = skinUrl;
                    return saveAccountFields(user).then(function(savedUser) {
                        sendJson(res, 200, { ok: true, message: 'Skin guild berhasil diupload.', user: publicUser(savedUser) });
                    });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    }, 'Guild skin size must not exceed 200 KB.');
}

function handleAuth(req, res) {
    if (req.method == 'OPTIONS' && req.url.indexOf('/api/') == 0) {
        sendJson(res, 204, {});
        return true;
    }

    if (req.method == 'GET' && req.url.indexOf('/api/verify-email') == 0) {
        handleVerifyEmail(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/register') {
        handleRegister(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/login') {
        handleLogin(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/forgot-password') {
        handleForgotPassword(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url == '/api/me') {
        handleMe(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url == '/api/notifications') {
        handleNotificationList(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/account/color') {
        handleAccountColor(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/account/change-password') {
        handleChangePassword(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/account/buy-premium') {
        handleBuyPremium(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/account/upload-skin') {
        handleUploadSkin(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url == '/api/guilds') {
        handleGuildList(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url.indexOf('/api/guild/detail') === 0) {
        handleGuildDetail(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url.indexOf('/api/highscores') === 0) {
        handleHighscoreList(req, res);
        return true;
    }

    if (req.method == 'GET' && req.url.indexOf('/api/player-profile') === 0) {
        handlePlayerProfile(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/create') {
        handleCreateGuild(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/member/kick') {
        handleGuildKick(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/member/role') {
        handleGuildRoleUpdate(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/edit') {
        handleGuildEdit(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/delete') {
        handleGuildDelete(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/leave') {
        handleGuildLeave(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/invite') {
        handleGuildInvite(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/join') {
        handleGuildJoin(req, res);
        return true;
    }

    if (req.method == 'POST' && req.url == '/api/guild/upload-skin') {
        handleUploadGuildSkin(req, res);
        return true;
    }

    return false;
}

handleAuth.getUserByToken = findUserByToken;
handleAuth.getUserById = findUserById;
handleAuth.getUserByUsername = findUserByUsername;
handleAuth.awardXp = awardXp;
handleAuth.adjustPoints = adjustPoints;
handleAuth.grantPointsByUsername = grantPointsByUsername;
handleAuth.getNextLevelXp = getNextLevelXp;
handleAuth.isAllowedCellColor = isAllowedCellColor;
handleAuth.normalizeCellColor = normalizeCellColor;

startPremiumExpiryRuntime();

module.exports = handleAuth;
