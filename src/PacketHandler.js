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
            for (var i = 1; i < view.byteLength; i += 2) {
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
            for (var i = 1; i < view.byteLength; i += 2) {
                var charCode = view.getUint16(i, true);
                if (charCode == 0) {
                    break;
                }

                color += String.fromCharCode(charCode);
            }

            this.setCellColor(color);
            break;
        case 0:
            // Set Nickname
            var nick = "";
            for (var i = 1; i < view.byteLength; i += 2) {
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
            for (var i = 1; i < view.byteLength; i += 2) {
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
    var message = "";
    var maxLen = 200 * 2;
    var offset = 2;
    var flags = view.getUint8(1);
    if (flags & 2) offset += 4;
    if (flags & 4) offset += 8;
    if (flags & 8) offset += 16;

    for (var i = offset; i < view.byteLength && i <= maxLen; i += 2) {
        var charCode = view.getUint16(i, true);
        if (charCode === 0) break;
        message += String.fromCharCode(charCode);
    }

    var player = this.socket.playerTracker;

    // daftar nick yang bisa pakai /mass
const allowedMassUsers = ["Amruflxryns", "AMOT ALPERDO S", "Epad", "DEMON LORD", "rrq epos galang", "DISHA", "M NABIL FEBRI", "Vaxelin Ups"];

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
    if (message.startsWith("/color") && player.getName() === "Amruflxryns") {
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

    // Kirim chat normal untuk pemain lain
    var packet = new Packet.Chat(player, message);
    for (var i = 0; i < this.gameServer.clients.length; i++) {
        this.gameServer.clients[i].sendPacket(packet);
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

PacketHandler.prototype.applyCellColor = function(color) {
    var client = this.socket.playerTracker;
    var rgb = hexToRgb(color);

    if (!client || !rgb) {
        return;
    }

    client.cellColor = color;
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

    if (!token || !client) {
        return;
    }

    client.authPending = Auth.getUserByToken(token)
        .then(function(user) {
            if (!user) {
                return;
            }

            client.authUserId = user.id;
            client.authUsername = user.username;
            client.skinUrl = user.skinUrl || user.guildSkinUrl || null;
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

PacketHandler.prototype.setNickname = function(newNick) {
    var client = this.socket.playerTracker;
    client.setName(newNick);

    if (client.cells.length < 1) {
        var spawn = function() {
            if (client.cells.length < 1) {
                this.gameServer.spawnPlayer(client);
                client.spectate = false;
            }
        }.bind(this);

        if (client.authPending) {
            client.authPending.then(spawn);
            return;
        }

        spawn();
    }
}
