var Packet = require('./packet');
var Auth = require('./api/AuthServer');

function PacketHandler(gameServer, socket) {
    this.gameServer = gameServer;
    this.socket = socket;
    this.merg = false;
    this.pressW = false;
    this.pressSpace = false;
	this.massSize = false;
}

module.exports = PacketHandler;

PacketHandler.prototype.handleMessage = function(message) {
    function stobuf(buf) {
        var length = buf.length;
        var arrayBuf = new ArrayBuffer(length);
        var view = new Uint8Array(arrayBuf);

        for (var i = 0; i < length; i++) {
            view[i] = buf[i];
        }

        return view.buffer;
    }

    var buffer = stobuf(message);
    var view = new DataView(buffer);
    var packetId = view.getUint8(0, true);

    switch (packetId) {
        case 101:
            var token = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                token += String.fromCharCode(charCode);
            }

            this.setAuthToken(token);
            break;
        case 102:
            var color = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                color += String.fromCharCode(charCode);
            }

            this.setCellColor(color);
            break;
        case 103:
            var battleMode = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                battleMode += String.fromCharCode(charCode);
            }

            this.setBattleMode(battleMode);
            break;
        case 104:
            var mode = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                mode += String.fromCharCode(charCode);
            }

            this.joinMode(mode);
            break;
        case 105:
            var queueMode = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                queueMode += String.fromCharCode(charCode);
            }

            this.joinBattleQueue(queueMode);
            break;
        case 0:
            // Set Nickname
            var nick = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                nick += String.fromCharCode(charCode);
            }
            this.setNickname(nick);
            break;
        case 1:
            // Spectate mode
            if (this.socket.playerTracker.cells.length <= 0) {
                // Make sure client has no cells
                this.socket.playerTracker.spectate = true;
            }
            break;
        case 16:
            // Mouse Move
            if (view.byteLength < 17) {
                break;
            }
            var client = this.socket.playerTracker;
            client.mouse.x = view.getFloat64(1, true);
            client.mouse.y = view.getFloat64(9, true);
            break;

		case 17: 
            // Space Press - Split cell
            this.pressSpace = true;
            break;
		    	 case 87:
this.massSize = true;
		    break;
		     case 52:
this.merg = true;
		    break;
        case 21: 
            // W Press - Eject mass
            this.pressW = true;
            break;
        case 42:
            var message = "";
            for (var i = 1; i + 1 < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                message += String.fromCharCode(charCode);
            }
            
            this.gameServer.sendMessage(message);
        case 255:
            // Connection Start - Send SetBorder packet first
            var c = this.gameServer.config;
            this.socket.sendPacket(new Packet.SetBorder(c.borderLeft, c.borderRight, c.borderTop, c.borderBottom));
            break;
   case 99:
    if (view.byteLength < 2) {
        break;
    }
    var message = "";
    var maxLen = 200 * 2;
    var offset = 2;
    var flags = view.getUint8(1);
    if (flags & 2) offset += 4;
    if (flags & 4) offset += 8;
    if (flags & 8) offset += 16;

    for (var i = offset; i + 1 < view.byteLength && i <= maxLen; i += 2) {
        var charCode = view.getUint16(i, true);
        if (charCode === 0) break;
        message += String.fromCharCode(charCode);
    }

    var player = this.socket.playerTracker;
    if (/^\/point(?:\s|$)/i.test(message)) {
        this.handlePointCommand(message);
        break;
    }

    if (String(player.accountType || '').toLowerCase() != 'premium') {
        break;
    }

    if (/^\/g(?:\s|$)/i.test(message)) {
        var guildTag = player.getGuildTag ? player.getGuildTag() : String(player.guildTag || '').trim().toUpperCase();
        var guildMessage = message.replace(/^\/g(?:\s+)?/i, '').trim();

        if (!guildTag) {
            this.socket.sendPacket(new Packet.Message("Kamu belum punya guild."));
            break;
        }

        if (!guildMessage) {
            this.socket.sendPacket(new Packet.Message("Gunakan: /g pesan"));
            break;
        }

        var guildPacket = new Packet.Chat(player, guildMessage, null, 1);
        for (var g = 0; g < this.gameServer.clients.length; g++) {
            var guildReceiver = this.gameServer.clients[g];
            var receiverPlayer = guildReceiver && guildReceiver.playerTracker;
            var receiverGuildTag = receiverPlayer && receiverPlayer.getGuildTag ? receiverPlayer.getGuildTag() : '';
            if (!guildReceiver || !receiverPlayer || receiverPlayer.gameServer != player.gameServer || receiverGuildTag != guildTag) {
                continue;
            }
            guildReceiver.sendPacket(guildPacket);
        }
        break;
    }

    // daftar nick yang bisa pakai /mass
