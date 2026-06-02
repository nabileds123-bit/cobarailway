var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var dbPath = path.join(__dirname, '..', 'data', 'users.json');
var memorySessions = {};
var mysqlPool = null;
var mysqlReady = null;
var BUY_PREMIUM_COST = 2;
var UPLOAD_SKIN_COST = 150;
var CREATE_GUILD_COST = 50;
var MAX_SKIN_UPLOAD_SIZE = 1024 * 1024 * 2;
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
                'account_type VARCHAR(16) NOT NULL DEFAULT \'Free\',' +
                'level INT NOT NULL DEFAULT 1,' +
                'xp INT NOT NULL DEFAULT 0,' +
                'points DECIMAL(12,2) NOT NULL DEFAULT 0,' +
                'guild VARCHAR(32) NULL,' +
                'skin_url VARCHAR(255) NULL,' +
                'guild_skin_url VARCHAR(255) NULL,' +
                'cell_color VARCHAR(7) NOT NULL DEFAULT \'#6FCA36\',' +
                'email_verified TINYINT(1) NOT NULL DEFAULT 0,' +
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
                'ALTER TABLE users ADD COLUMN account_type VARCHAR(16) NOT NULL DEFAULT \'Free\'',
                'ALTER TABLE users ADD COLUMN level INT NOT NULL DEFAULT 1',
                'ALTER TABLE users ADD COLUMN xp INT NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN points DECIMAL(12,2) NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN guild VARCHAR(32) NULL',
                'ALTER TABLE users ADD COLUMN skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN guild_skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN cell_color VARCHAR(7) NOT NULL DEFAULT \'#6FCA36\'',
                'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
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

function publicUser(user) {
    var level = Number(user.level || 1);
    var xp = Number(user.xp || 0);

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        accountType: user.accountType || 'Free',
        level: level,
        xp: xp,
        nextLevelXp: getNextLevelXp(level),
        points: Number(user.points || 0),
        guild: user.guild || '',
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
        level: row.level,
        xp: row.xp,
        points: row.points,
        guild: row.guild,
        skinUrl: row.skin_url,
        guildSkinUrl: row.guild_skin_url,
        cellColor: row.cell_color,
        lastLogin: row.last_login,
        createdAt: row.created_at,
        emailVerified: row.email_verified,
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

function readRawBody(req, maxSize, callback) {
    var chunks = [];
    var size = 0;

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > maxSize) {
            req.connection.destroy();
            callback(new Error('File terlalu besar. Maksimal 2MB.'));
            return;
        }

        chunks.push(chunk);
    });

    req.on('end', function() {
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

    if (contentType == 'image/jpeg' || contentType == 'image/jpg') {
        return 'jpg';
    }

    if (contentType == 'image/webp') {
        return 'webp';
    }

    return null;
}

function uploadPlayerSkin(user, file) {
    var supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    var bucket = process.env.SUPABASE_BUCKET || 'skins';
    var extension = getSkinExtension(file.contentType);

    if (!supabaseUrl || !serviceKey) {
        return Promise.reject(new Error('Supabase storage belum dikonfigurasi.'));
    }

    if (!extension) {
        return Promise.reject(new Error('Format skin harus PNG, JPG, atau WEBP.'));
    }

    var objectPath = 'players/' + user.id + '-' + Date.now() + '.' + extension;
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

        return user;
    });
}

