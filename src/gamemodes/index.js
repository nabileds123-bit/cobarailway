module.exports = {
    Mode: require('./Mode'),
    FFA: require('./FFA'),
    Teams: require('./Teams'),
    Tournament: require('./Tournament'),
    Hardcore: require('./Hardcore')
};

var list = [];
list[0] = new module.exports.FFA();
list[1] = new module.exports.Teams();
list[2] = new module.exports.Hardcore();
list[10] = new module.exports.Tournament();

var get = function(id) {
    var mode;
    switch (id) {
        case 1: // Teams
            mode = new module.exports.Teams();
            break;
        case 2: // Hardcore
            mode = new module.exports.Hardcore();
            break;
        case 10: // Tournament
            mode = new module.exports.Tournament();
            break;
        default: // FFA is default
            mode = new module.exports.FFA();
            break;
    }
    return mode;
};

module.exports.list = list;
module.exports.get = get;
