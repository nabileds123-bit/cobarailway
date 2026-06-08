// Library imports
var WebSocket = require('ws');
var fs = require("fs");
var path = require("path");
var ini = require('./modules/ini.js');

// Project imports
var Packet = require('./packet');
var PlayerTracker = require('./PlayerTracker');
var PacketHandler = require('./PacketHandler');
var Entity = require('./entity');
var Gamemode = require('./gamemodes');
var handleAuth = require('./api/AuthServer');
var TOP1_HIGHSCORE_MIN_MS = 60 * 1000;

// GameServer implementation
function GameServer(mult, prt, gamemodeId) {
    // Start msg
    console.log("[Game] Ogar - An open source Agar.io server implementation");
    this.multi = mult;
    this.port = prt;
    this.gamemodeId = gamemodeId;
    this.lastNodeId = 1;
    this.clients = [];
    this.nodes = [];
    this.nodesVirus = []; // Virus nodes
    this.nodesEjected = []; // Ejected mass nodes
    this.nodesPlayer = []; // Nodes controlled by players
    
    this.currentFood = 0;
    this.movingNodes = []; // For move engine
    this.leaderboard = [];
    this.top1Tracker = {
        playerId: null,
        username: '',
        guildTag: '',
        startedAt: 0,
        lastSavedAt: 0
    };
    
    // Main loop tick
    this.time = new Date();
    this.tick = 0; // 1 second ticks of mainLoop
    this.tickMain = 0; // 50 ms ticks, 40 of these = 1 leaderboard update
    this.tickSpawn = 0; // 50 ms ticks, used with spawning food
    
    // Config
    this.config = { // Border - Right: X increases, Down: Y increases (as of 2015-05-20)
        serverMaxConnections: 64, // Maximum amount of connections to the server. 
        serverPort: 8080, // Server port
        serverGamemode: 0, // Gamemode, 0 = FFA, 1 = Teams
        serverOldColors: 0,// If the server uses colors from the original Ogar
        serverBots: 3, // Amount of player bots to spawn (Experimental)
        rainbowCells: 0,
        battleEnabled: 1, // 0 = Battle disabled, 1 = Battle enabled
        serverViewBase: 1024, // Base view distance of players. Warning: high values may cause lag
        borderLeft: 0, // Left border of map (Vanilla value: 0)
        borderRight: 6000, // Right border of map (Vanilla value: 11180.3398875)
        borderTop: 0, // Top border of map (Vanilla value: 0)
        borderBottom: 6000, // Bottom border of map (Vanilla value: 11180.3398875)
        spawnInterval: 20, // The interval between each food cell spawn in ticks (1 tick = 50 ms)
        foodSpawnAmount: 10, // The amount of food to spawn per interval
        foodStartAmount: 100, // The starting amount of food in the map
        foodMaxAmount: 500, // Maximum food cells on the map
        foodMass: 1, // Starting food size (In mass)
        foodMaxMass: 2, // Maximum food size (In mass)
        virusMinAmount: 10, // Minimum amount of viruses on the map. 
        virusMaxAmount: 50, // Maximum amount of viruses on the map. If this amount is reached, then ejected cells will pass through viruses.
        virusStartMass: 140, // Starting virus size (In mass)
        virusBurstMass: 198, // Viruses explode past this size
        ejectMass: 16, // Mass of ejected cells
        ejectMassGain: 12, // Amount of mass gained from consuming ejected cells
        ejectSpeed: 120, // Base speed of ejected cells
        ejectSpawnPlayer: 50, // Chance for a player to spawn from ejected mass
        playerStartMass: 10, // Starting mass of the player cell.
        playerMaxMass: 22500, // Maximum mass a player can have
        playerMinMassEject: 32, // Mass required to eject a cell
        playerMinMassSplit: 36, // Mass required to split
        playerMaxCells: 16, // Max cells the player is allowed to have
        playerSplitSpeedBase: 50, // Base speed for player split boost
        playerSplitSpeedMultiplier: 5, // Mouse speed influence for split boost
        playerSplitMinSpeed: 90, // Minimum split boost speed
        playerSplitMaxSpeed: 125, // Maximum split boost speed
        playerSplitMoveTicks: 10, // Amount of ticks split cells keep boost
        playerSplitDecay: 0.82, // Split boost decay
        playerSplitCooldownMs: 80, // Minimum time between split commands per player
        playerEjectCooldown: 120, // Minimum time between eject mass commands per player (milliseconds)
        playerEjectDebugLog: 1, // Logs manual W vs hold E eject/packet rate once per second
        playerRecombineTime: 15, // Base amount of ticks before a cell is allowed to recombine (1 tick = 2000 milliseconds)
        playerMassDecayRate: 4, // Amount of mass lost per tick (Multiplier) (1 tick = 2000 milliseconds)
        playerMinMassDecay: 9, // Minimum mass for decay to occur
        gameLBlength: 10, // Amount of players shown on the leaderboard
        leaderboardUpdateClient: 40, // How often leaderboard data is sent to the client (1 tick = 50 milliseconds)
      //  serverSubdomain: 'marios-best-game',
        ejectVirus: 0,
        serverTitle: 'Ogar3',
        serverPlaceholder: 'Nick'
    };
    // Parse config
    this.loadConfig();
    
    // Gamemodes
    var selectedGamemode = typeof this.gamemodeId == "number" ? this.gamemodeId : this.config.serverGamemode;
    this.gameMode = Gamemode.get(selectedGamemode);
    this.parentServer = null;
    this.rooms = null;
    this.battleQueues = null;
    this.battleMatches = [];
    this.roomName = this.gameMode.name;
    this.worldStarted = false;
    
    // Colors
    this.colors = [{'r':235,'b':0,'g':75},{'r':225,'b':255,'g':125},{'r':180,'b':20,'g':7},{'r':80,'b':240,'g':170},{'r':180,'b':135,'g':90},{'r':195,'b':0,'g':240},{'r':150,'b':255,'g':18},{'r':80,'b':0,'g':245},{'r':165,'b':0,'g':25},{'r':80,'b':0,'g':145},{'r':80,'b':240,'g':170},{'r':55,'b':255,'g':92}]; 
}

module.exports = GameServer;

GameServer.prototype.initGameWorld = function() {
    if (this.worldStarted) {
        return;
    }

    if (this.config.serverBots > 0 || this.gameMode.name == "Tournament") {
        var BotLoader = require('./ai/BotLoader.js');
        this.bots = new BotLoader(this,0);
    }

    // Gamemode configurations
    this.gameMode.onServerInit(this);
    if (this.gameMode.name == "Tournament") {
        this.config.leaderboardUpdateClient = 20;
    }

    for (var i = 0; i < this.config.foodStartAmount; i++) {
        this.spawnFood();
    }

    // Start Main Loop
    setInterval(this.mainLoop.bind(this), 1);
    this.worldStarted = true;

    // Player bots (Experimental)
    if (this.config.serverBots > 0) {
        for (var botIndex = 0; botIndex < this.config.serverBots; botIndex++) {
            this.bots.addBot();
        }
        console.log("[Game] Loaded "+this.config.serverBots+" player bots in "+(this.roomName || this.gameMode.name));
    }
};

