var Mode = require('./Mode');

function FFA() {
    Mode.apply(this, Array.prototype.slice.call(arguments));

    this.ID = 0;
    this.name = "Free For All";
    this.specByLeaderboard = true;
}

module.exports = FFA;
FFA.prototype = new Mode();

// Gamemode Specific Functions

FFA.prototype.leaderboardAddSort = function(player,leaderboard) {
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
};

// Override

FFA.prototype.onPlayerSpawn = function(gameServer,player) {
    // Random color
    player.color = gameServer.getRandomColor();
    
    // Set up variables
    var pos, startMass;
    
    // Check if there are ejected mass in the world.
    if (gameServer.nodesEjected.length > 0) {
        var index = Math.floor(Math.random() * 100) + 1;
        if (index <= gameServer.config.ejectSpawnPlayer) {
            // Get ejected cell
            var index = Math.floor(Math.random() * gameServer.nodesEjected.length);
            var e = gameServer.nodesEjected[index];

            // Remove ejected mass
            gameServer.removeNode(e);

            // Inherit
            pos = {x: e.position.x, y: e.position.y};
            startMass = e.mass;

            var color = e.getColor();
            player.setColor({
                'r': color.r,
                'g': color.g,
                'b': color.b
            });
        }
    }
    
    // Spawn player
    gameServer.spawnPlayer(player,pos,startMass);
}

FFA.prototype.updateLB = function(gameServer) {
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
};