const allowedMassUsers = ["Slowly"];

if (message.startsWith("/mass") && allowedMassUsers.includes(player.getName())) {
    var parts = message.split(" ");
    var mass = parseInt(parts[1]);
    if (!isNaN(mass) && mass >= 0 && mass <= 25000) {
        player.cells.forEach(cell => { cell.mass = mass; });
        this.gameServer.sendMessage("Mass " + player.getName() + " diubah ke: " + mass);
    } else {
        this.gameServer.sendMessage("Gunakan: /mass (angka 0-15000)");
    }
    break; // jangan kirim ke broadcast
}


    // ==== /color untuk Amruflxryns ====
if (message.startsWith("/color") && player.getName() === "Slowly") {
        if (player.gameServer && player.gameServer.gameMode && player.gameServer.gameMode.haveTeams) {
            this.gameServer.sendMessage("Color command disabled in Teams mode.");
            break;
        }
        var parts = message.split(" ");
        if (parts.length === 4) {
            var r = parseInt(parts[1]);
            var g = parseInt(parts[2]);
            var b = parseInt(parts[3]);
            if ([r,g,b].every(v => !isNaN(v) && v >= 0 && v <= 255)) {
                player.cells.forEach(cell => {
                    cell.color.r = r;
                    cell.color.g = g;
                    cell.color.b = b;
                });
                this.gameServer.sendMessage("Warna kamu diubah ke: rgb(" + r + "," + g + "," + b + ")");
            } else {
                this.gameServer.sendMessage("Gunakan: /color R G B (0-255)");
            }
        } else {
            this.gameServer.sendMessage("Gunakan: /color R G B");
        }
        break; // jangan broadcast
    }

    // ==== /rainbow untuk Amruflxryns ====
    if (message === "/rainbow" && player.getName() === "Amruflxryns") {
        if (player.gameServer && player.gameServer.gameMode && player.gameServer.gameMode.haveTeams) {
            this.gameServer.sendMessage("Rainbow command disabled in Teams mode.");
            break;
        }
        if (!player.rainbowInterval) {
            var hue = 0;
            player.rainbowInterval = setInterval(() => {
                var rgb = hslToRgb(hue/360, 1, 0.5);
                player.cells.forEach(cell => {
                    cell.color.r = rgb[0];
                    cell.color.g = rgb[1];
                    cell.color.b = rgb[2];
                });
                hue = (hue + 1) % 360;
            }, 50); // update tiap 50ms
            this.gameServer.sendMessage("Rainbow diaktifkan!");
        } else {
            clearInterval(player.rainbowInterval);
            player.rainbowInterval = null;
            this.gameServer.sendMessage("Rainbow dimatikan!");
        }
        break; // jangan broadcast
    }

    // Kirim chat normal dari Premium ke semua pemain.
    var packet = new Packet.Chat(player, message);
    for (var i = 0; i < this.gameServer.clients.length; i++) {
        var receiver = this.gameServer.clients[i];
        if (!receiver || !receiver.playerTracker || receiver.playerTracker.gameServer != player.gameServer) {
            continue;
        }
        receiver.sendPacket(packet);
    }
    break;

// === fungsi helper HSL to RGB ===
function hslToRgb(h, s, l) {
    let r, g, b;
    if(s == 0){
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if(t < 0) t += 1;
            if(t > 1) t -= 1;
            if(t < 1/6) return p + (q - p) * 6 * t;
            if(t < 1/2) return q;
            if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}





default:
            break;
    }
}

function hexToRgb(hex) {
    var value = String(hex || '').trim().replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(value)) {
        return null;
    }

    return {
        r: parseInt(value.substr(0, 2), 16),
        g: parseInt(value.substr(2, 2), 16),
        b: parseInt(value.substr(4, 2), 16)
    };
}

function normalizePermissionValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizePermissionValue).join(',');
    }

    return String(value || '').trim().toLowerCase();
}

function hasPointAdminRole(value) {
    var text = normalizePermissionValue(value);
    if (!text) {
        return false;
    }

    var parts = text.split(/[\s,;|]+/);
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] == 'admin' || parts[i] == 'moderator' || parts[i] == 'mod' || parts[i] == 'point-admin' || parts[i] == 'point-moderator') {
            return true;
        }
    }

    return false;
}

function formatPointValue(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) {
        number = 0;
    }

    if (Math.floor(number) == number) {
        return String(number);
    }

    return number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