GameServer.prototype.start = function() {
    if (handleAuth.setOnlinePlayersProvider) {
        handleAuth.setOnlinePlayersProvider(function() {
            return this.getHub().getOnlineGuildPlayers();
        }.bind(this));
    }

    this.config.serverPort = process.env.PORT || this.config.serverPort ;

    if (!this.multi) {
        this.rooms = {
            FFA: this,
            Teams: this.createInternalRoom('Teams', 1),
            Hardcore: this.createInternalRoom('Hardcore', 2),
            Exp: this.createInternalRoom('Exp', 0),
            Battle: this.createInternalRoom('Battle', 10),
            Tournament: this.createInternalRoom('Tournament', 10)
        };
        this.roomName = 'FFA';
        this.battleQueues = {
            '1v1': [],
            '2v2': []
        };
        this.rooms.Teams.config.serverBots = 0;
        this.rooms.Hardcore.config.serverBots = 0;
        this.rooms.Exp.config.serverBots = 0;
        this.rooms.Battle.config.serverBots = 0;
        this.rooms.Tournament.config.serverBots = 0;
        this.rooms.Exp.config.playerStartMass *= 5;
        this.initGameWorld();
        this.rooms.Teams.initGameWorld();
        this.rooms.Hardcore.initGameWorld();
        this.rooms.Exp.initGameWorld();
        this.rooms.Battle.config.tourneyAutoFill = 0;
        this.rooms.Battle.initGameWorld();
        this.rooms.Tournament.initGameWorld();
    } else {
        this.initGameWorld();
    }
    
    var http = require('http');

    var finalhandler = require('finalhandler');
    var serveStatic = require('serve-static');
    
    
    var serve = serveStatic(__dirname);
    
    var self = this;
    var hserver = http.createServer(function(req, res){
      var pathname = req.url.split('?')[0];
      if (pathname == '/' || pathname == '/index.html') {
        req.url = '/client/index.html';
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      if (req.url == '/info.php' || req.url == '/api/regions') {
        var region = 'Ocenia';
        var count = self.getAllClients().filter(function(client) {
          return client && client.playerTracker && client.playerTracker.isOnline;
        }).length;
        var payload = {
          regions: {},
          totals: {
            numPlayers: count,
            numRealms: 1,
            numServers: 1
          }
        };

        payload.regions[region] = {
          numPlayers: count,
          numRealms: 1,
          numServers: 1
        };

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(payload));
        return;
      }

      if (pathname == '/api/free-skins') {
        var skinsDir = path.join(__dirname, 'skins');
        fs.readdir(skinsDir, function(err, files) {
          var payload = { skins: [] };

          if (!err && files) {
            payload.skins = files.filter(function(file) {
              return /\.(png|jpe?g|webp)$/i.test(file);
            });
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          });
          res.end(JSON.stringify(payload));
        });
        return;
      }

      if (handleAuth(req, res)) {
        return;
      }
      var done = finalhandler(req, res)
      serve(req, res, done)
    });
    if(this.multi){
    hserver.listen(this.port);
    } else {
    hserver.listen(this.config.serverPort);
    }
    
    
    // Start the server
    this.socketServer = new WebSocket.Server({server: hserver });
    
    // Done
    var listenPort = this.multi ? this.port : this.config.serverPort;
    console.log("[Game] Listening on port %d", listenPort);
    console.log("[Game] Current game mode is "+this.gameMode.name);
    // index.html is not modified by the server
    this.socketServer.on('connection', connectionEstablished.bind(this));

    function connectionEstablished(ws) {


        if (this.getAllClients().length > this.config.serverMaxConnections) {
            ws.close();
            console.log("[Game] Client tried to connect, but server player limit has been reached!");
            return;
        }
        
        function close(error) {
            console.log("[Game] Disconnect: %s:%d", this.socket.remoteAddress, this.socket.remotePort);
            this.server.removeSocketFromAllRooms(this.socket);
            
            // Switch online flag off
            if (this.socket.playerTracker) {
                this.socket.playerTracker.setStatus(false);
            }
        }

        console.log("[Game] Connect: %s:%d", ws._socket.remoteAddress, ws._socket.remotePort);
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        this.joinSocketToRoom(ws, this.rooms ? this.rooms.FFA : this);
        ws.on('message', function(message) {
            if (ws.packetHandler) {
                ws.packetHandler.handleMessage(message);
            }
        });

        var bindObject = { server: this, socket: ws };
        ws.on('error', close.bind(bindObject));
        ws.on('close', close.bind(bindObject));
    }
}

GameServer.prototype.createInternalRoom = function(name, gamemodeId) {
    var room = new GameServer(true, null, gamemodeId);
    room.parentServer = this;
    room.roomName = name;
    return room;
}

GameServer.prototype.getHub = function() {
    return this.parentServer || this;
}

GameServer.prototype.isBattleEnabled = function() {
    var hub = this.getHub();
    var value = hub.config ? hub.config.battleEnabled : 0;
    return value === true || String(value).trim().toLowerCase() == 'true' || Number(value) == 1;
}

GameServer.prototype.isBattleModeName = function(modeName) {
    modeName = String(modeName || '');
    return modeName == 'Battle' || modeName == 'Tournament';
}

GameServer.prototype.isBattleRoom = function(room) {
    if (!room) {
        return false;
    }

    var roomName = String(room.roomName || '');
    var gameModeName = room.gameMode ? String(room.gameMode.name || '') : '';
    return roomName == 'Battle' ||
        roomName == 'Tournament' ||
        roomName.indexOf('BattleMatch-') === 0 ||
        gameModeName == 'Tournament';
}

GameServer.prototype.resetBattlePlayerState = function(socket) {
    var player = socket && socket.playerTracker;
    if (!player) {
        return;
    }

    player.battleState = 'idle';
    player.battleTeam = null;
    player.battleType = null;
    player.matchId = null;
    player.spectate = false;
    player.battlePointSettled = false;
    player.currentRoom = player.gameServer || null;
    if (player.gameServer && !this.isBattleRoom(player.gameServer)) {
        player.currentMode = player.gameServer.roomName || player.gameServer.gameMode.name;
    }
}

GameServer.prototype.sendSocketMessage = function(socket, msg) {
    if (socket && socket.sendPacket) {
        socket.sendPacket(new Packet.Message(String(msg || '')));
    }
}

GameServer.prototype.rejectBattleSocket = function(socket) {
    var hub = this.getHub();
    var player = socket && socket.playerTracker;
    var battleType = player && player.battleMode ? player.battleMode : '1v1';

    if (hub.battleQueues) {
        hub.removeFromBattleQueues(socket);
    }

    if (player && hub.rooms && hub.rooms.FFA && hub.isBattleRoom(player.gameServer)) {
        hub.joinSocketToRoom(socket, hub.rooms.FFA);
    }

    hub.resetBattlePlayerState(socket);
    hub.sendBattleStatus(socket, 'disabled', battleType);
    hub.sendSocketMessage(socket, 'Battle sedang ditutup sementara.');
}

