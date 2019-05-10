
var host = '@ip@';
var port = '@wsPort@';
var url = 'ws://' + host + ':' + port + '/';
var ws = new WebSocket(url);

ws.onmessage = function (e) {
    var obj = JSON.parse(e.data);
    if (obj.method == 'runCode') {
        eval(obj.data)
    }
};
