'use strict';

const fs = require('fs');

var net = require('net');

const pingsFile = "pings.json";
const pingResultsFile = "ping-results.json";

if(!fs.existsSync(pingsFile)) {
    const errorMessage = pingsFile + " doesn't exists";
    console.error(errorMessage);
    throw Error(errorMessage);
}

const pingsRaw = fs.readFileSync(pingsFile);
const pings = JSON.parse(pingsRaw);

const runEverySeconds = process.env.RUN_INTERVAL | 10;

const checkConnection = (host, port, timeout) => {

    if(!port)
        port = 80;

    return new Promise((resolve, reject) => {

        timeout = timeout || 2000; // default of 2 seconds

        let timer = undefined;
        let socket = undefined;

        timer = setTimeout(() => {
            reject("timeout");
            socket.end();
        }, timeout);

        try {
            socket = net.createConnection(port, host, () => {   
                clearTimeout(timer);
                resolve();
                socket.end();
            });
    
            socket.on('error', (error) => {    
                clearTimeout(timer);
                reject(error.toString());
            });
        } catch (error) {
            clearTimeout(timer);
            reject(error.toString());
        }
        
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
        const startTime = new Date();
        var promise = checkConnection(ping.host, ping.port)
            .then(() => {
                const endTime = new Date();
                result.time = endTime.toISOString();
                result.duration = endTime.getTime() - startTime.getTime();
                result.up = true;
                succeeded.push(result);
                console.debug("success", result.name, result.host, result.port, result.time, result.duration);
            }, (error) => {
                const endTime = new Date();
                result.time = endTime.toISOString();
                result.duration = endTime.getTime() - startTime.getTime();
                result.up = false;
                result.error = error.toString();
                failed.push(result);
                console.debug("fail", result.name, result.host, result.port, result.time, result.duration, result.error);
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

console.log(`${new Date().toISOString()}: Starting uptime-checker, checking every ${runEverySeconds} seconds.`);


function runPings() {

    performPings()
        .then(() => {
            setTimeout(runPings, 1000 * runEverySeconds);
            // setTimeout(runPings, 1000 * 10);
        }, (error) => {
            console.error(`${new Date().toISOString()}: Error running pings: ${error}`);
        });
}

runPings();