GameServer.prototype.getAllClients = function() {
    var hub = this.getHub();
    if (!hub.rooms) {
        return this.clients.slice();
    }

    var sockets = [];
    Object.keys(hub.rooms).forEach(function(key) {
        var room = hub.rooms[key];
        for (var i = 0; i < room.clients.length; i++) {
            if (sockets.indexOf(room.clients[i]) == -1) {
                sockets.push(room.clients[i]);
            }
        }
    });
    for (var j = 0; j < hub.battleMatches.length; j++) {
        var match = hub.battleMatches[j];
        for (var k = 0; k < match.clients.length; k++) {
            if (sockets.indexOf(match.clients[k]) == -1) {
                sockets.push(match.clients[k]);
            }
        }
    }
    return sockets;
}

GameServer.prototype.getOnlineGuildPlayers = function() {
    return this.getAllClients().map(function(socket) {
        var player = socket && socket.playerTracker;
        if (!player || !player.authUserId || !player.isOnline) {
            return null;
        }

        var mode = player.currentMode || (player.gameServer && (player.gameServer.roomName || player.gameServer.gameMode.name)) || 'FFA';
        var battleType = player.battleType || player.battleMode || '';
        var joinMode = '';
        var modeLabel = mode;

        if (mode == 'Hardcore') {
            joinMode = ':hardcore';
            modeLabel = 'Hardcore';
        } else if (mode == 'Exp') {
            joinMode = ':x5';
            modeLabel = 'x5';
        } else if (mode == 'Battle' || mode == 'BattleLobby') {
            joinMode = ':tournament';
            modeLabel = battleType == '2v2' ? 'Battle 2v2' : 'Battle 1v1';
        } else if (mode == 'Teams') {
            joinMode = ':teams';
            modeLabel = 'Teams';
        } else {
            joinMode = '';
            modeLabel = 'FFA';
        }

        return {
            userId: player.authUserId,
            guild: player.getGuildTag ? player.getGuildTag() : String(player.guildTag || '').trim().toUpperCase(),
            mode: joinMode,
            modeLabel: modeLabel,
            battleType: battleType
        };
    }).filter(function(player) {
        return !!player;
    });
}

GameServer.prototype.normalizeModeName = function(mode) {
    mode = String(mode || '').trim().toLowerCase();
    if (mode == ':teams' || mode == 'teams') return 'Teams';
    if (mode == ':hardcore' || mode == 'hardcore') return 'Hardcore';
    if (mode == ':x5' || mode == 'x5' || mode == 'exp' || mode == 'experimental') return 'Exp';
    if (mode == ':tournament' || mode == 'battle') return 'Battle';
    if (mode == 'tournament') return 'Tournament';
    return 'FFA';
}

GameServer.prototype.copyPlayerSession = function(oldPlayer, newPlayer) {
    if (!oldPlayer || !newPlayer) {
        return;
    }

    newPlayer.name = oldPlayer.name || "";
    newPlayer.authUserId = oldPlayer.authUserId;
    newPlayer.authUsername = oldPlayer.authUsername;
    newPlayer.accountType = oldPlayer.accountType || 'Guest';
    newPlayer.adminRole = oldPlayer.adminRole || '';
    newPlayer.accountPoints = Number(oldPlayer.accountPoints || 0);
    newPlayer.guildTag = oldPlayer.guildTag || '';
    newPlayer.fakeGuildPrefixRenderBug = false;
    newPlayer.skinUrl = oldPlayer.skinUrl || null;
    newPlayer.cellColor = oldPlayer.cellColor || null;
    newPlayer.lastPassiveXpTime = oldPlayer.lastPassiveXpTime || Date.now();
    newPlayer.battleMode = oldPlayer.battleMode || '1v1';
    newPlayer.battleState = oldPlayer.battleState || 'idle';
    newPlayer.battleTeam = oldPlayer.battleTeam || null;
    newPlayer.currentMode = oldPlayer.currentMode || 'FFA';
    newPlayer.currentRoom = oldPlayer.currentRoom || null;
    newPlayer.battleType = oldPlayer.battleType || oldPlayer.battleMode || '1v1';
    newPlayer.matchId = oldPlayer.matchId || null;
}

GameServer.prototype.removeSocketFromRoom = function(room, socket) {
    if (!room || !socket) {
        return;
    }

    var player = socket.playerTracker;
    if (player && player.gameServer == room) {
        var cells = player.cells.slice();
        for (var i = 0; i < cells.length; i++) {
            room.removeNode(cells[i]);
        }
        player.visibleNodes = [];
        player.nodeDestroyQueue = [];
    }

    var index = room.clients.indexOf(socket);
    if (index != -1) {
        room.clients.splice(index, 1);
    }
}

GameServer.prototype.removeSocketFromAllRooms = function(socket) {
    var hub = this.getHub();
    if (hub.battleQueues) {
        hub.removeFromBattleQueues(socket);
    }

    if (hub.rooms) {
        Object.keys(hub.rooms).forEach(function(key) {
            hub.removeSocketFromRoom(hub.rooms[key], socket);
        });
    } else {
        hub.removeSocketFromRoom(hub, socket);
    }

    for (var i = 0; i < hub.battleMatches.length; i++) {
        hub.removeSocketFromRoom(hub.battleMatches[i], socket);
    }
}

GameServer.prototype.joinSocketToRoom = function(socket, room) {
    var hub = this.getHub();
    var oldPlayer = socket.playerTracker;

    hub.removeSocketFromAllRooms(socket);
    socket.playerTracker = new PlayerTracker(room, socket);
    hub.copyPlayerSession(oldPlayer, socket.playerTracker);
    socket.playerTracker.gameServer = room;
    socket.playerTracker.currentRoom = room;
    socket.playerTracker.currentMode = room.roomName && room.roomName.indexOf('BattleMatch-') === 0 ? 'Battle' : (room.roomName || room.gameMode.name);
    socket.packetHandler = new PacketHandler(room, socket);
    room.clients.push(socket);

    if (socket.sendPacket) {
        socket.sendPacket(new Packet.ClearNodes());
        socket.sendPacket(new Packet.SetBorder(room.config.borderLeft, room.config.borderRight, room.config.borderTop, room.config.borderBottom));
    }

    console.log("[JOIN_MODE] %s -> %s", socket.playerTracker.getName() || "(no nick)", room.roomName || room.gameMode.name);
}

GameServer.prototype.joinClientToMode = function(mode, socket) {
    var hub = this.getHub();
    var modeName = hub.normalizeModeName(mode);
    var room = hub.rooms ? hub.rooms[modeName] : hub;

    if (hub.isBattleModeName(modeName) && !hub.isBattleEnabled()) {
        console.log("[JOIN_MODE_BLOCKED] %s requested=%s reason=battle_disabled", socket.playerTracker ? socket.playerTracker.getName() || "(no nick)" : "(no player)", modeName);
        hub.rejectBattleSocket(socket);
        return socket.playerTracker;
    }

    if (socket.playerTracker && (socket.playerTracker.battleState == 'finding' || socket.playerTracker.battleState == 'preparing' || socket.playerTracker.battleState == 'in_match')) {
        console.log("[JOIN_MODE_BLOCKED] %s state=%s requested=%s room=%s", socket.playerTracker.getName() || "(no nick)", socket.playerTracker.battleState, modeName, socket.playerTracker.currentMode || "");
        return socket.playerTracker;
    }

    if (!room) {
        room = hub.rooms.FFA;
    }

    if (socket.playerTracker && socket.playerTracker.gameServer == room) {
        return socket.playerTracker;
    }

    hub.joinSocketToRoom(socket, room);
    return socket.playerTracker;
}

