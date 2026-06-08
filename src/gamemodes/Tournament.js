var Mode = require('./Mode');

function Tournament() {
    Mode.apply(this, Array.prototype.slice.call(arguments));

    this.ID = 10;
    this.name = "Tournament";
    this.packetLB = 48;

    // Config (1 tick = 1000 ms)
    this.prepTime = 5; // Amount of ticks after the server fills up to wait until starting the game
    this.endTime = 15; // Amount of ticks after someone wins to restart the game
    this.autoFill = false;
    this.autoFillPlayers = 1;
    this.dcTime = 0;

    // Gamemode Specific Variables
    this.gamePhase = 0; // 0 = Waiting for players, 1 = Prepare to start, 2 = Game in progress, 3 = End
    this.contenders = [];
    this.matchPlayers = [];
    this.maxContenders = 12;
    this.battleMode = '1v1';
    this.rewardPoints = 1.5;
    this.defeatPenalty = 0.7;

    this.winner;
    this.timer = 0;
    this.timerEndsAt = 0;
    this.phaseEndsAt = 0;
    this.timeLimit = 3600; // in seconds

    this.currentRound = 1;
    this.maxRounds = 3;
    this.winsToMatch = 2;
    this.roundWins = {};
    this.playerWins = {};
    this.teamWins = {};
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchWinnerKey = null;
}

module.exports = Tournament;
Tournament.prototype = new Mode();

// Gamemode Specific Functions

Tournament.prototype.startGamePrep = function(gameServer) {
    this.gamePhase = 1;
    this.timer = this.toSafeNumber(this.prepTime, 5);
    this.timerEndsAt = Date.now() + this.timer * 1000;
    console.log("[PHASE]", this.gamePhase);
    console.log("[ROUND]", this.currentRound);
};

Tournament.prototype.startGame = function(gameServer) {
    gameServer.run = true;
    this.gamePhase = 2;
    this.roundWinner = null;
    this.getSpectate(); // Gets a random person to spectate
    gameServer.config.playerDisconnectTime = this.dcTime; // Reset config
    console.log("[PHASE]", this.gamePhase);
    console.log("[ROUND]", this.currentRound);
};

Tournament.prototype.endGame = function(gameServer) {
    this.endRound(gameServer, this.contenders[0]);
};

Tournament.prototype.endGameTimeout = function(gameServer) {
    gameServer.run = false;
    this.gamePhase = 4;
    this.timer = this.endTime; // 30 Seconds
};

Tournament.prototype.fillBots = function(gameServer) {
    // Fills the server with bots if there arent enough players
    var fill = this.maxContenders - this.contenders.length;
    for (var i = 0;i < fill;i++) {
        gameServer.bots.addBot();
    }
};

Tournament.prototype.getSpectate = function() {
    // Finds a random person to spectate
    var index = Math.floor(Math.random() * this.contenders.length);
    this.rankOne = this.contenders[index];
};

Tournament.prototype.prepare = function(gameServer) {
    console.log("[PREPARE_CALLED]");
    if (this.gamePhase === 2) {
        console.log("[BLOCKED_PREPARE_DURING_ACTIVE_ROUND]");
        return;
    }

    // Remove all cells
    var len = gameServer.nodes.length;
    for (var i = 0; i < len; i++) {
        var node = gameServer.nodes[0];

        if (!node) {
            continue;
        }

        gameServer.removeNode(node);
    }

    gameServer.bots.loadNames();

    // Pauses the server
    gameServer.run = false;
    this.gamePhase = 0;
    this.contenders = [];
    this.matchPlayers = [];
    this.battleMode = '1v1';
    this.rewardPoints = 1.5;
    this.defeatPenalty = 0.7;
    this.currentRound = 1;
    this.maxRounds = 3;
    this.winsToMatch = 2;
    this.roundWins = {};
    this.playerWins = {};
    this.teamWins = {};
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchWinnerKey = null;

    // Get config values
    if (gameServer.config.tourneyAutoFill > 0) {
        this.timer = gameServer.config.tourneyAutoFill;
        this.autoFill = true;
        this.autoFillPlayers = gameServer.config.tourneyAutoFillPlayers;
    }
    // Handles disconnections
    this.dcTime = gameServer.config.playerDisconnectTime;
    gameServer.config.playerDisconnectTime = 0;
    gameServer.config.playerMinMassDecay = gameServer.config.playerStartMass;

    this.prepTime = gameServer.config.tourneyPrepTime;
    this.endTime = gameServer.config.tourneyEndTime;
    this.maxContenders = gameServer.config.tourneyMaxPlayers;
    this.prepTime = this.toSafeNumber(this.prepTime, 5);
    this.endTime = this.toSafeNumber(this.endTime, 15);
    this.maxContenders = this.toSafeNumber(this.maxContenders, 12);
    if (gameServer.battleType) {
        this.battleMode = gameServer.battleType == '2v2' ? '2v2' : '1v1';
        this.applyBattleSettings();
    }
    this.timer = this.toSafeNumber(this.timer, 0);
    this.timerEndsAt = 0;
    this.phaseEndsAt = 0;

    // Time limit
    this.timeLimit = this.toSafeNumber(gameServer.config.tourneyTimeLimit, 60) * 60; // in seconds
};

