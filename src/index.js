// ===== Ogar3 Server Starter with Enhanced Commands =====

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach(function(line) {
        var text = line.trim();
        if (!text || text.charAt(0) == '#') {
            return;
        }

        var equalsAt = text.indexOf('=');
        if (equalsAt <= 0) {
            return;
        }

        var key = text.slice(0, equalsAt).trim();
        var value = text.slice(equalsAt + 1).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.prototype.hasOwnProperty.call(process.env, key)) {
            return;
        }

        if ((value.charAt(0) == '"' && value.charAt(value.length - 1) == '"') ||
            (value.charAt(0) == "'" && value.charAt(value.length - 1) == "'")) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    });
}

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '.env'));

let runMaster = false;
let runGame = true;

// Parse arguments
process.argv.forEach(arg => {
    if (arg === "--master") runMaster = true;
    if (arg === "--game") runGame = true;
    if (arg === "--help") {
        console.log("========================= HELP =========================");
        console.log("Usage: node index.js [--master] [--game]");
        console.log("");
        console.log("Available Console Commands:");
        console.log("  playerlist                : Show list of players");
        console.log("  kick <index>              : Kick player by index");
        console.log("  mass <index> <amount>     : Set mass of a player");
        console.log("  color <index> <r> <g> <b> : Change player color");
        console.log("  color <index> black       : Change player color to black");
        console.log("  merge <index>             : Force merge for a player");
        console.log("  tp <index> <x> <y>        : Teleport player to coords");
        console.log("  say <message>             : Broadcast a message");
        console.log("  killall                   : Remove all player cells");
        console.log("  rainbow <index> [ms]      : Start rainbow color on player");
        console.log("  rainbowoff <index|all>    : Stop rainbow color");
        console.log("  status                    : Show server status");
        console.log("  exit                      : Stop the server");
        console.log("  adminchat                  :         chat");
        console.log("========================================================");
        process.exit(0);
    }
});

// Start servers
let game;
const isRailwayDeploy = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.PORT;
if (runMaster) {
    const MasterServer = require('./MasterServer');
    const master = new MasterServer(8080);
    master.start();
}

if (runGame) {
    const GameServer = require('./GameServer');
    if (isRailwayDeploy) {
        const railwayGamemode = process.env.GAMEMODE_ID ? Number(process.env.GAMEMODE_ID) : 0;
        game = new GameServer(false, null, railwayGamemode);
        game.start();
    } else {
        game = new GameServer(false, null, 0);
        game.start();
    }
}

// ===== Rainbow Support =====
var rainbowTimers = {};
// ===== Developer Mode Support =====
var devPlayers = {};
global.devPlayers = devPlayers; // bisa diakses oleh GameServer.js


function hslToRgb(h, s, l) {
    var c = (1 - Math.abs(2*l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c/2;
    var r1, g1, b1;
    if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else              { r1 = c; g1 = 0; b1 = x; }
    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255)
    };
}

function applyColorToClient(client, rgb) {
    if (!client || !client.playerTracker) return;
    try {
        client.playerTracker.setColor(rgb);
        if (client.playerTracker.cells && client.playerTracker.cells.forEach) {
            client.playerTracker.cells.forEach(function(cell){
                if (cell && cell.setColor) cell.setColor(rgb);
            });
        }
    } catch(e) {}
}

function stopRainbow(index) {
    if (rainbowTimers[index]) {
        clearInterval(rainbowTimers[index]);
        delete rainbowTimers[index];
    }
}

function startRainbow(index, speedMs) {
    stopRainbow(index);
    var client = game && game.clients ? game.clients[index] : null;
    if (!client) return false;

    var hue = 0;
    var interval = setInterval(function(){
        hue = (hue + 7) % 360;
        var rgb = hslToRgb(hue, 1, 0.5);
        applyColorToClient(client, rgb);
    }, (isNaN(speedMs) || speedMs < 30) ? 120 : speedMs);

    rainbowTimers[index] = interval;
    return true;
}