GameServer.prototype.removeFromBattleQueues = function(socket) {
    if (!this.battleQueues) {
        return;
    }

    Object.keys(this.battleQueues).forEach(function(type) {
        var queue = this.battleQueues[type];
        var index = queue.indexOf(socket);
        if (index != -1) {
            queue.splice(index, 1);
            this.broadcastBattleQueueStatus(type);
        }
    }, this);
}

GameServer.prototype.broadcastBattleQueueStatus = function(battleType) {
    if (!this.battleQueues || !this.battleQueues[battleType]) {
        return;
    }

    var queue = this.battleQueues[battleType];
    var count = queue.length;
    for (var i = 0; i < queue.length; i++) {
        this.sendBattleStatus(queue[i], 'finding', battleType, count);
    }
}

GameServer.prototype.parkSocketForBattleQueue = function(socket) {
    var player = socket && socket.playerTracker;
    if (!player || !player.gameServer) {
        return;
    }

    var room = player.gameServer;
    var cells = player.cells.slice();
    for (var i = 0; i < cells.length; i++) {
        room.removeNode(cells[i]);
    }

    player.cells.length = 0;
    player.visibleNodes = [];
    player.nodeDestroyQueue = [];
    player.spectate = false;

    if (socket.sendPacket) {
        socket.sendPacket(new Packet.ClearNodes());
    }
}

GameServer.prototype.sendBattleStatus = function(socket, status, battleType, countdown) {
    if (!socket || !socket.send || socket.readyState != WebSocket.OPEN) {
        return;
    }

    var parts = [String(status || ''), String(battleType || ''), String(null == countdown ? '' : countdown)];
    var size = 1;
    for (var i = 0; i < parts.length; i++) {
        size += parts[i].length * 2 + 2;
    }
    var buf = new ArrayBuffer(size);
    var view = new DataView(buf);
    var offset = 0;
    view.setUint8(offset++, 106);
    for (var p = 0; p < parts.length; p++) {
        for (var j = 0; j < parts[p].length; j++) {
            view.setUint16(offset, parts[p].charCodeAt(j), true);
            offset += 2;
        }
        view.setUint16(offset, 0, true);
        offset += 2;
    }
    socket.send(buf);
}

GameServer.prototype.joinBattleQueue = function(socket, battleType) {
    var hub = this.getHub();
    if (!hub.rooms || !hub.battleQueues) {
        return;
    }

    battleType = String(battleType || '').toLowerCase() == '2v2' ? '2v2' : '1v1';
    if (!hub.isBattleEnabled()) {
        console.log("[BATTLE_QUEUE_BLOCKED] %s %s reason=battle_disabled", battleType, socket.playerTracker ? socket.playerTracker.getName() || "(no nick)" : "(no player)");
        hub.rejectBattleSocket(socket);
        return;
    }

    hub.removeFromBattleQueues(socket);

    var player = socket.playerTracker;
    if (hub.rooms.Battle && (!player || player.gameServer != hub.rooms.Battle)) {
        hub.joinSocketToRoom(socket, hub.rooms.Battle);
        player = socket.playerTracker;
    }

    hub.parkSocketForBattleQueue(socket);
    player.battleMode = battleType;
    player.battleState = 'finding';
    player.currentMode = 'BattleLobby';
    player.battleType = battleType;
    hub.battleQueues[battleType].push(socket);
    console.log("[BATTLE_QUEUE_JOIN] %s %s", battleType, player.getName() || "(no nick)");
    hub.broadcastBattleQueueStatus(battleType);
    hub.checkBattleQueue(battleType);
}

GameServer.prototype.checkBattleQueue = function(battleType) {
    var need = battleType == '2v2' ? 4 : 2;
    var queue = this.battleQueues[battleType];
    while (queue.length >= need) {
        var sockets = queue.splice(0, need);
        this.createBattleMatch(battleType, sockets);
    }
    this.broadcastBattleQueueStatus(battleType);
}

GameServer.prototype.configureBattleArena = function(match, battleType) {
    var isTwoVsTwo = battleType == '2v2';

    match.config.borderLeft = 0;
    match.config.borderTop = 0;
    match.config.borderRight = isTwoVsTwo ? 7500 : 5000;
    match.config.borderBottom = isTwoVsTwo ? 7500 : 5000;

    match.config.foodStartAmount = isTwoVsTwo ? 320 : 180;
    match.config.foodMaxAmount = isTwoVsTwo ? 700 : 420;
    match.config.foodSpawnAmount = isTwoVsTwo ? 8 : 5;
    match.config.spawnInterval = isTwoVsTwo ? 18 : 22;
    match.config.foodMass = 1;
    match.config.foodMaxMass = 5;

    match.config.virusMinAmount = isTwoVsTwo ? 8 : 4;
    match.config.virusMaxAmount = isTwoVsTwo ? 18 : 10;
    match.config.virusStartMass = 100;
    match.config.virusBurstMass = 198;
    match.config.playerStartMass = 300;
    match.config.playerMaxCells = 16;
    match.config.tourneyAutoFill = 0;
    match.config.serverBots = 0;
    console.log("[BATTLE_ARENA] %s map=%dx%d food=%d/%d virus=%d-%d startMass=%d",
        battleType,
        match.config.borderRight - match.config.borderLeft,
        match.config.borderBottom - match.config.borderTop,
        match.config.foodStartAmount,
        match.config.foodMaxAmount,
        match.config.virusMinAmount,
        match.config.virusMaxAmount,
        match.config.playerStartMass
    );
};

GameServer.prototype.createBattleMatch = function(battleType, sockets) {
    if (!this.isBattleEnabled()) {
        for (var blockedIndex = 0; blockedIndex < sockets.length; blockedIndex++) {
            this.rejectBattleSocket(sockets[blockedIndex]);
        }
        return;
    }

    var matchId = 'battle_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    var match = this.createInternalRoom('BattleMatch-' + matchId, 10);
    match.matchId = matchId;
    match.battleType = battleType;
    this.configureBattleArena(match, battleType);
    match.initGameWorld();
    match.gameMode.battleMode = battleType;
    match.gameMode.applyBattleSettings();
    this.battleMatches.push(match);

    console.log("[BATTLE_FOUND] %s players=%d", battleType, sockets.length);
    for (var i = 0; i < sockets.length; i++) {
        var socket = sockets[i];
        var oldMode = socket.playerTracker ? socket.playerTracker.battleMode : battleType;
        this.joinSocketToRoom(socket, match);
        socket.playerTracker.battleMode = oldMode == '2v2' ? '2v2' : battleType;
        socket.playerTracker.battleType = battleType;
        socket.playerTracker.battleState = 'preparing';
        socket.playerTracker.battleTeam = battleType == '2v2' ? (i < 2 ? 'A' : 'B') : null;
        socket.playerTracker.currentMode = 'Battle';
        socket.playerTracker.currentRoom = match;
        socket.playerTracker.matchId = matchId;
        this.sendBattleStatus(socket, 'preparing', battleType, 5);
    }

    console.log("[BATTLE_PREPARING] %s", battleType);
    setTimeout(function() {
        this.startPreparedBattleMatch(match, battleType, sockets);
    }.bind(this), 5000);
}