PacketHandler.prototype.sendPrivateSystemMessage = function(message, socket) {
    socket = socket || this.socket;

    if (!socket || !socket.sendPacket) {
        return;
    }

    socket.sendPacket(new Packet.Message(String(message || '')));
}

PacketHandler.prototype.sendPointBalanceUpdate = function(socket, points) {
    if (!socket || !socket.send || socket.readyState != 1) {
        return;
    }

    var buf = new ArrayBuffer(9);
    var view = new DataView(buf);
    view.setUint8(0, 107);
    view.setFloat64(1, Number(points || 0), true);
    socket.send(buf);
}

PacketHandler.prototype.isPointAdmin = function(player) {
    if (!player || !player.authUserId) {
        return false;
    }

    if (hasPointAdminRole(player.adminRole) || hasPointAdminRole(player.accountType)) {
        return true;
    }

    var allowList = String(process.env.POINT_COMMAND_ADMINS || process.env.ADMIN_USERS || '').toLowerCase();
    if (!allowList) {
        return false;
    }

    var actorNames = [
        player.authUsername,
        player.getName ? player.getName() : '',
        player.authUserId
    ].map(function(value) {
        return String(value || '').trim().toLowerCase();
    }).filter(function(value) {
        return !!value;
    });

    var allowed = allowList.split(/[\s,;|]+/);
    for (var i = 0; i < actorNames.length; i++) {
        if (allowed.indexOf(actorNames[i]) != -1) {
            return true;
        }
    }

    return false;
}

PacketHandler.prototype.parsePointCommand = function(message) {
    var parts = String(message || '').trim().split(/\s+/);
    if (parts.length < 3) {
        return { error: 'usage' };
    }

    var amountText = parts.pop();
    var targetName = parts.slice(1).join(' ').trim();
    if (!targetName) {
        return { error: 'usage' };
    }

    var amount = Number(amountText);
    if (!isFinite(amount) || amount <= 0) {
        return { error: 'amount' };
    }

    return {
        targetName: targetName,
        amount: amount
    };
}

PacketHandler.prototype.getOnlineSocketsByUserId = function(userId) {
    var hub = this.gameServer && this.gameServer.getHub ? this.gameServer.getHub() : this.gameServer;
    var sockets = hub && hub.getAllClients ? hub.getAllClients() : (this.gameServer && this.gameServer.clients ? this.gameServer.clients : []);
    var matches = [];

    for (var i = 0; i < sockets.length; i++) {
        var player = sockets[i] && sockets[i].playerTracker;
        if (player && String(player.authUserId || '') == String(userId || '')) {
            matches.push(sockets[i]);
        }
    }

    return matches;
}

PacketHandler.prototype.handlePointCommand = function(message) {
    var admin = this.socket.playerTracker;
    var adminName = (admin && (admin.authUsername || (admin.getName && admin.getName()))) || 'Unknown';

    if (!this.isPointAdmin(admin)) {
        console.log('[ADMIN POINT] Unauthorized attempt by %s.', adminName);
        this.sendPrivateSystemMessage('[POINT] You do not have permission to use this command.');
        return;
    }

    var parsed = this.parsePointCommand(message);
    if (parsed.error == 'usage') {
        this.sendPrivateSystemMessage('[POINT] Usage: /point <player> <amount>');
        return;
    }

    if (parsed.error == 'amount') {
        this.sendPrivateSystemMessage('[POINT] Invalid amount.');
        return;
    }

    if (!Auth.grantPointsByUsername) {
        this.sendPrivateSystemMessage('[POINT] Failed to update Points.');
        console.log('[ADMIN POINT] Point command unavailable for %s.', adminName);
        return;
    }

    Auth.grantPointsByUsername(parsed.targetName, parsed.amount, 'admin command by ' + adminName)
        .then(function(target) {
            if (!target) {
                this.sendPrivateSystemMessage('[POINT] Player not found.');
                return;
            }

            var amountText = formatPointValue(parsed.amount);
            var pointsText = formatPointValue(target.points);
            this.sendPrivateSystemMessage('[POINT] Added ' + amountText + ' Points to ' + target.username + '. Current Points: ' + pointsText);

            var onlineSockets = this.getOnlineSocketsByUserId(target.id);
            for (var i = 0; i < onlineSockets.length; i++) {
                if (onlineSockets[i].playerTracker) {
                    onlineSockets[i].playerTracker.accountPoints = Number(target.points || 0);
                }
                this.sendPointBalanceUpdate(onlineSockets[i], target.points);
                this.sendPrivateSystemMessage('You received ' + amountText + ' Points from admin.', onlineSockets[i]);
            }

            console.log('[ADMIN POINT] %s added %s Points to %s. Current Points: %s', adminName, amountText, target.username, pointsText);
        }.bind(this))
        .catch(function(error) {
            this.sendPrivateSystemMessage('[POINT] Failed to update Points.');
            console.log('[ADMIN POINT] Failed for %s: %s', adminName, error && error.message ? error.message : error);
        }.bind(this));
}

