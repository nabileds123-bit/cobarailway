var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var dbPath = path.join(__dirname, '..', 'data', 'users.json');
var sessions = {};

function ensureDb() {
    var dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify({ users: [] }, null, 2));
    }
}

function readDb() {
    ensureDb();
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        return { users: [] };
    }
}

function writeDb(db) {
    ensureDb();
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

function findUserByLogin(db, login) {
    var value = String(login || '').trim().toLowerCase();

    for (var i = 0; i < db.users.length; i++) {
        var user = db.users[i];
        if (user.username.toLowerCase() == value || user.email.toLowerCase() == value) {
            return user;
        }
    }

    return null;
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email
    };
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

        if (!/^[a-z0-9]+$/.test(username)) {
            sendJson(res, 400, { ok: false, error: 'Username hanya boleh huruf kecil a-z dan angka 0-9.' });
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

        var db = readDb();
        if (findUserByLogin(db, username)) {
            sendJson(res, 409, { ok: false, error: 'Username sudah dipakai.' });
            return;
        }

        if (findUserByLogin(db, email)) {
            sendJson(res, 409, { ok: false, error: 'Email sudah dipakai.' });
            return;
        }

        var salt = crypto.randomBytes(16).toString('hex');
        var user = {
            id: crypto.randomBytes(12).toString('hex'),
            username: username,
            email: email,
            salt: salt,
            passwordHash: hashPassword(password, salt),
            createdAt: new Date().toISOString()
        };

        db.users.push(user);
        writeDb(db);

        sendJson(res, 201, { ok: true, user: publicUser(user) });
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
        var db = readDb();
        var user = findUserByLogin(db, login);

        if (!user || hashPassword(password, user.salt) != user.passwordHash) {
            sendJson(res, 401, { ok: false, error: 'Username/email atau password salah.' });
            return;
        }

        var token = makeToken();
        sessions[token] = user.id;

        sendJson(res, 200, { ok: true, token: token, user: publicUser(user) });
    });
}

function handleForgotPassword(req, res) {
    readBody(req, function(err, body) {
        if (err) {
            sendJson(res, 400, { ok: false, error: 'JSON tidak valid.' });
            return;
        }

        var email = normalizeEmail(body.email);
        var db = readDb();
        var user = findUserByLogin(db, email);

        if (user) {
            user.resetToken = crypto.randomBytes(16).toString('hex');
            user.resetRequestedAt = new Date().toISOString();
            writeDb(db);
            console.log('[Auth] Reset password token for %s: %s', user.email, user.resetToken);
        }

        sendJson(res, 200, { ok: true, message: 'Jika email terdaftar, instruksi reset sudah dibuat.' });
    });
}

function handleMe(req, res) {
    var header = req.headers.authorization || '';
    var token = header.replace(/^Bearer\s+/i, '');
    var userId = sessions[token];

    if (!userId) {
        sendJson(res, 401, { ok: false, error: 'Belum login.' });
        return;
    }

    var db = readDb();
    for (var i = 0; i < db.users.length; i++) {
        if (db.users[i].id == userId) {
            sendJson(res, 200, { ok: true, user: publicUser(db.users[i]) });
            return;
        }
    }

    sendJson(res, 401, { ok: false, error: 'Session tidak valid.' });
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