GameServer.prototype.finishBattleMatch = function() {
    var match = this;
    if (match.battleFinished) {
        return;
    }

    match.battleFinished = true;
    var hub = this.getHub();
    var battleType = match.battleType || (match.gameMode && match.gameMode.battleMode) || '1v1';
    var sockets = match.clients.slice();

    console.log("[BATTLE_MATCH_FINISH] %s %s", match.matchId || "(no match id)", battleType);

    for (var i = 0; i < sockets.length; i++) {
        var socket = sockets[i];
        if (!socket || !socket.playerTracker) {
            continue;
        }

        socket.playerTracker.battleState = 'idle';
        socket.playerTracker.currentMode = 'FFA';
        socket.playerTracker.matchId = null;
        socket.playerTracker.battleType = null;
        socket.playerTracker.battleTeam = null;
        socket.playerTracker.spectate = false;
        match.sendBattleStatus(socket, 'finished', battleType);

        if (hub.rooms && hub.rooms.FFA) {
            hub.joinSocketToRoom(socket, hub.rooms.FFA);
            socket.playerTracker.battleState = 'idle';
            socket.playerTracker.currentMode = 'FFA';
            socket.playerTracker.battleType = null;
            socket.playerTracker.battleTeam = null;
            socket.playerTracker.matchId = null;
            socket.playerTracker.spectate = false;
        }
    }

    var nodes = match.nodes.slice();
    for (var n = 0; n < nodes.length; n++) {
        match.removeNode(nodes[n]);
    }
    match.nodes.length = 0;
    match.nodesPlayer.length = 0;
    match.nodesVirus.length = 0;
    match.nodesEjected.length = 0;
    match.movingNodes.length = 0;
    match.currentFood = 0;
    match.leaderboard.length = 0;

    var index = hub.battleMatches.indexOf(match);
    if (index != -1) {
        hub.battleMatches.splice(index, 1);
    }
}

GameServer.prototype.startPreparedBattleMatch = function(match, battleType, sockets) {
    if (!this.isBattleEnabled()) {
        for (var blockedIndex = 0; blockedIndex < sockets.length; blockedIndex++) {
            this.rejectBattleSocket(sockets[blockedIndex]);
        }
        return;
    }

    console.log("[BATTLE_MATCH_START] %s %s", match.matchId, battleType);
    console.log("[ROOM_GAMEMODE] %s", match.gameMode.name);
    for (var j = 0; j < sockets.length; j++) {
        if (!sockets[j].playerTracker || sockets[j].playerTracker.gameServer != match) {
            continue;
        }
        sockets[j].playerTracker.battleState = 'in_match';
        sockets[j].playerTracker.currentMode = 'Battle';
        sockets[j].playerTracker.currentRoom = match;
        sockets[j].playerTracker.battleType = battleType;
        sockets[j].playerTracker.matchId = match.matchId;
        console.log("[PLAYER_ROOM] %s %s %s %s", sockets[j].playerTracker.getName() || "(no nick)", sockets[j].playerTracker.currentMode, sockets[j].playerTracker.battleType, sockets[j].playerTracker.matchId);
        this.sendBattleStatus(sockets[j], 'in_match', battleType);
        if (sockets[j].sendPacket) {
            sockets[j].sendPacket(new Packet.ClearNodes());
            sockets[j].sendPacket(new Packet.SetBorder(match.config.borderLeft, match.config.borderRight, match.config.borderTop, match.config.borderBottom));
        }
        match.gameMode.onPlayerSpawn(match, sockets[j].playerTracker);
    }

}

GameServer.prototype.getMode = function() {
    return this.gameMode;
}

GameServer.prototype.getNextNodeId = function() {
    // Resets integer
    if (this.lastNodeId > 2147483647) {
        this.lastNodeId = 1;
    }
    return this.lastNodeId++;
}

GameServer.prototype.getRandomPosition = function() {
    return {
        x: Math.floor(Math.random() * (this.config.borderRight - this.config.borderLeft)) + this.config.borderLeft,
        y: Math.floor(Math.random() * (this.config.borderBottom - this.config.borderTop)) + this.config.borderTop
    };
}
GameServer.prototype.getCertainPosition = function(a, b) {
    return {
        x: a,
        y: b
    };
}
GameServer.prototype.getRandomColor = function() {
  if(this.config.serverOldColors) {
      var index = Math.floor(Math.random() * this.colors.length);
    var color = this.colors[index];
    return {
        r: color.r,
        b: color.b,
        g: color.g
  }; } else {
  var colorRGB = [0xFF, 0x07, (Math.random() * 256) >> 0];
    colorRGB.sort(function() {
        return 0.5 - Math.random();
    });
    return {
        r: colorRGB[0],
        g: colorRGB[1],
        b: colorRGB[2]
    };
  }
};

GameServer.prototype.addNode = function(node) {
    this.nodes.push(node);
    
    // Special on-add actions
    node.onAdd(this);
    
    // Adds to the owning player's screen
    if (node.owner){
        node.owner.socket.sendPacket(new Packet.AddNodes(node));
    }
    
    // Add to visible nodes
    for (var i = 0; i < this.clients.length;i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }

        if (node.visibleCheck(client.viewBox,client.centerPos)) {
            client.visibleNodes.push(node);
        }
    }
}

GameServer.prototype.removeNode = function(node) {
    // Remove from main nodes list
    var index = this.nodes.indexOf(node);
    if (index != -1) {
        this.nodes.splice(index, 1);
    }
    
    // Remove from moving cells list
    index = this.movingNodes.indexOf(node);
    if (index != -1) {
        this.movingNodes.splice(index, 1);
    }
    
    // Special on-remove actions
    node.onRemove(this);
    
    // Animation when eating
    for (var i = 0; i < this.clients.length;i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }

        // Remove from client
        client.nodeDestroyQueue.push(node); 
    }
}

GameServer.prototype.mainLoop = function() {
    // Timer
    var local = new Date();
    this.tick += (local - this.time);
    this.time = local;

    if (this.tick >= 50) {
        // Loop main functions
        this.updateMoveEngine();
        this.updateClients();
        
        // Spawn food
        this.tickSpawn++;
        if (this.tickSpawn >= this.config.spawnInterval) {
            this.updateFood(); // Spawn food
            this.virusCheck(); // Spawn viruses
            
            this.tickSpawn = 0; // Reset
        }
        
        // Update cells/leaderboard loop
        this.tickMain++;
        var leaderboardTickRate = this.gameMode && this.gameMode.name == "Tournament" ? 20 : 40;
        if (this.tickMain >= leaderboardTickRate) {
            // Update cells
            this.updateCells();
            
            // Update leaderboard with the gamemode's method
            this.leaderboard = []; 
            this.gameMode.updateLB(this);
            this.updateTop1Timer();
            
            this.tickMain = 0; // Reset
        }
        
        // Debug
        //console.log(this.tick - 50);
        
        // Reset
        this.tick = 0; 
    }
}

GameServer.prototype.sendMessage = function(msg) {
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        if (!this.clients[i].playerTracker || this.clients[i].playerTracker.gameServer != this) {
            continue;
        }

        this.clients[i].playerTracker.socket.sendPacket(new Packet.Message(msg));
    }
}

