var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var dbPath = path.join(__dirname, '..', 'data', 'users.json');
var memorySessions = {};
var mysqlPool = null;
var mysqlReady = null;

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
                'points DECIMAL(12,2) NOT NULL DEFAULT 0,' +
                'guild VARCHAR(32) NULL,' +
                'skin_url VARCHAR(255) NULL,' +
                'guild_skin_url VARCHAR(255) NULL,' +
                'last_login DATETIME NULL,' +
                'reset_token VARCHAR(64) NULL,' +
                'reset_requested_at DATETIME NULL,' +
                'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' +
                ')'
            );
        })
        .then(function() {
            var alters = [
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(16) NOT NULL DEFAULT \'Free\'',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS points DECIMAL(12,2) NOT NULL DEFAULT 0',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS guild VARCHAR(32) NULL',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS guild_skin_url VARCHAR(255) NULL',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATETIME NULL'
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

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        accountType: user.accountType || 'Free',
        level: Number(user.level || 1),
        points: Number(user.points || 0),
        guild: user.guild || '',
        skinUrl: user.skinUrl || '',
        guildSkinUrl: user.guildSkinUrl || '',
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
        points: row.points,
        guild: row.guild,
        skinUrl: row.skin_url,
        guildSkinUrl: row.guild_skin_url,
        lastLogin: row.last_login,
        createdAt: row.created_at
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
                    points: 0,
                    guild: '',
                    skinUrl: '',
                    guildSkinUrl: '',
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
    var header = req.headers.authorization || '';
    var token = header.replace(/^Bearer\s+/i, '');

    if (!token) {
        sendJson(res, 401, { ok: false, error: 'Belum login.' });
        return;
    }

    findUserByToken(token)
        .then(function(user) {
            if (!user) {
                sendJson(res, 401, { ok: false, error: 'Session tidak valid.' });
                return;
            }

            sendJson(res, 200, { ok: true, user: publicUser(user) });
        })
        .catch(function(error) {
            handleError(res, error);
        });
}

module.exports = function handleAuth(req, res) {
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

    return false;
};
