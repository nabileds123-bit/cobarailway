var Mode = require('./Mode');

function Hardcore() {
    Mode.apply(this, Array.prototype.slice.call(arguments));
	
    this.ID = 2;
    this.name = "Hardcore";
}

module.exports = Hardcore;
Hardcore.prototype = new Mode();

// Gamemode Specific Functions

Hardcore.prototype.leaderboardAddSort = function(player,leaderboard) {
    // Adds the player and sorts the leaderboard
    var len = leaderboard.length - 1;
    var loop = true;
    while ((len >= 0) && (loop)) {
        // Start from the bottom of the leaderboard
        if (player.getScore(false) <= leaderboard[len].getScore(false)) {
            leaderboard.splice(len + 1, 0, player);
            loop = false; // End the loop if a spot is found
        }
        len--;
    }
    if (loop) {
        // Add to top of the list because no spots were found
        leaderboard.splice(0, 0,player);
    }
}

// Override

Hardcore.prototype.updateLB = function(gameServer) {
	var players = [];

	for (var i = 0; i < gameServer.clients.length; i++) {
        if (typeof gameServer.clients[i] == "undefined") {
            continue;
        }

        var player = gameServer.clients[i].playerTracker;
        if (player.cells.length <= 0) {
            continue;
        }

        player.getScore(true);
        players.push(player);
    }

    players.sort(function(a, b) {
        return b.getScore(false) - a.getScore(false);
    });

    gameServer.leaderboard = players.slice(0, gameServer.config.gameLBlength);
	this.rankOne = gameServer.leaderboard[0];
}

