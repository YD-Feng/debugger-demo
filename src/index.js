#!/usr/bin/env node
'use strict';

global.ws = null;

const program = require('commander'); //命令行解析模块
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const webSocket = require('nodejs-websocket');

//定义命令解析规则
program
    .version(require('../package.json').version)
    .option('-p, --port [value]', 'server port')
    .option('-w, --wsPort [value]', 'set no cache');

//解析命令行参数
program.parse(process.argv);

//代理服务器端口号，默认：9527
const port = program.port || 9527;
//webSocket 服务端口号，默认：9528
const wsPort = program.wsPort || 9528;

const interfaces = os.networkInterfaces();

//获取本机的内网IP地址
let ip = '';
for (const key in interfaces) {
    interfaces[key].forEach((item) => {
        if (item.family === 'IPv4' && item.address !== '127.0.0.1' && !item.internal) {
            ip = item.address;
            console.log(`本机ip：${ip}`);
        }
    });
}

let server = new http.Server();
let injectionScript = fs.readFileSync(path.resolve(__dirname, './tpl/injectionScript.js')).toString('utf-8').replace('@ip@', ip).replace('@wsPort@', wsPort);
let debuggerHtml = fs.readFileSync(path.resolve(__dirname, './tpl/debugger.html')).toString('utf-8').replace('@wsPort@', wsPort);

server.listen(port, () => {
    console.log(`启动服务！服务地址：127.0.0.1:${port}`);
});

server.on('connect', (req, socket, head) => {
    if (req.headers.host === ip) {
        //如果请求的host就是本地的内网ip，那么该请求肯定是移动端执行注入脚本，想连接webSocket服务...
        //建立webSocket服务连接（转发请求）
        let proxySocket = net.connect(wsPort, ip, () => {
            socket.write('HTTP/1.1 200 Connection Established');
            //将源请求的请求头写入转发请求中去
            proxySocket.write(head);
            //然后将两个socket关联起来（连接状态，数据流等完全同步）从而实现请求的转发
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
        });

        proxySocket.on('error', (e) => {
            console.log(e);
        });

        return proxySocket;
    }
});

server.on('request', (serverReq, serverRes) => {
    if (serverReq.headers.host === `127.0.0.1:${port}` || serverReq.headers.host === `localhost:${port}`) {
        serverRes.write(debuggerHtml);
        serverRes.end();
        return;
    }

    http.get(serverReq.url, (res) => {
        let statusCode = res.statusCode;
        let contentType = res.headers['content-type'];

        if (statusCode !== 200) {
            console.error(new Error(`Request Failed. Status Code: ${statusCode}`).message);
            res.resume();
            return;
        }

        let rawData = '';

        res.setEncoding('utf8');

        res.on('data', (chunk) => {
            rawData += chunk;
        });

        res.on('end', () => {
            try {

                if (contentType.indexOf('text/html') != -1) {
                    rawData = rawData.replace(/<\/HEAD>/i, `<script type="text/javascript">${injectionScript}</script>\r\n</head>`);
                }

                //console.log(`转发http请求${serverReq.url}`);
                serverRes.write(rawData);
                serverRes.end();

            } catch (e) {
                console.error(e.message);
            }
        });
    }).on('error', function(e) {
        console.log(`Got error: ${e.message}`);
    });
});

server.on('error', (e) => {
    console.error(`警告：启动失败！`);
    console.error(`检查端口${port}是否被占用，或尝试更换启动端口`);
});


ws = webSocket.createServer((conn) => {
    conn.on('text', function (str) {
        var obj = JSON.parse(str);

        switch (obj.method) {
            case 'sendCode':
                console.log(`srv:sendCode ----- cli:runCode[${obj.data}]`);
                ws.connections.forEach(function (conn) {
                    if (conn.headers.host.indexOf(ip) != -1) {
                        //只对客户端推送ws信息
                        conn.sendText(JSON.stringify({
                            method: 'runCode',
                            data: obj.data
                        }));
                    }
                });
                break;
            default:
                break;
        }
    });

    //连接断开
    conn.on('close', function (code, reason) {
        console.log('有用户断开了与server的连接');
    });

    //出错处理
    conn.on('error', function (err) {
        console.error(err);
    });
}).listen(wsPort);

ws.on('connection', function (conn) {
    console.log('有用户成功接入server');
});