GameServer.prototype.getHighscoreModeName = function() {
    var modeName = this.roomName || (this.gameMode && this.gameMode.name) || '';
    var battleType = this.battleType || (this.gameMode && this.gameMode.battleMode) || '';
    if (modeName.indexOf('Battle') === 0 || battleType) {
        return battleType == '2v2' ? 'battle_2v2' : 'battle_1v1';
    }
    if (this.gameMode && this.gameMode.name == 'Hardcore') {
        return 'hardcore';
    }
    return 'ffa';
}

GameServer.prototype.getHighscoreRegionName = function() {
    return 'global';
}

GameServer.prototype.resetTop1Tracker = function() {
    this.top1Tracker.playerId = null;
    this.top1Tracker.username = '';
    this.top1Tracker.guildTag = '';
    this.top1Tracker.startedAt = 0;
    this.top1Tracker.lastSavedAt = 0;
}

GameServer.prototype.startTop1Session = function(player, now) {
    this.top1Tracker.playerId = player.authUserId;
    this.top1Tracker.username = player.authUsername || player.getName() || 'Unknown';
    this.top1Tracker.guildTag = player.getGuildTag ? player.getGuildTag() : String(player.guildTag || '').trim().toUpperCase();
    this.top1Tracker.startedAt = now;
    this.top1Tracker.lastSavedAt = now;
    player.top1StartedAt = now;
}

GameServer.prototype.closeTop1Session = function(now) {
    if (!this.top1Tracker.playerId || !this.top1Tracker.startedAt) {
        this.resetTop1Tracker();
        return;
    }

    now = now || Date.now();
    var durationSeconds = Math.floor((now - this.top1Tracker.startedAt) / 1000);
    if (durationSeconds >= Math.floor(TOP1_HIGHSCORE_MIN_MS / 1000)) {
        if (handleAuth.recordTop1Time) {
            handleAuth.recordTop1Time(
                this.top1Tracker.playerId,
                this.top1Tracker.username || 'Unknown',
                this.getHighscoreModeName(),
                this.getHighscoreRegionName(),
                this.roomName || (this.gameMode && this.gameMode.name) || 'Server',
                durationSeconds
            ).catch(function(error) {
                console.log("[Auth] Top1 highscore save failed:", error && error.message ? error.message : error);
            });
        }

        if (handleAuth.recordGuildTop1Session) {
            handleAuth.recordGuildTop1Session({
                userId: this.top1Tracker.playerId,
                username: this.top1Tracker.username || 'Unknown',
                guildTag: this.top1Tracker.guildTag || '',
                startedAt: new Date(this.top1Tracker.startedAt),
                endedAt: new Date(now),
                durationSeconds: durationSeconds
            }).catch(function(error) {
                console.log("[Auth] Guild top1 session save failed:", error && error.message ? error.message : error);
            });
        }
    }

    this.resetTop1Tracker();
}

GameServer.prototype.updateTop1Timer = function() {
    var now = Date.now();
    if (!this.leaderboard || !this.leaderboard.length) {
        this.closeTop1Session(now);
        return;
    }

    var player = this.leaderboard[0];
    if (!player || !player.authUserId || !player.cells || player.cells.length <= 0) {
        this.closeTop1Session(now);
        return;
    }

    if (this.top1Tracker.playerId != player.authUserId) {
        this.closeTop1Session(now);
        this.startTop1Session(player, now);
        return;
    }

    player.top1StartedAt = this.top1Tracker.startedAt;
}

GameServer.prototype.awardPlayerXp = function(client, amount, reason) {
    if (!client || !client.authUserId || !amount) {
        return;
    }

    handleAuth.awardXp(client.authUserId, amount, reason)
        .catch(function(error) {
            console.log("[Auth] XP award failed:", error && error.message ? error.message : error);
        });
}

GameServer.prototype.adjustPlayerPoints = function(client, amount, reason) {
    if (!client || !client.authUserId || !amount || !handleAuth.adjustPoints) {
        return;
    }

    handleAuth.adjustPoints(client.authUserId, amount, reason)
        .catch(function(error) {
            console.log("[Auth] Points adjust failed:", error && error.message ? error.message : error);
        });
}

GameServer.prototype.updateClients = function() {
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.update();
    }
}

GameServer.prototype.updateFood = function() {
    var toSpawn = Math.min(this.config.foodSpawnAmount,(this.config.foodMaxAmount-this.currentFood));
    for (var i = 0; i < toSpawn; i++) {
        this.spawnFood();
    }    
}

GameServer.prototype.spawnFood = function() {
var f = new Entity.Food(this.getNextNodeId(), null, this.getRandomPosition(), Math.floor(Math.random() * this.config.foodMaxMass) + this.config.foodMass);
  f.setColor(this.getRandomColor());
    
    this.addNode(f);
    this.currentFood++; 
}

GameServer.prototype.spawnPlayer = function(client) {
   if (!client || client.gameServer !== this) {
       console.log("[SPAWN_BLOCKED] %s requested=%s actual=%s", client && client.getName ? client.getName() : "(no client)", this.roomName || this.gameMode.name, client && client.gameServer ? (client.gameServer.roomName || client.gameServer.gameMode.name) : "(none)");
       return;
   }

   if (this.isBattleRoom(this) && !this.isBattleEnabled()) {
       console.log("[SPAWN_BLOCKED] %s requested=%s reason=battle_disabled", client && client.getName ? client.getName() : "(no client)", this.roomName || this.gameMode.name);
       this.getHub().rejectBattleSocket(client.socket);
       return;
   }

   if(this.config.serverGameMode == 2) {
   var pos = this.getCertainPosition(0,0);
   } else {
   var pos = this.getRandomPosition();
   }
    
    var startMass = this.config.playerStartMass;
    
    // Check if there are ejected mass in the world. Does not work in team mode
    if ((this.nodesEjected.length > 0) && (!this.gameMode.haveTeams)) {
        var index = Math.floor(Math.random() * 100) + 1;
        if (index <= this.config.ejectSpawnPlayer) {
            // Get ejected cell
            var index = Math.floor(Math.random() * this.nodesEjected.length);
            var e = this.nodesEjected[index];
            
            // Remove ejected mass
            this.removeNode(e);
            
            // Inherit
            pos.x = e.position.x;
            pos.y = e.position.y;
            startMass = e.mass;
            
            var color = e.getColor();
            client.setColor({
                'r': color.r,
                'g': color.g,
                'b': color.b
            });
        }
    }

    if (client.cellColor && !this.gameMode.haveTeams) {
        var hex = String(client.cellColor).replace('#', '');
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            client.setColor({
                r: parseInt(hex.substr(0, 2), 16),
                g: parseInt(hex.substr(2, 2), 16),
                b: parseInt(hex.substr(4, 2), 16)
            });
        }
    }
    
    // Spawn player and add to world
    var cell = new Entity.PlayerCell(this.getNextNodeId(), client, pos, startMass);
    this.addNode(cell);
    
    // Set initial mouse coords
    client.mouse = {x: pos.x, y: pos.y};
}