Tournament.prototype.toSafeNumber = function(value, fallback) {
    value = Number(value);
    return isNaN(value) ? fallback : value;
};

Tournament.prototype.getCountdownSeconds = function(fallback) {
    if (!this.timerEndsAt) {
        return this.toSafeNumber(fallback, 0);
    }

    return Math.max(0, Math.ceil((this.timerEndsAt - Date.now()) / 1000));
};

Tournament.prototype.getPhaseCountdownSeconds = function(fallback) {
    if (!this.phaseEndsAt) {
        return this.toSafeNumber(fallback, 0);
    }

    return Math.max(0, Math.ceil((this.phaseEndsAt - Date.now()) / 1000));
};

Tournament.prototype.onPlayerDeath = function(gameServer) {
    // Nothing
}

Tournament.prototype.configureBattle = function(player) {
    this.battleMode = player && player.battleMode == '2v2' ? '2v2' : '1v1';
    this.applyBattleSettings();
};

Tournament.prototype.applyBattleSettings = function() {
    this.maxContenders = this.battleMode == '2v2' ? 4 : 2;
    this.rewardPoints = this.battleMode == '2v2' ? 3 : 1.5;
    this.defeatPenalty = this.battleMode == '2v2' ? 1.4 : 0.7;
};

Tournament.prototype.settleDefeat = function(gameServer, player) {
    if (!player || player.battlePointSettled || this.gamePhase != 2) {
        return;
    }

    player.battlePointSettled = true;
    gameServer.adjustPlayerPoints(player, -this.defeatPenalty, 'battle-defeat-' + this.battleMode);
};

Tournament.prototype.awardWinner = function(gameServer, player) {
    if (!player || player.battlePointSettled || this.gamePhase != 2) {
        return;
    }

    player.battlePointSettled = true;
    gameServer.adjustPlayerPoints(player, this.rewardPoints, 'battle-win-' + this.battleMode);
};

Tournament.prototype.restartMatch = function(gameServer) {
    console.log("[RESTART_MATCH_CALLED]");
    if (this.gamePhase != 3 && this.gamePhase != 4) {
        return;
    }

    if (gameServer && gameServer.battleFinished) {
        return;
    }

    if (this.matchWinner && gameServer && gameServer.finishBattleMatch) {
        gameServer.finishBattleMatch();
        return;
    }

    this.onServerInit(gameServer);
    for (var i = 0; i < gameServer.config.foodStartAmount; i++) {
        gameServer.spawnFood();
    }
};

Tournament.prototype.getPlayerWinKey = function(player) {
    if (!player) {
        return "";
    }

    if (this.battleMode == '2v2') {
        return 'team:' + (player.battleTeam || 'A');
    }

    return 'player:' + (player.authUserId || player.getName && player.getName() || this.matchPlayers.indexOf(player));
};

Tournament.prototype.getPlayerWinName = function(player) {
    if (!player) {
        return "No winner";
    }

    if (this.battleMode == '2v2') {
        return "Team " + (player.battleTeam || 'A');
    }

    if (player.getDisplayName) {
        return player.getDisplayName() || "No name";
    }

    return player.getName ? (player.getName() || "No name") : "No name";
};

Tournament.prototype.getWinNameByKey = function(key) {
    if (String(key || '').indexOf('team:') === 0) {
        return "Team " + String(key).split(':')[1];
    }

    for (var i = 0; i < this.matchPlayers.length; i++) {
        if (this.getPlayerWinKey(this.matchPlayers[i]) == key) {
            return this.getPlayerWinName(this.matchPlayers[i]);
        }
    }

    return "No winner";
};

Tournament.prototype.getWinObject = function(key, fallbackPlayer) {
    var self = this;
    return {
        battleWinKey: key,
        player: fallbackPlayer || null,
        getName: function() {
            return self.getWinNameByKey(key);
        }
    };
};

