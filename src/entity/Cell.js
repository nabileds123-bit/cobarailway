function Cell(nodeId, owner, position, mass, gameServer) {
    this.nodeId = nodeId;
    this.owner = owner; // playerTracker that owns this cell
    this.color = {r: 0, g: 255, b: 0};
    this.position = position;
    this.mass = mass; // Starting mass of the cell
    this.cellType = -1; // 0 = Player Cell, 1 = Food, 2 = Virus, 3 = Ejected Mass
   
    this.killedBy; // Cell that ate this cell
    this.recombineTicks = 0; // Ticks until the cell can recombine with other cells 
    this.ignoreCollision = false;
    this.gameServer = gameServer;
    this.skinUrl = owner && owner.skinUrl ? String(owner.skinUrl) : "";
    
    this.moveEngineTicks = 0; // Amount of times to loop the movement function
    this.moveEngineSpeed = 0;
    this.moveEngineDecay = null;
    this.angle = 0; // Angle of movement
    this.momentumSpeed = 0; // Sisa momentum setelah split boost habis
    this.momentumAngle = 0; // Arah momentum
    
    if (this.owner) {
        this.setColor(this.owner.color);
        this.owner.cells.push(this); // Add to cells list of the owner 
    } 
}

module.exports = Cell;

Cell.prototype.getName = function() {
    if (this.owner) {
        return this.owner.getCellDisplayName ? this.owner.getCellDisplayName() : (this.owner.getDisplayName ? this.owner.getDisplayName() : this.owner.name);
    } else {
        return "";
    }
}

Cell.prototype.setColor = function(color) {
    this.color.r = color.r;
    this.color.b = color.b;
    this.color.g = color.g;
}

Cell.prototype.getColor = function() {
    return this.color;
}

Cell.prototype.getType = function() {
    return this.cellType;
}

Cell.prototype.getSize = function() {
    return Math.sqrt(100 * this.mass + .25) >> 0;
}

Cell.prototype.addMass = function(n) {
    this.mass = Math.min(this.mass + n, this.owner.gameServer.config.playerMaxMass);
}

Cell.prototype.getSpeed = function() {
    var speedMultiplier = this.owner && this.owner.gameServer ? Number(this.owner.gameServer.config.playerSpeed) : 100;
    if (isNaN(speedMultiplier)) speedMultiplier = 100;
    return 600 * Math.pow(this.mass, -0.110) * 50 / 1000 * (speedMultiplier / 100);
}

Cell.prototype.setAngle = function(radians) {
    this.angle = radians;
}

Cell.prototype.getAngle = function() {
    return this.angle;
}

Cell.prototype.setMoveEngineData = function(speed, ticks, decay) {
    this.moveEngineSpeed = speed;
    this.moveEngineTicks = ticks;
    this.moveEngineDecay = decay;
}

Cell.prototype.getMoveTicks = function() {
    return this.moveEngineTicks;
}

Cell.prototype.getRecombineTicks = function() {
    return this.recombineTicks;
}

Cell.prototype.setRecombineTicks = function(n) {
    this.recombineTicks = n;
}

Cell.prototype.setCollisionOff = function(bool) {
    this.ignoreCollision = bool;
}

Cell.prototype.getCollision = function() {
    return this.ignoreCollision;
}

Cell.prototype.getEatingRange = function() {
    if (this.cellType == 3) {
        return 0;
    } else {
        return this.getSize() * .35;
    }
}

Cell.prototype.getKiller = function() {
    return this.killedBy;
}

Cell.prototype.setKiller = function(cell) {
    this.killedBy = cell;
}

Cell.prototype.collisionCheck = function(bottomY,topY,rightX,leftX) {
    if (this.position.y > bottomY) {
        return false;
    } if (this.position.y < topY) {
        return false;
    } if (this.position.x > rightX) {
        return false;
    } if (this.position.x < leftX) {
        return false;
    } 
    return true;
}

Cell.prototype.visibleCheck = function(box,centerPos) {
    return this.collisionCheck(box.bottomY,box.topY,box.rightX,box.leftX);
}

