var Packet = require('./packet');
var GameServer = require('./GameServer');

function PlayerTracker(gameServer, socket) {
    this.isOnline = true;
    this.name = "";
    this.gameServer = gameServer;
    this.socket = socket;
    this.nodeDestroyQueue = [];
    this.visibleNodes = [];
    this.cells = [];
    this.score = 1; // Needed for leaderboard
    this.authUserId = null;
    this.authUsername = null;
    this.accountType = 'Guest';
    this.adminRole = '';
    this.accountPoints = 0;
    this.guildTag = '';
    this.fakeGuildPrefixRenderBug = false;
    this.skinUrl = null;
    this.cellColor = null;
    this.lastPassiveXpTime = Date.now();
    this.battleMode = '1v1';
    this.battlePointSettled = false;
    this.battleState = 'idle';
    this.battleTeam = null;
    this.battleType = '1v1';
    this.currentMode = gameServer && gameServer.roomName ? gameServer.roomName : '';
    this.currentRoom = gameServer || null;
    this.matchId = null;
    this.lastSplitTime = 0;
    this.lastEjectTime = 0;
    this.ejectDebugStats = {};

    this.mouse = {x: 0, y: 0};
    this.tickLeaderboard = 0; // 
    this.tickViewBox = 0;
    this.forceViewUpdate = false; // Flag untuk force visible update saat virus/split
    this.forceInjectNodes = []; // Cell baru dari virus split yang harus langsung visible
    
    this.team = 0;
    this.spectate = false;
    this.spectatedPlayer; // Current player that this player is watching
    
    // Viewing box
    this.sightRange = 0;
    this.centerPos = {x: 0, y: 0 }
    this.viewBox = {
        topY: 0,
        bottomY: 0,
        leftX: 0,
        rightX: 0,
        width: 0 // Half-width
    }
    
    // Gamemode function
    if (gameServer) {
        this.color = gameServer.getRandomColor(); // Get color
        gameServer.gameMode.onPlayerInit(this);
    }
}

module.exports = PlayerTracker;

PlayerTracker.prototype.trackEjectPacket = function(sourceName, accepted, now) {
    if (!this.gameServer || !this.gameServer.config.playerEjectDebugLog) {
        return;
    }

    var source = sourceName || 'Feed';
    var stats = this.ejectDebugStats[source];
    if (!stats) {
        stats = this.ejectDebugStats[source] = {
            startedAt: now,
            packets: 0,
            ejects: 0
        };
    }

    stats.packets++;
    if (accepted) {
        stats.ejects++;
    }

    if (now - stats.startedAt >= 1000) {
        var seconds = Math.max((now - stats.startedAt) / 1000, 1);
        var name = this.getName ? this.getName() : this.name;
        console.log(
            "[FeedDebug]",
            source + ":",
            Math.round(stats.ejects / seconds) + " eject/sec,",
            Math.round(stats.packets / seconds) + " packet/sec,",
            "player=" + (name || "unknown")
        );
        stats.startedAt = now;
        stats.packets = 0;
        stats.ejects = 0;
    }
};

// Setters/Getters

PlayerTracker.prototype.setStatus = function(bool) {
    this.isOnline = bool;
}

PlayerTracker.prototype.getStatus = function() {
    return this.isOnline;
}

PlayerTracker.prototype.setName = function(name) {
    this.name = name;
}

PlayerTracker.prototype.getName = function() {
    return this.name;
}

PlayerTracker.prototype.getGuildTag = function() {
    return String(this.guildTag || '').trim().toUpperCase();
}

PlayerTracker.prototype.getDisplayName = function() {
    var name = this.authUsername || this.getName() || "";
    var guildTag = this.getGuildTag();

    if (!name) {
        return "";
    }

    return guildTag ? "[" + guildTag + "] " + name : name;
}

PlayerTracker.prototype.getCellDisplayName = function() {
    var name = this.authUsername || this.getName() || "";
    var guildTag = this.getGuildTag();

    if (!name) {
        return "";
    }

    if (this.fakeGuildPrefixRenderBug) {
        return name;
    }

    return guildTag ? "[" + guildTag + "] " + name : name;
}

PlayerTracker.prototype.getScore = function(reCalcScore) {
    if (reCalcScore) {
        var s = 0;
        for (var i = 0; i < this.cells.length; i++) {
            s += this.cells[i].mass;
        }
        this.score = s;
    }
    return this.score;
}

PlayerTracker.prototype.setColor = function(color) {
    this.color.r = color.r;
    this.color.b = color.b;
    this.color.g = color.g;
}

PlayerTracker.prototype.getTeam = function() {
    return this.team;
}

// Functions