GameServer.prototype.virusCheck = function() {
    // Checks if there are enough viruses on the map
    if (this.nodesVirus.length < this.config.virusMinAmount) {
        // Spawns a virus
        var pos = this.getRandomPosition();
        
        // Check for players (Experimental)
        for (var i = 0; i < this.nodesPlayer.length; i++) {
            var check = this.nodesPlayer[i];
            
            if (check.mass < this.config.virusStartMass) {
                continue;
            }
            
            var r = check.getSize(); // Radius of checking player cell
            
            // Collision box
            var topY = check.position.y - r;
            var bottomY = check.position.y + r;
            var leftX = check.position.x - r;
            var rightX = check.position.x + r;
            
            // Check for collisions
            if (pos.y > bottomY) {
                continue;
            } if (pos.y < topY) {
                continue;
            } if (pos.x > rightX) {
                continue;
            } if (pos.x < leftX) {
                continue;
            }
            
            // Collided
            return;
        }
        
        // Spawn if no cells are colliding
        var v = new Entity.Virus(this.getNextNodeId(), null, pos, this.config.virusStartMass);
        this.addNode(v);
    }
}

GameServer.prototype.consumeCellsInRange = function(cell, typeFilter) {
    var client = cell && cell.owner;
    if (!cell || !client) {
        return;
    }

    var list = this.getCellsInRange(cell);
    for (var j = 0; j < list.length; j++) {
        var check = list[j];
        if (!check || this.nodes.indexOf(check) == -1) {
            continue;
        }
        if (typeof typeFilter == "number" && check.getType() != typeFilter) {
            continue;
        }

        check.onConsume(cell, this);
        if (check.getType() == 1 || check.getType() == 3) {
            this.awardPlayerXp(client, Math.max(1, Math.floor(check.mass / 10)), 'eatmass');
        }

        check.setKiller(cell);
        this.removeNode(check);
    }
}

GameServer.prototype.updateMoveEngine = function() {
    // Move player cells
    var len = this.nodesPlayer.length;
    for (var i = 0; i < len; i++) {
        var cell = this.nodesPlayer[i];
            
        // Do not move cells that have collision turned off
        if ((!cell) || (cell.getCollision())){
            continue;
        }
            
        var client = cell.owner;
        
        // If cell's owner is offline, remove this cell
        if (!client.getStatus()) {
            this.removeNode(cell);
            continue;
        }

        if (this.gameMode && this.gameMode.name == "Tournament" && this.gameMode.gamePhase == 1) {
            continue;
        }
        
        cell.calcMove(client.mouse.x, client.mouse.y, this);
        this.consumeCellsInRange(cell);
    }
    // A system to move cells not controlled by players (ex. viruses, ejected mass)
    len = this.movingNodes.length;
    for (var i = 0; i < len; i++) {
        var check = this.movingNodes[i];
        
        // Recycle unused nodes
        while ((typeof check == "undefined") && (i < this.movingNodes.length)) {
            // Remove moving cells that are undefined
            this.movingNodes.splice(i, 1);
            check = this.movingNodes[i];
        } if (i >= this.movingNodes.length) {
            continue;
        }
        
        if (check.getMoveTicks() > 0) {
            // If the cell has enough move ticks, then move it
            check.calcMovePhys(this.config);
            if (check.getType() == 0 && check.owner) {
                this.consumeCellsInRange(check, 2);
            }
            if (check.getType() == 3) {
                // Check for viruses
                var v = this.getNearestVirus(check);
                if (v) { // Feeds the virus if it exists
                    v.feed(check,this);
                }
            }
        } else {
            // Auto move is done
            check.moveDone(this);
            // Remove cell from list
            var index = this.movingNodes.indexOf(check);
            if (index != -1) {
                this.movingNodes.splice(index, 1);
            }
        }
    }
}

GameServer.prototype.setAsMovingNode = function(node) {
    this.movingNodes.push(node);
}

GameServer.prototype.splitCells = function(client) {
    var splitCooldownMs = Number(this.config.playerSplitCooldownMs);
    if (isNaN(splitCooldownMs)) splitCooldownMs = 80;

    var now = Date.now();
    if (client.lastSplitTime && (now - client.lastSplitTime) < splitCooldownMs) {
        return;
    }
    client.lastSplitTime = now;

    var len = client.cells.length;

    for (var i = 0; i < len; i++) {
        if (client.cells.length >= this.config.playerMaxCells) continue;

        var cell = client.cells[i];
        if (!cell) continue;
        if (cell.mass < this.config.playerMinMassSplit) continue;

        var deltaY = client.mouse.y - cell.position.y;
        var deltaX = client.mouse.x - cell.position.x;
        var angle = Math.atan2(deltaX, deltaY);

        var newMass = cell.mass / 2;
        cell.mass = newMass;
        cell.calcMergeTime(this.config.playerRecombineTime);

        var size = cell.getSize();

        var startPos = {
            x: cell.position.x + ((size + this.config.ejectMass) * Math.sin(angle)),
            y: cell.position.y + ((size + this.config.ejectMass) * Math.cos(angle))
        };

        var split = new Entity.PlayerCell(this.getNextNodeId(), client, startPos, newMass);
        split.setAngle(angle);

        var splitSpeed = Number(this.config.playerSplitSpeedBase) + (cell.getSpeed() * Number(this.config.playerSplitSpeedMultiplier));
        var minSplitSpeed = Number(this.config.playerSplitMinSpeed);
        var maxSplitSpeed = Number(this.config.playerSplitMaxSpeed);
        var splitMoveTicks = Number(this.config.playerSplitMoveTicks);
        var splitDecay = Number(this.config.playerSplitDecay);
        if (isNaN(splitSpeed)) splitSpeed = 50 + (cell.getSpeed() * 5);
        if (!isNaN(minSplitSpeed)) splitSpeed = Math.max(splitSpeed, minSplitSpeed);
        if (!isNaN(maxSplitSpeed)) splitSpeed = Math.min(splitSpeed, maxSplitSpeed);
        if (isNaN(splitMoveTicks)) splitMoveTicks = 25;
        if (isNaN(splitDecay)) splitDecay = 0.75;

        split.setMoveEngineData(splitSpeed, splitMoveTicks, splitDecay);
        split.calcMergeTime(this.config.playerRecombineTime);
        split.firstSplit = true;

        setTimeout(function() {
            split.firstSplit = false;
        }, 1000);

        this.setAsMovingNode(split);
        this.addNode(split);
    }
};
GameServer.prototype.gainMass = function(client, size) {
    var len = client.cells.length;
    for (var i = 0; i < len; i++) {
        var cell = client.cells[i];
       cell.mass += 100;
      //  cell.recombineTicks = 0;
    }
}
GameServer.prototype.mergeCells = function(client, size) {
    var len = client.cells.length;
    for (var i = 0; i < len; i++) {
        var cell = client.cells[i];
     //  cell.mass += 100;
        cell.recombineTicks = 0;
    }
}
GameServer.prototype.ejectMass = function(client) {
    for (var i = 0; i < client.cells.length; i++) {
        var cell = client.cells[i];
        
        if (!cell) {
            continue;
        }
       
        if (cell.mass < this.config.playerMinMassEject) {
            continue;
        }
        
        var deltaY = client.mouse.y - cell.position.y;
        var deltaX = client.mouse.x - cell.position.x;
        var angle = Math.atan2(deltaX,deltaY);
    
        // Get starting position
        var size = cell.getSize() + 5;
        var startPos = {
            x: cell.position.x + ( (size + this.config.ejectMass) * Math.sin(angle) ), 
            y: cell.position.y + ( (size + this.config.ejectMass) * Math.cos(angle) )
        };
        
        // Remove mass from parent cell
        cell.mass -= this.config.ejectMass;
        
        // Randomize angle
        angle += (Math.random() * .5) - .25;
        
        // Create cell
       if(!this.config.ejectVirus) {
        ejected = new Entity.EjectedMass(this.getNextNodeId(), null, startPos, this.config.ejectMassGain);
       } else {
      ejected = new Entity.Virus(this.getNextNodeId(), null, startPos, this.config.ejectMassGain);
       }
        ejected.setAngle(angle);
        ejected.setMoveEngineData(this.config.ejectSpeed, 20);
        ejected.setColor(cell.getColor());
       
        // Add to moving cells list
        this.addNode(ejected);
        this.setAsMovingNode(ejected);
    }
}