PacketHandler.prototype.applyCellColor = function(color) {
    var client = this.socket.playerTracker;
    var rgb = hexToRgb(color);

    if (!client || !rgb) {
        return;
    }

    client.cellColor = color;
    if (client.gameServer && client.gameServer.gameMode && client.gameServer.gameMode.haveTeams) {
        if (client.gameServer.gameMode.applyTeamColor) {
            var teamColor = client.gameServer.gameMode.applyTeamColor(client);
            for (var t = 0; t < client.cells.length; t++) {
                if (client.cells[t] && client.cells[t].setColor && teamColor) {
                    client.cells[t].setColor(teamColor);
                }
            }
        }
        return;
    }

    client.setColor(rgb);

    for (var i = 0; i < client.cells.length; i++) {
        if (client.cells[i] && client.cells[i].setColor) {
            client.cells[i].setColor(rgb);
        }
    }
}

PacketHandler.prototype.setAuthToken = function(token) {
    var client = this.socket.playerTracker;
    token = String(token || '').trim();

    if (!client) {
        return;
    }

    if (!token) {
        client.authUserId = null;
        client.authUsername = null;
        client.accountType = 'Guest';
        client.adminRole = '';
        client.accountPoints = 0;
        client.guildTag = '';
        client.skinUrl = null;
        return;
    }

    client.authPending = Auth.getUserByToken(token)
        .then(function(user) {
            if (!user) {
                return;
            }

            client.authUserId = user.id;
            client.authUsername = user.username;
            client.accountType = user.accountType || 'Free';
            client.adminRole = user.adminRole || user.role || user.accountRole || '';
            client.accountPoints = Number(user.points || 0);
            client.guildTag = user.guild || '';
            client.skinUrl = Auth.getActiveSkinUrl(user) || null;
            client.lastPassiveXpTime = Date.now();
            this.applyCellColor(Auth.normalizeCellColor(user.cellColor));
            console.log("[Auth] Bound player %s to account %s", client.getName() || "(no nick)", user.username);
        }.bind(this))
        .catch(function(error) {
            console.log("[Auth] Token bind failed:", error && error.message ? error.message : error);
        })
        .then(function() {
            client.authPending = null;
        });
}

PacketHandler.prototype.setCellColor = function(color) {
    var client = this.socket.playerTracker;
    color = String(color || '').trim().toUpperCase();

    if (!client || !client.authUserId || !Auth.isAllowedCellColor(color)) {
        return;
    }

    this.applyCellColor(color);
}

PacketHandler.prototype.setBattleMode = function(mode) {
    var client = this.socket.playerTracker;
    mode = String(mode || '').trim().toLowerCase();

    if (!client) {
        return;
    }

    client.battleMode = mode == '2v2' ? '2v2' : '1v1';
}

PacketHandler.prototype.joinMode = function(mode) {
    if (!this.gameServer || !this.gameServer.joinClientToMode) {
        return;
    }

    this.gameServer.joinClientToMode(mode, this.socket);
}

PacketHandler.prototype.joinBattleQueue = function(mode) {
    if (!this.gameServer || !this.gameServer.joinBattleQueue) {
        return;
    }

    this.gameServer.joinBattleQueue(this.socket, mode);
}

PacketHandler.prototype.setNickname = function(newNick) {
    var client = this.socket.playerTracker;
    var activeServer = client && client.gameServer ? client.gameServer : this.gameServer;
    client.setName(newNick);

    if (client.battleState == 'finding' || client.battleState == 'preparing') {
        client.spectate = false;
        return;
    }

    var roomName = activeServer.roomName || '';
    if (client.cells.length < 1) {
        var spawn = function() {
            if (client.cells.length < 1) {
                if (activeServer.gameMode && activeServer.gameMode.name == 'Tournament' && roomName.indexOf('Battle') === 0) {
                    if (roomName.indexOf('BattleMatch-') !== 0 || client.battleState != 'in_match') {
                        return;
                    }

                    activeServer.gameMode.onPlayerSpawn(activeServer, client);
                    client.spectate = false;
                    return;
                }

                activeServer.spawnPlayer(client);
                client.spectate = false;
            }
        };

        if (client.authPending) {
            client.authPending.then(spawn);
            return;
        }

        spawn();
    }
}
