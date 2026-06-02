function UpdateNodes(destroyQueue, nodes, nonVisibleNodes) {
    this.destroyQueue = destroyQueue;
    this.nodes = nodes;
    this.nonVisibleNodes = nonVisibleNodes;
}

module.exports = UpdateNodes;

UpdateNodes.prototype.build = function() {
    
    // Calculate nodes sub packet size before making the data view
    var nodesLength = 0;
    for (var i = 0; i < this.nodes.length; i++) {
        var node = this.nodes[i];
        
        if (typeof node == "undefined") {
            continue;
        }

        var skinUrl = node.owner && node.owner.skinUrl ? String(node.owner.skinUrl) : "";
        nodesLength = nodesLength + 18 + (node.getName().length * 2) + (skinUrl.length * 2);
    }
    
    var buf = new ArrayBuffer(3 + (this.destroyQueue.length * 12) + (this.nonVisibleNodes.length * 4) + nodesLength + 8);
    var view = new DataView(buf);

    view.setUint8(0, 16, true); // Packet ID
    view.setUint16(1, this.destroyQueue.length, true); // Nodes to be destroyed

    var offset = 3;
    for (var i = 0; i < this.destroyQueue.length; i++) {
        var node = this.destroyQueue[i];

        if (!node) {
            continue;
        }
        
        var killer = 0;
        if (node.getKiller()) {
            killer = node.getKiller().nodeId;
        }

        view.setUint32(offset, killer, true); // Killer ID
        view.setUint32(offset + 4, node.nodeId, true); // Node ID
        
        offset += 8;
    }
    
    for (var i = 0; i < this.nodes.length; i++) {
        var node = this.nodes[i];

        if (typeof node == "undefined") {
            continue;
        }
        
        var v = node.getType() == 2 || node.spiked ? 1 : 0; // Virus flag
        if (node.getType() == 0) {
            v |= 128; // Player cell flag for client-side "Show Other Mass"
        }
        
        view.setUint32(offset, node.nodeId, true); // Node ID
        view.setUint16(offset + 4, node.position.x, true); // X position
        view.setUint16(offset + 6, node.position.y, true); // Y position
        view.setUint16(offset + 8, node.getSize(), true); // Mass formula: Radius (size) = (mass * mass) / 100
        view.setUint8(offset + 10, node.color.r, true); // Color (R)
        view.setUint8(offset + 11, node.color.g, true); // Color (G)
        view.setUint8(offset + 12, node.color.b, true); // Color (B)
        view.setUint8(offset + 13, v, true); // Flags
        offset += 14;
        
        var name = node.getName();
        if (name) {
            for (var j = 0; j < name.length; j++) {
                var c = name.charCodeAt(j);
                if (c){
                    view.setUint16(offset, c, true);
                }
                offset += 2;
            }
        }

        view.setUint16(offset, 0, true); // End of string
        offset += 2;

        var skinUrl = node.owner && node.owner.skinUrl ? String(node.owner.skinUrl) : "";
        if (skinUrl) {
            for (var j = 0; j < skinUrl.length; j++) {
                var c = skinUrl.charCodeAt(j);
                if (c) {
                    view.setUint16(offset, c, true);
                }
                offset += 2;
            }
        }

        view.setUint16(offset, 0, true); // End of skin url
        offset += 2;
    }
    
    var len = this.nonVisibleNodes.length + this.destroyQueue.length;
    view.setUint32(offset, 0, true); // End
    view.setUint32(offset + 4, len, true); // # of non-visible nodes to destroy

    offset += 8;
    
    // Destroy queue + nonvisible nodes
    for (var i = 0; i < this.destroyQueue.length; i++) {
        var node = this.destroyQueue[i];

        if (!node) {
            continue;
        }

        view.setUint32(offset, node.nodeId, true);
        offset += 4;
    }
    for (var i = 0; i < this.nonVisibleNodes.length; i++) {
        var node = this.nonVisibleNodes[i];

        if (!node) {
            continue;
        }

        view.setUint32(offset, node.nodeId, true);
        offset += 4;
    }

    return buf;
}