GameServer.prototype.newCellVirused = function(client, parent, angle, mass, speed) {
    // Starting position
    var startPos = {
        x: parent.position.x, 
        y: parent.position.y
    };
    
    // Create cell
    newCell = new Entity.PlayerCell(this.getNextNodeId(), client, startPos, mass);
    newCell.setAngle(angle);
    newCell.setMoveEngineData(speed, 4);
    newCell.calcMergeTime(this.config.playerRecombineTime);
    newCell.setCollisionOff(true); // Turn off collision
    
    // Add to moving cells list
    this.addNode(newCell);
    this.setAsMovingNode(newCell);
}

GameServer.prototype.shootVirus = function(parent) {
    var parentPos = {
        x: parent.position.x,
        y: parent.position.y,
    };
    
    var newVirus = new Entity.Virus(this.getNextNodeId(), null, parentPos, this.config.virusStartMass);
    newVirus.setAngle(parent.getAngle());
    newVirus.setMoveEngineData(200, 20);
    
    // Add to moving cells list
    this.addNode(newVirus);
    this.setAsMovingNode(newVirus);
}

GameServer.prototype.getCellsInRange = function(cell) {
    var list = new Array();
    var r = cell.getSize(); // Get cell radius (Cell size = radius)
    
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
    
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all cells that are visible to the cell. There is probably a more efficient way of doing this but whatever
    var len = cell.owner.visibleNodes.length;
    for (var i = 0;i < len;i++) {
        var check = cell.owner.visibleNodes[i];
        
        if (typeof check === 'undefined') {
            continue;
        }

        if (check.owner && cell.owner && check.owner.gameServer != cell.owner.gameServer) {
            continue;
        }
        
        // Can't eat itself
        if (cell.nodeId == check.nodeId) {
            continue;
        }
        
        // Can't eat cells that have collision turned off
        if ((cell.owner == check.owner) && (cell.getCollision())) {
            continue;
        }
        
        // AABB Collision
        if (!check.collisionCheck(bottomY,topY,rightX,leftX)) {
            continue;
        }

        // Cell type check - Cell must be bigger than this number times the mass of the cell being eaten
        var multiplier = 1.25;
        
        switch (check.getType()) {
            case 1: // Food cell
                list.push(check);
                continue;
            case 2: // Virus
                multiplier = 1.33;
                break;
            case 0: // Players
                multiplier = check.owner == cell.owner ? 1.00 : multiplier;
                if (check.owner == cell.owner && (check.getRecombineTicks() > 0 || cell.getRecombineTicks() > 0)) {
                    continue;
                }
                // Can't eat team members
                if (this.gameMode.haveTeams) {
                    if (!check.owner) { // Error check
                        continue;
                    }
                    
                    if ((check.owner != cell.owner) && (check.owner.getTeam() == cell.owner.getTeam())) {
                        continue;
                    }
                }
        /*if(cell.firstSplit || cell.hasAte){
            continue;
        }*/
                break;
            default: 
                break;
        }
        
        // Make sure the cell is big enough to be eaten.
        if ((check.mass * multiplier) > cell.mass) {
            continue;
        }
                
        // Eating range
        var xs = Math.pow(check.position.x - cell.position.x, 2);
        var ys = Math.pow(check.position.y - cell.position.y, 2);
        var dist = Math.sqrt( xs + ys );
                
        var eatingRange = cell.getSize() - check.getEatingRange(); // Eating range = radius of eating cell + 1/3 of the radius of the cell being eaten
        if (dist > eatingRange) {
            // Not in eating range
            continue;
        }
        
        // Add to list of cells nearby
        list.push(check);
    }
    return list;
}

GameServer.prototype.getNearestVirus = function(cell) { 
    // More like getNearbyVirus
    var virus = null;
    var closestDist = Infinity;
    var r = Math.max(160, cell.getSize() + this.config.virusStartMass);
    
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
    
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all viruses on the map. There is probably a more efficient way of doing this but whatever
    var len = this.nodesVirus.length;
    for (var i = 0;i < len;i++) {
        var check = this.nodesVirus[i];
        
        if (typeof check === 'undefined') {
            continue;
        }
        
        if (!check.collisionCheck(bottomY,topY,rightX,leftX)) {
            continue;
        }

        var dist = Math.sqrt(Math.pow(check.position.x - cell.position.x, 2) + Math.pow(check.position.y - cell.position.y, 2));
        var feedRange = check.getSize() + cell.getSize() + 40;
        if (dist > feedRange || dist >= closestDist) {
            continue;
        }

        closestDist = dist;
        virus = check;
    }
    return virus;
}

GameServer.prototype.updateCells = function() {
    var massDecay = 1 - ((this.config.playerMassDecayRate/1000) * this.gameMode.decayMod);
    for (var i = 0; i < this.nodesPlayer.length; i++) {
        var cell = this.nodesPlayer[i];
        
        if (!cell) {
            continue;
        }
        
        // Recombining
        if (cell.getRecombineTicks() > 0) {
            cell.setRecombineTicks(cell.getRecombineTicks() - 1);
        }
        
        // Mass decay
        if (cell.mass >= this.config.playerMinMassDecay) {
            cell.mass *= massDecay;
        }
    }
}

GameServer.prototype.loadConfig = function() {
    var configPath = path.join(__dirname, 'gameserver.ini');
    var defaultConfig = this.config;

    try {
        var loadedConfig = ini.parse(fs.readFileSync(configPath, 'utf-8'));
        for (var key in loadedConfig) {
            defaultConfig[key] = loadedConfig[key];
        }
        this.config = defaultConfig;
    } catch (err) {
        // No config
        console.log("[Game] Config not found... Generating new config");
        
        // Create a new config
        fs.writeFileSync(configPath, ini.stringify(this.config));
    }
}

// Custom prototype functions
WebSocket.prototype.sendPacket = function(packet) {
    function getbuf(data) {
        var array = new Uint8Array(data.buffer || data);
        var l = data.byteLength || data.length;
        var o = data.byteOffset || 0;
        var buffer = Buffer.alloc(l);

        for (var i = 0; i < l; i++) {
            buffer[i] = array[o + i];
        }

        return buffer;
    }

    if (this.readyState == WebSocket.OPEN && packet.build) {
        var buf = packet.build();
        this.send(getbuf(buf), { binary: true });
    }
}