Tournament.prototype.getAliveContenders = function() {
    var alive = [];
    for (var i = 0; i < this.contenders.length; i++) {
        if (this.contenders[i] && this.contenders[i].cells && this.contenders[i].cells.length > 0) {
            alive.push(this.contenders[i]);
        }
    }
    return alive;
};

Tournament.prototype.getRoundWinnerFromAlive = function() {
    var alive = this.getAliveContenders();
    if (alive.length < 1) {
        return null;
    }

    if (this.battleMode != '2v2') {
        return alive.length == 1 ? alive[0] : null;
    }

    var team = alive[0].battleTeam;
    for (var i = 1; i < alive.length; i++) {
        if (alive[i].battleTeam != team) {
            return null;
        }
    }

    return alive[0];
};

Tournament.prototype.recordRoundWin = function(winner) {
    var key = winner && winner.battleWinKey ? winner.battleWinKey : this.getPlayerWinKey(winner);
    if (!key) {
        return null;
    }

    if (!this.roundWins[key]) {
        this.roundWins[key] = 0;
    }
    this.roundWins[key]++;
    if (String(key).indexOf('team:') === 0) {
        this.teamWins[key] = this.roundWins[key];
    } else {
        this.playerWins[key] = this.roundWins[key];
    }
    return key;
};

Tournament.prototype.hasMatchWinner = function(key) {
    return key && this.roundWins[key] >= this.winsToMatch;
};

Tournament.prototype.awardMatchResult = function(gameServer, winnerKey) {
    if (!winnerKey || !gameServer || !gameServer.adjustPlayerPoints) {
        return;
    }

    for (var i = 0; i < this.matchPlayers.length; i++) {
        var player = this.matchPlayers[i];
        if (!player) {
            continue;
        }

        var reason = this.getPlayerWinKey(player) == winnerKey ? 'battle-win-' : 'battle-defeat-';
        var amount = this.getPlayerWinKey(player) == winnerKey ? this.rewardPoints : -this.defeatPenalty;
        gameServer.adjustPlayerPoints(player, amount, reason + this.battleMode);
    }
};

Tournament.prototype.endMatchFinal = function(gameServer, winner, winnerKey) {
    this.matchWinnerKey = winnerKey;
    this.matchWinner = this.getWinObject(winnerKey, winner);
    this.winner = this.matchWinner;
    this.rankOne = winner || this.rankOne;
    this.awardMatchResult(gameServer, winnerKey);
    console.log("[MATCH_WINNER]", this.matchWinner && this.matchWinner.getName());
};

Tournament.prototype.endRound = function(gameServer, winner) {
    if (this.gamePhase != 2) {
        return;
    }

    var winnerKey = this.recordRoundWin(winner);
    this.roundWinner = this.getWinObject(winnerKey, winner);
    this.winner = this.roundWinner;
    this.rankOne = winner || this.rankOne;
    this.gamePhase = 3;
    this.timer = this.toSafeNumber(this.endTime, 15);
    this.phaseEndsAt = Date.now() + this.timer * 1000;

    console.log("[PHASE]", this.gamePhase);
    console.log("[ROUND]", this.currentRound);
    console.log("[ROUND_WINNER]", this.roundWinner && this.roundWinner.getName());

    if (this.hasMatchWinner(winnerKey) || this.currentRound >= this.maxRounds) {
        this.endMatchFinal(gameServer, winner, winnerKey);
    }
};

Tournament.prototype.clearRoundNodes = function(gameServer) {
    var len = gameServer.nodes.length;
    for (var i = 0; i < len; i++) {
        var node = gameServer.nodes[0];
        if (!node) {
            continue;
        }

        gameServer.removeNode(node);
    }

    gameServer.nodes.length = 0;
    gameServer.nodesPlayer.length = 0;
    gameServer.nodesVirus.length = 0;
    gameServer.nodesEjected.length = 0;
    gameServer.movingNodes.length = 0;
    gameServer.currentFood = 0;
    gameServer.leaderboard.length = 0;
};

