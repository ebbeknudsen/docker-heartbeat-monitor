'use strict';

const fs = require('fs');

var net = require('net');

const pingsFile = "pings.json";
const pingResultsFile = "ping-results.json";

if(!fs.existsSync(pingsFile)) {
    const errorMessage = pingsFile + " doesn't exists";
    console.log(errorMessage);
    throw Error(errorMessage);
}

const pingsRaw = fs.readFileSync(pingsFile);
const pings = JSON.parse(pingsRaw);

const runEveryMinutes = process.env.RUN_INTERVAL | 1;

function checkConnection(host, port, timeout) {

    if(!port)
        port = 80;

    return new Promise(function(resolve, reject) {

        timeout = timeout || 2000; // default of 10 seconds

        var timer = setTimeout(function() {
            reject("timeout");
            socket.end();
        }, timeout);

        var socket = net.createConnection(port, host, function() {
            clearTimeout(timer);
            resolve();
            socket.end();
        });

        socket.on('error', function(err) {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function performPings() {
    console.log(`${new Date().toISOString()}: Running ${pings.length} pings`);

    const promises = [];
    const succeeded = [];
    const failed = [];

    pings.forEach((ping) => {
        const result = {
            ...ping
        };
        var promise = checkConnection(ping.host, ping.port)
            .then(() => {
                result.time = new Date().toISOString();
                result.status = "up";
                succeeded.push(result);
            }, (error) => {
                result.time = new Date().toISOString();
                result.status = "down";
                result.error = error;
                failed.push(result);
            });    
            
        promises.push(promise);
    });

    return Promise.all(promises).then(() => {
        const resultList = succeeded.concat(failed);
        const resultJsonString = JSON.stringify({
            results: resultList
        });

        fs.writeFileSync(pingResultsFile, resultJsonString);

        console.log(`${new Date().toISOString()}: Finished running ${pings.length} pings. ${succeeded.length} succeeded, ${failed.length} failed`);
    });
}

console.log(`${new Date().toISOString()}: Starting uptime-checker, checking every ${runEveryMinutes} minutes.`);


function runPings() {

    performPings()
        .then(() => {
            setTimeout(runPings, 1000 * 60 * runEveryMinutes);
        }, (error) => {
            console.error(`${new Date().toISOString()}: Error running pings: ${error}`);
        });
}

runPings();