function handleError(res, err) {
    console.error('[Auth] Error:', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'Server auth error.' });
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
                    'INSERT INTO users (id, username, email, salt, password_hash) VALUES (?, ?, ?, ?, ?)',
                    [user.id, user.username, user.email, user.salt, user.passwordHash]
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
                return createUser({
                    id: crypto.randomBytes(12).toString('hex'),
                    username: username,
                    email: email,
                    salt: salt,
                    passwordHash: hashPassword(password, salt),
                    accountType: 'Free',
                    level: 1,
                    xp: 0,
                    points: 0,
                    guild: '',
                    skinUrl: '',
                    guildSkinUrl: '',
                    cellColor: '#6FCA36',
                    lastLogin: null,
                    createdAt: new Date().toISOString()
                });
            })
            .then(function(user) {
                if (user) {
                    sendJson(res, 201, { ok: true, user: publicUser(user) });
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
                    'UPDATE users SET account_type = ?, points = ?, guild = ?, skin_url = ? WHERE id = ?',
                    [user.accountType || 'Free', Number(user.points || 0), user.guild || null, user.skinUrl || null, user.id]
                )
                .then(function() {
                    return user;
                });
        }

        var db = readJsonDb();
        for (var i = 0; i < db.users.length; i++) {
            if (db.users[i].id == user.id) {
                db.users[i].accountType = user.accountType || 'Free';
                db.users[i].points = Number(user.points || 0);
                db.users[i].guild = user.guild || '';
                db.users[i].skinUrl = user.skinUrl || '';
                writeJsonDb(db);
                return user;
            }
        }

        return user;
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

function handleBuyPremium(req, res) {
    requireUser(req, res)
        .then(function(user) {
            if (!user) {
                return;
            }

            if (String(user.accountType || '').toLowerCase() == 'premium') {
                sendJson(res, 200, { ok: true, message: 'Account sudah Premium.', user: publicUser(user) });
                return;
            }

            if (!spendPoints(user, BUY_PREMIUM_COST)) {
                sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Buy Premium membutuhkan 2 point.' });
                return;
            }

            user.accountType = 'Premium';
            return saveAccountFields(user).then(function(savedUser) {
                sendJson(res, 200, { ok: true, message: 'Account berhasil menjadi Premium.', user: publicUser(savedUser) });
            });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

function handleUploadSkin(req, res) {
    var contentType = req.headers['content-type'] || '';

    if (contentType.indexOf('multipart/form-data') === 0) {
        readRawBody(req, MAX_SKIN_UPLOAD_SIZE, function(err, body) {
            if (err) {
                sendJson(res, 400, { ok: false, error: err.message || 'Upload gagal.' });
                return;
            }

            var file = parseMultipartFile(req, body);
            if (!file || !file.buffer || !file.buffer.length) {
                sendJson(res, 400, { ok: false, error: 'File skin wajib dipilih.' });
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
                    handleError(res, error);
                });
        });
        return;
    }

    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var skinUrl = String(body.skinUrl || '').trim();

        requireUser(req, res)
            .then(function(user) {
                if (!user) {
                    return;
                }

                if (!skinUrl) {
                    sendJson(res, 400, { ok: false, error: 'Upload skin membutuhkan storage file. Minimal point yang dibutuhkan: 150.' });
                    return;
                }

                if (!spendPoints(user, UPLOAD_SKIN_COST)) {
                    sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Upload skin membutuhkan 150 point.' });
                    return;
                }

                user.skinUrl = skinUrl;
                return saveAccountFields(user).then(function(savedUser) {
                    sendJson(res, 200, { ok: true, message: 'Skin berhasil disimpan.', user: publicUser(savedUser) });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function handleCreateGuild(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var guild = String(body.guild || '').trim();
        if (!/^[A-Za-z0-9]{2,12}$/.test(guild)) {
            sendJson(res, 400, { ok: false, error: 'Nama guild hanya boleh A-Z 0-9, 2-12 karakter.' });
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

                if (!spendPoints(user, CREATE_GUILD_COST)) {
                    sendJson(res, 400, { ok: false, error: 'Point tidak cukup. Membuat guild membutuhkan 50 point.' });
                    return;
                }

                user.guild = guild;
                return saveAccountFields(user).then(function(savedUser) {
                    sendJson(res, 200, { ok: true, message: 'Guild berhasil dibuat.', user: publicUser(savedUser) });
                });
            })
            .catch(function(error) {
                handleError(res, error);
            });
    });
}

function handleAuth(req, res) {
    if (req.method == 'OPTIONS' && req.url.indexOf('/api/') == 0) {
        sendJson(res, 204, {});
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

    if (req.method == 'POST' && req.url == '/api/account/color') {
        handleAccountColor(req, res);
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

    if (req.method == 'POST' && req.url == '/api/guild/create') {
        handleCreateGuild(req, res);
        return true;
    }

    return false;
}

handleAuth.getUserByToken = findUserByToken;
handleAuth.awardXp = awardXp;
handleAuth.getNextLevelXp = getNextLevelXp;
handleAuth.isAllowedCellColor = isAllowedCellColor;
handleAuth.normalizeCellColor = normalizeCellColor;

module.exports = handleAuth;