Tournament.prototype.startNextRound = function(gameServer) {
    console.log("[START_NEXT_ROUND]");
    this.currentRound++;
    this.roundWinner = null;
    this.winner = null;
    this.phaseEndsAt = 0;
    this.timerEndsAt = 0;
    this.timeLimit = this.toSafeNumber(gameServer.config.tourneyTimeLimit, 60) * 60;
    this.clearRoundNodes(gameServer);

    for (var foodIndex = 0; foodIndex < gameServer.config.foodStartAmount; foodIndex++) {
        gameServer.spawnFood();
    }

    this.contenders = [];
    for (var i = 0; i < this.matchPlayers.length; i++) {
        var player = this.matchPlayers[i];
        if (!player || player.gameServer != gameServer) {
            continue;
        }

        player.spectate = false;
        player.battleState = 'in_match';
        player.battlePointSettled = false;
        player.visibleNodes = [];
        player.nodeDestroyQueue = [];
        this.contenders.push(player);
        if (player.socket && player.socket.sendPacket) {
            var Packet = require('../packet');
            player.socket.sendPacket(new Packet.ClearNodes());
            player.socket.sendPacket(new Packet.SetBorder(gameServer.config.borderLeft, gameServer.config.borderRight, gameServer.config.borderTop, gameServer.config.borderBottom));
        }
        gameServer.spawnPlayer(player);
    }

    this.startGamePrep(gameServer);
};

Tournament.prototype.formatTime = function(time) {
    if (time < 0) {
        return "0:00";
    }
    // Format
    var min = Math.floor(this.timeLimit/60);
    var sec = this.timeLimit%60;
    sec = (sec > 9) ? sec : "0" + sec.toString() ; 
    return min+":"+sec;
}

Tournament.prototype.getScoreText = function() {
    var scores = [];
    var seen = {};

    for (var i = 0; i < this.matchPlayers.length; i++) {
        var player = this.matchPlayers[i];
        var key = this.getPlayerWinKey(player);
        if (!key || seen[key]) {
            continue;
        }

        seen[key] = true;
        scores.push(this.getWinNameByKey(key) + " " + (this.roundWins[key] || 0));
    }

    return scores.join(" - ") || "0 - 0";
};

Tournament.prototype.getScoreRows = function() {
    var rows = [];
    var seen = {};

    for (var i = 0; i < this.matchPlayers.length; i++) {
        var player = this.matchPlayers[i];
        var key = this.getPlayerWinKey(player);
        if (!key || seen[key]) {
            continue;
        }

        seen[key] = true;
        rows.push(this.getWinNameByKey(key) + " - " + (this.roundWins[key] || 0));
    }

    while (rows.length < (this.battleMode == '2v2' ? 2 : this.maxContenders)) {
        rows.push((this.battleMode == '2v2' ? "Team " + (rows.length ? "B" : "A") : "Waiting") + " - 0");
    }

    return rows.slice(0, this.battleMode == '2v2' ? 2 : this.maxContenders);
};

Tournament.prototype.getScoreLine = function() {
    var scores = [];
    var rows = this.getScoreRows();
    for (var i = 0; i < rows.length; i++) {
        var parts = rows[i].split(" - ");
        scores.push(parts[parts.length - 1] || "0");
    }
    return scores.join(" - ") || "0 - 0";
};

Tournament.prototype.getAliveCount = function() {
    return this.getAliveContenders().length;
};

Tournament.prototype.getSpectatorCount = function(gameServer) {
    var count = 0;
    var clients = gameServer && gameServer.clients ? gameServer.clients : [];
    for (var i = 0; i < clients.length; i++) {
        var player = clients[i] && clients[i].playerTracker;
        if (!player || player.gameServer != gameServer) {
            continue;
        }

        if (this.contenders.indexOf(player) != -1 && player.cells && player.cells.length > 0) {
            continue;
        }

        if (player.spectate || player.battleState == 'spectating' || this.matchPlayers.indexOf(player) == -1) {
            count++;
        }
    }
    return count;
};

Tournament.prototype.writeBattleBaseLeaderboard = function(gameServer, lb) {
    var alive = this.getAliveCount();
    var maxPlayers = this.maxContenders;
    var rows = this.getScoreRows();

    lb.push("__BATTLE_LB__");
    lb.push("title|Leaderboard");
    lb.push("label|Players Remaining");
    lb.push("alive|" + alive + "|" + maxPlayers);
    lb.push("sep");
    lb.push("round|Round: " + this.currentRound);
    for (var i = 0; i < rows.length; i++) {
        lb.push("score|" + rows[i]);
    }
    lb.push("sep");
    lb.push("spectators|Spectators: " + this.getSpectatorCount(gameServer));
};

Tournament.prototype.writeActiveLeaderboard = function(gameServer, lb) {
    this.writeBattleBaseLeaderboard(gameServer, lb);
};

// Override

Tournament.prototype.onServerInit = function(gameServer) {
    this.prepare(gameServer);
};