Cell.prototype.calcMove = function(x2, y2, gameServer) {
    var config = gameServer.config;
    
    // Get angle
    var deltaY = y2 - this.position.y;
    var deltaX = x2 - this.position.x;
    var angle = Math.atan2(deltaX,deltaY);
    
    // Distance between mouse pointer and cell
    var dist = Math.sqrt( Math.pow(x2 - this.position.x, 2) +  Math.pow(y2 - this.position.y, 2) );
    var speed = Math.min(this.getSpeed(),dist);
    
    // Blend momentum dengan gerakan mouse agar tidak patah tiba-tiba
    var mx = speed * Math.sin(angle);
    var my = speed * Math.cos(angle);
    if (this.momentumSpeed > 0.5) {
        mx += this.momentumSpeed * Math.sin(this.momentumAngle);
        my += this.momentumSpeed * Math.cos(this.momentumAngle);
        this.momentumSpeed *= 0.78; // momentum meluruh tiap tick
    } else {
        this.momentumSpeed = 0;
    }
    var x1 = this.position.x + mx;
    var y1 = this.position.y + my;
    
    // Collision check for other cells
    for (var i = 0; i < this.owner.cells.length;i++) {
        var cell = this.owner.cells[i];
        
        if (cell.owner && this.owner && cell.owner.gameServer != this.owner.gameServer) {
            continue;
        }

        if ((this.nodeId == cell.nodeId) || (this.ignoreCollision) || (cell.ignoreCollision)) {
            continue;
        }

        if (gameServer.gameMode && gameServer.gameMode.name == "Tournament" &&
            gameServer.gameMode.gamePhase == 1 &&
            String(gameServer.roomName || '').indexOf('BattleMatch-') === 0) {
            continue;
        }
        
        if ((cell.recombineTicks > 0) || (this.recombineTicks > 0)) {
            var dist = Math.sqrt( Math.pow(cell.position.x - this.position.x, 2) +  Math.pow(cell.position.y - this.position.y, 2) );
            var collisionDist = cell.getSize() + this.getSize();
            
            if (dist < collisionDist) {
                var newDeltaY = cell.position.y - this.position.y;
                var newDeltaX = cell.position.x - this.position.x;
                var newAngle = Math.atan2(newDeltaX, newDeltaY);

                var move = collisionDist - dist;

                // Hanya dorong cell target — THIS tidak disentuh sama sekali
                // sehingga cell yang sedang calcMove tidak tersentak balik
                cell.position.x = (cell.position.x + ( move * Math.sin(newAngle) )) >> 0;
                cell.position.y = (cell.position.y + ( move * Math.cos(newAngle) )) >> 0;
            }
        }
    }
    
    // Team collision
    if (gameServer.gameMode.haveTeams) {
        var team = this.owner.getTeam();
 
        for (var i = 0; i < this.owner.visibleNodes.length;i++) {
            var check = this.owner.visibleNodes[i];

            if (check.owner && this.owner && check.owner.gameServer != this.owner.gameServer) {
                continue;
            }

            if ((check.getType() != 0) || (this.owner == check.owner)){
                continue;
            }
        
            if (check.owner.getTeam() == team) {
                var dist = Math.sqrt( Math.pow(check.position.x - this.position.x, 2) +  Math.pow(check.position.y - this.position.y, 2) );
                var collisionDist = check.getSize() + this.getSize();
                
                if (dist < collisionDist) {
                    var newDeltaY = check.position.y - y1;
                    var newDeltaX = check.position.x - x1;
                    var newAngle = Math.atan2(newDeltaX,newDeltaY);
                    
                    var move = collisionDist - dist;
                    
                    check.position.x = check.position.x + ( move * Math.sin(newAngle) ) >> 0;
                    check.position.y = check.position.y + ( move * Math.cos(newAngle) ) >> 0;
                }
            }
        }
    }
    
    // Check to ensure we're not passing the world border
    if (x1 < config.borderLeft) {
        x1 = config.borderLeft;
    }
    if (x1 > config.borderRight) {
        x1 = config.borderRight;
    }
    if (y1 < config.borderTop) {
        y1 = config.borderTop;
    }
    if (y1 > config.borderBottom) {
        y1 = config.borderBottom;
    }

    this.position.x = x1 >> 0;
    this.position.y = y1 >> 0;
    if(gameServer.config.rainbowCells) {
        this.color = gameServer.getRandomColor();
    };
}

Cell.prototype.calcMovePhys = function(config) {
    var X = this.position.x + ( this.moveEngineSpeed * Math.sin(this.angle) );
    var Y = this.position.y + ( this.moveEngineSpeed * Math.cos(this.angle) );
    
    var decay = null == this.moveEngineDecay ? .75 : this.moveEngineDecay;
    this.moveEngineSpeed *= decay;
    this.moveEngineTicks--;
    // Simpan momentum saat boost hampir habis, tapi kurangi efeknya pada mass besar.
    if (this.moveEngineTicks <= 0 && this.cellType == 0) {
        var massFactor = Math.max(0, 1 - (this.mass / 5000));
        this.momentumSpeed = this.moveEngineSpeed * massFactor;
        this.momentumAngle = this.angle;
    }
     
    // Border check - Bouncy physics
    var radius = 40;
    if ((this.position.x - radius) < config.borderLeft) {
        this.angle = Math.abs(3.14 - this.angle);
        X = config.borderLeft + radius;
    }
    if ((this.position.x + radius) > config.borderRight) {
        this.angle = 1 - this.angle;
        X = config.borderRight - radius;
    }
    if ((this.position.y - radius) < config.borderTop) {
        this.angle = Math.abs(this.angle - 3.14);
        Y = config.borderTop + radius;
    }
    if ((this.position.y + radius) > config.borderBottom) {
        this.angle = Math.abs(this.angle - 3.14);
        Y = config.borderBottom - radius;
    }
    
    this.position.x = X >> 0;
    this.position.y = Y >> 0;  
}

Cell.prototype.onConsume = function(consumer,gameServer) {}
Cell.prototype.onAdd = function(gameServer) {}
Cell.prototype.onRemove = function(gameServer) {}
Cell.prototype.moveDone = function(gameServer) {}