// ===== Console Command Handling =====
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(input) {
    const text = input.trim();
    if (!text) return;

    const split = text.split(" ");
    const cmd = split[0].toLowerCase();

    switch (cmd) {
        case "dev":
        handlePlayerAction(split[1], function(client, id) {
            if (devPlayers[id]) {
                delete devPlayers[id];
                console.log("Developer mode OFF untuk player", id);
            } else {
                devPlayers[id] = true;
                console.log("Developer mode ON untuk player", id);
            }
        });
        break;
        case "playerlist":
            console.log("Players connected:", game.clients.length);
            game.clients.forEach((c, i) => {
                if (c && c.playerTracker) {
                    console.log("Index:", i, "| Name:", c.playerTracker.name, "| Score:", c.playerTracker.score);
                }
            });
            break;

        case "kick":
            handlePlayerAction(split[1], function(client, id) {
                stopRainbow(id);
                if (client.close) {
                    client.close();
                    console.log("Player", id, "kicked");
                } else {
                    console.log("Kick failed: no close() method");
                }
            });
            break;

        case "mass":
            handlePlayerAction(split[1], function(client, id) {
                const mass = parseInt(split[2]);
                if (isNaN(mass)) {
                    console.log("Usage: mass <index> <amount>");
                    return;
                }
                client.playerTracker.cells.forEach(cell => cell.mass = mass);
                console.log("Set mass of", client.playerTracker.name, "to", mass);
            });
            break;

        case "color":
            handlePlayerAction(split[1], function(client, id) {
                stopRainbow(id);
                let newColor;
                if (split[2] && split[2].toLowerCase() === "black") {
                    newColor = { r: 0, g: 0, b: 0 };
                } else {
                    const r = parseInt(split[2]);
                    const g = parseInt(split[3]);
                    const b = parseInt(split[4]);
                    if (isNaN(r) || isNaN(g) || isNaN(b)) {
                        console.log("Usage: color <index> <r> <g> <b> or color <index> black");
                        return;
                    }
                    newColor = { r: clamp(r), g: clamp(g), b: clamp(b) };
                }
                applyColorToClient(client, newColor);
                console.log("Changed color of", client.playerTracker.name, "to rgb(" + newColor.r + ", " + newColor.g + ", " + newColor.b + ")");
            });
            break;

        case "merge":
            handlePlayerAction(split[1], function(client, id) {
                client.playerTracker.cells.forEach(cell => cell.calcMergeTime(-10000));
                console.log("Forced merge for", client.playerTracker.name);
            });
            break;

        case "tp":
            handlePlayerAction(split[1], function(client, id) {
                const x = parseInt(split[2]);
                const y = parseInt(split[3]);
                if (isNaN(x) || isNaN(y)) {
                    console.log("Usage: tp <index> <x> <y>");
                    return;
                }
                client.playerTracker.cells.forEach(cell => {
                    cell.position.x = x;
                    cell.position.y = y;
                });
                console.log("Teleported", client.playerTracker.name, "to (" + x + ", " + y + ")");
            });
            break;

        case "say":
            if (split.length < 2) {
                console.log("Usage: say <message>");
                break;
            }
            const message = split.slice(1).join(" ");
            console.log("[Broadcast] " + message);
            game.clients.forEach(c => {
                if (c && c.playerTracker) {
                    console.log("Message sent to:", c.playerTracker.name);
                }
            });
            break;

        case "killall":
            for (var k in rainbowTimers) stopRainbow(k);
            let removed = 0;
            game.clients.forEach(c => {
                if (c && c.playerTracker && c.playerTracker.cells) {
                    c.playerTracker.cells.forEach(cell => {
                        game.removeNode(cell);
                        removed++;
                    });
                }
            });
            console.log("Removed", removed, "cells from all players");
            break;

        case "rainbow":
            var rid = parseInt(split[1]);
            var spd = parseInt(split[2]);
            if (isNaN(rid)) {
                console.log("Usage: rainbow <index> [speedMs]");
                break;
            }
            if (!game.clients[rid]) {
                console.log("Player " + rid + " not found");
                break;
            }
            if (startRainbow(rid, spd)) {
                console.log("Rainbow started for player " + rid + (isNaN(spd) ? "" : (" at " + spd + "ms")));
            } else {
                console.log("Failed to start rainbow for player " + rid);
            }
            break;

        case "rainbowoff":
            if (!split[1]) {
                console.log("Usage: rainbowoff <index|all>");
                break;
            }
            if (split[1].toLowerCase() === "all") {
                for (var k in rainbowTimers) stopRainbow(k);
                console.log("Rainbow stopped for all players");
                break;
            }
            var rOff = parseInt(split[1]);
            if (isNaN(rOff)) {
                console.log("Usage: rainbowoff <index|all>");
                break;
            }
            stopRainbow(rOff);
            console.log("Rainbow stopped for player " + rOff);
            break;

        case "status":
            console.log("Players:", game.clients.length);
            console.log("Uptime:", Math.floor(process.uptime()) + "s");
            break;

            case "name":
    handlePlayerAction(split[1], function(client, id) {
        const newName = split.slice(2).join(" ");
        if (!newName) {
            console.log("Usage: name <index> <newName>");
            return;
        }
        client.playerTracker.name = newName;
        console.log("Changed name of player", id, "to:", newName);
    });
    break;
case "split":
    handlePlayerAction(split[1], function(client, id) {
        if (!client || !client.playerTracker) {
            console.log("Player", id, "not found");
            return;
        }
        // jumlah split bisa ditentukan di argumen ke-2
        const times = parseInt(split[2]) || 1;
        for (let i = 0; i < times; i++) {
            client.playerTracker.splitCells();
        }
        console.log("Forced player", id, "to split" + (times > 1 ? " x" + times : ""));
    });
    break;
   case "adminchat":
    if (split.length < 2) {
        console.log("Usage: adminchat <message>");
        break;
    }
    const adminMessage = split.slice(1).join(" ");

    // Kirim chat ke semua client
    game.clients.forEach(client => {
        if (client && client.playerTracker && client.playerTracker.socket) {
            const packet = {
                type: 40, // kode packet chat di Ogar
                name: "[ADMIN] Amruflxryns", // nama admin
                message: adminMessage
            };
            client.playerTracker.socket.send(JSON.stringify(packet));
        }
    });

    console.log("[ADMIN] Amruflxryns says:", adminMessage);
    break;


        case "exit":
            console.log("Shutting down server...");
            process.exit(0);
            break;

        default:
            console.log("Unknown command:", cmd);
    }
});




// ===== Helper Functions =====
function handlePlayerAction(idString, action) {
    const id = parseInt(idString);
    if (isNaN(id)) {
        console.log("Invalid player index.");
        return;
    }
    const client = game.clients[id];
    if (!client) {
        console.log("Player", id, "not found");
        return;
    }
    action(client, id);
}

function clamp(num) {
    return Math.max(0, Math.min(255, num));
}