Tournament.prototype.onPlayerSpawn = function(gameServer,player) {
    // Only spawn players if the game hasnt started yet
    if ((this.gamePhase == 0) && (this.contenders.length < this.maxContenders)) {
        if (this.contenders.length == 0) {
            this.configureBattle(player);
        }

        player.color = gameServer.getRandomColor(); // Random color
        player.battlePointSettled = false;
        this.contenders.push(player); // Add to contenders list
        this.matchPlayers.push(player);
        gameServer.spawnPlayer(player);

        if (this.contenders.length == this.maxContenders) {
            // Start the game once there is enough players
            this.startGamePrep(gameServer);
        }
    }
};

Tournament.prototype.onCellRemove = function(cell) {
    var owner = cell.owner,
        human_just_died = false;

    if (owner.cells.length <= 0) {
        if (this.gamePhase != 2) {
            return;
        }

        if (this.gamePhase == 2) {
            owner.spectate = true;
            owner.battleState = 'spectating';
        }

        // Remove from contenders list
        var index = this.contenders.indexOf(owner);
        if (index != -1) {
            if ('_socket' in this.contenders[index].socket) {
                human_just_died = true;
            }
            this.contenders.splice(index,1);
        }

        // Victory conditions
        var humans = 0;
        for (var i = 0; i < this.contenders.length; i++) {
            if ('_socket' in this.contenders[i].socket) {
                humans++;
            }
        }

        // the game is over if:
        // 1) there is only 1 player left, OR
        // 2) all the humans are dead, OR
        // 3) the last-but-one human just died
        var roundWinner = this.getRoundWinnerFromAlive();
        if ((roundWinner || humans == 0 || (humans == 1 && human_just_died)) && this.gamePhase == 2) {
            this.endRound(cell.owner.gameServer, roundWinner);
        } else {
            // Do stuff
            this.onPlayerDeath(cell.owner.gameServer);
        }
    }
};

Tournament.prototype.updateLB = function(gameServer) {
    var lb = gameServer.leaderboard;
    lb.length = 0;
    if (gameServer.battleFinished) {
        return;
    }

    switch (this.gamePhase) {
        case 0:
            lb.push("__BATTLE_LB__");
            lb.push("title|Leaderboard");
            lb.push("label|Players Remaining");
            lb.push("alive|" + this.getAliveCount() + "|" + this.maxContenders);
            lb.push("sep");
            lb.push("round|Waiting for players");
            lb.push("countdown|" + this.contenders.length + "/" + this.maxContenders);
            lb.push("sep");
            lb.push("spectators|Spectators: " + this.getSpectatorCount(gameServer));
            if (this.autoFill) {
                if (this.timer <= 0) {
                    this.fillBots(gameServer);
                } else if (this.contenders.length >= this.autoFillPlayers) {
                    this.timer--;
                }
            }
            break;
        case 1:
            this.timer = this.getCountdownSeconds(this.prepTime);
            this.writeBattleBaseLeaderboard(gameServer, lb);
            lb.splice(lb.length - 2, 0, "countdown|Starting In", "countdownNumber|" + this.timer.toString());
            if (this.timer <= 0) {
                this.startGame(gameServer);
                lb.length = 0;
                this.writeBattleBaseLeaderboard(gameServer, lb);
                lb.splice(lb.length - 2, 0, "countdown|Fight!");
            }
            break;
        case 2:
            this.writeActiveLeaderboard(gameServer, lb);
            if (this.timeLimit < 0) {
                // Timed out
                this.endGameTimeout(gameServer);
            } else {
                this.timeLimit--;
            }
            break;
        case 3:
            this.timer = this.getPhaseCountdownSeconds(this.endTime);
            if (this.matchWinner) {
                lb.push("__BATTLE_LB__");
                lb.push("winnerTitle|Winner");
                lb.push("winnerName|" + this.getPlayerWinName(this.matchWinner));
                lb.push("winnerScore|" + this.getScoreLine());
                lb.push("sep");
                lb.push("countdown|Next Match In");
                lb.push("countdownNumber|" + this.timer.toString());
                if (this.timer <= 0) {
                    this.restartMatch(gameServer);
                }
            } else {
                this.writeBattleBaseLeaderboard(gameServer, lb);
                lb.splice(lb.length - 2, 0, "countdown|Next Round In", "countdownNumber|" + this.timer.toString());
                if (this.timer <= 0) {
                    this.startNextRound(gameServer);
                }
            }
            break;
        case 4:
            lb[0] = "Time Limit"; 
            lb[1] = "Reached!";
            this.timer = this.toSafeNumber(this.timer, this.endTime);
            if (this.timer <= 0) {
                // Reset the game
                this.restartMatch(gameServer);
            } else {
                lb[2] = "Game restarting in";
                lb[3] = this.timer.toString();
                this.timer--;
            }
        default:
            break;
    }
};