PlayerTracker.prototype.update = function() {
    this.updatePassiveXp();

	// Actions buffer
    if (this.socket.packetHandler.pressSpace) {
        // Split cell
        this.gameServer.splitCells(this);
        this.socket.packetHandler.pressSpace = false;
    }
	  if (this.socket.packetHandler.massSize ) {
        // Split cell
        this.gameServer.gainMass(this);
        this.socket.packetHandler.massSize = false;
    }
	 if (this.socket.packetHandler.merg ) {
        // Split cell
        this.gameServer.mergeCells(this);
        this.socket.packetHandler.merg = false;
    }
	// Remove nodes from visible nodes if possible
    for (var i = 0; i < this.nodeDestroyQueue.length; i++) {
        var index = this.visibleNodes.indexOf(this.nodeDestroyQueue[i]);
        if (index > -1) {
            this.visibleNodes.splice(index, 1);
        }
    }

    // Get visible nodes
    var nonVisibleNodes = [];
    if (this.tickViewBox <= 0 || this.forceViewUpdate) {
        var newVisible = this.calcViewBox();

        // Merge: pastikan cell yang di-inject manual (forceInject) tidak hilang
        if (this.forceViewUpdate && this.forceInjectNodes && this.forceInjectNodes.length > 0) {
            for (var fi = 0; fi < this.forceInjectNodes.length; fi++) {
                var fn = this.forceInjectNodes[fi];
                if (fn && newVisible.indexOf(fn) == -1) {
                    newVisible.push(fn);
                }
            }
            this.forceInjectNodes = [];
        }

        // Nodes yang tidak terlihat lagi
        for (var i = 0; i < this.visibleNodes.length; i++) {
            if (newVisible.indexOf(this.visibleNodes[i]) == -1) {
                nonVisibleNodes.push(this.visibleNodes[i]);
            }
        }

        this.visibleNodes = newVisible;
        this.forceViewUpdate = false;
        this.tickViewBox = 4;
    } else {
        this.tickViewBox--;
    }

    // Send packet
    this.socket.sendPacket(new Packet.UpdateNodes(this.nodeDestroyQueue.slice(0), this.visibleNodes, nonVisibleNodes));

    this.nodeDestroyQueue = []; // Reset destroy queue

    // Update leaderboard
    if (this.tickLeaderboard <= 0) {
        this.socket.sendPacket(new Packet.UpdateLeaderboard(this.gameServer.leaderboard,this.gameServer.gameMode.packetLB));
        this.tickLeaderboard = this.gameServer.config.leaderboardUpdateClient;
    } else {
        this.tickLeaderboard--;
    }
    
}

PlayerTracker.prototype.updatePassiveXp = function() {
    if (!this.authUserId) {
        return;
    }

    var now = Date.now();
    if ((now - this.lastPassiveXpTime) < 120000) {
        return;
    }

    this.lastPassiveXpTime = now;
    this.gameServer.awardPlayerXp(this, 1, '2min-online');
}

// Viewing box

PlayerTracker.prototype.updateSightRange = function() { // For view distance
    var totalSize = 1.0;
    var len = this.cells.length;
    
    for (var i = 0; i < len;i++) {
    	
        if (!this.cells[i]) {
            continue;
        }
    	
        totalSize += this.cells[i].getSize();
    }
    this.sightRange = this.gameServer.config.serverViewBase / Math.pow(Math.min(64.0 / totalSize, 1), 0.4);
}

PlayerTracker.prototype.updateCenter = function() { // Get center of cells
	var len = this.cells.length;
	
    if (len <= 0) {
        return; // End the function if no cells exsist
    }
    
    var X = 0;
    var Y = 0;
    for (var i = 0; i < len ;i++) {
    	
        if (!this.cells[i]) {
            continue;
        }
    	
        X += this.cells[i].position.x;
        Y += this.cells[i].position.y;
    }
    
    this.centerPos.x = X / len >> 0;
    this.centerPos.y = Y / len >> 0;
}

PlayerTracker.prototype.calcViewBox = function() {
    if (this.spectate) {
        // Spectate mode
        this.spectatedPlayer = this.gameServer.gameMode.rankOne;
        if (this.spectatedPlayer) {
            // Get spectated player's location and calculate zoom amount
            var specZoom = Math.sqrt(100 * this.spectatedPlayer.score);
            specZoom = Math.pow(Math.min(40.5 / specZoom, 1.0), 0.4) * 0.75;
            this.socket.sendPacket(new Packet.UpdatePosition(this.spectatedPlayer.centerPos.x,this.spectatedPlayer.centerPos.y,specZoom));
            return this.spectatedPlayer.visibleNodes;
        } else {
            var specCenter = {
                x: (this.gameServer.config.borderLeft + this.gameServer.config.borderRight) / 2,
                y: (this.gameServer.config.borderTop + this.gameServer.config.borderBottom) / 2
            };
            var specRange = this.gameServer.config.serverViewBase;
            var specViewBox = {
                topY: specCenter.y - specRange,
                bottomY: specCenter.y + specRange,
                leftX: specCenter.x - specRange,
                rightX: specCenter.x + specRange,
                width: specRange
            };
            var specVisible = [];
            this.socket.sendPacket(new Packet.UpdatePosition(specCenter.x,specCenter.y,1));
            for (var specIndex = 0; specIndex < this.gameServer.nodes.length; specIndex++) {
                var specNode = this.gameServer.nodes[specIndex];
                if (specNode && specNode.visibleCheck(specViewBox,specCenter)) {
                    specVisible.push(specNode);
                }
            }
            return specVisible;
        }
    }
		
    // Main function
    this.updateSightRange();
    this.updateCenter();
	
    // Box
    this.viewBox.topY = this.centerPos.y - this.sightRange;
    this.viewBox.bottomY = this.centerPos.y + this.sightRange;
    this.viewBox.leftX = this.centerPos.x - this.sightRange;
    this.viewBox.rightX = this.centerPos.x + this.sightRange;
    this.viewBox.width = this.sightRange;
	
    var newVisible = [];
    for (var i = 0; i < this.gameServer.nodes.length ;i++) {
        node = this.gameServer.nodes[i];
		
        if (!node) {
            continue;
        }
		
        if (node.visibleCheck(this.viewBox,this.centerPos)) {
            // Cell is in range of viewBox
            newVisible.push(node);
        }
    }
    return newVisible;
}
