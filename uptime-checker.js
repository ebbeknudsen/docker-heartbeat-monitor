'use strict';

const fs = require('fs');

var net = require('net');
var https = require("https");

const pingsFile = "pings.json";
const pingResultsFile = "ping-results.json";
const traefikHostsFile = "traefik-hosts.json";

if(!fs.existsSync(pingsFile)) {
    const errorMessage = pingsFile + " doesn't exists";
    console.error(errorMessage);
    throw Error(errorMessage);
}

const pingsRaw = fs.readFileSync(pingsFile);
const pings = JSON.parse(pingsRaw);

let traefikHosts = undefined;
if(fs.existsSync(traefikHostsFile)) {
    const traefikHostsRaw = fs.readFileSync(traefikHostsFile);
    traefikHosts = JSON.parse(traefikHostsRaw);
}


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

const performHttpsRequest = (url, port = undefined, timeout, basicAuthName = "", basicAuthPassword = "") => {

    var requestPromise = new Promise((resolve, reject) => {

        var requestTimeoutHandle = setTimeout(() => {
            reject("timeout");
        }, timeout);

        var request = https.request(url, {
            port: port,
            auth: basicAuthName + ":" + basicAuthPassword,
        }, (response) => {
            let resultString = "";
    
            response.on("data", (chunk) => resultString += chunk);
            response.on("end", () => {
                clearTimeout(requestTimeoutHandle);

                if(response.statusCode !== 200) {
                    reject(response.statusCode + ": " + response.statusMessage);
                }
                resolve(resultString);
            });
        });

        request.on("error", (error) => {
            reject(error.toString());
        })

        request.end();
        
    });

    return requestPromise;
};

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

    if(traefikHosts && traefikHosts.hosts) {
        var traefikHostsPromise = performHttpsRequest(traefikHosts.baseUrl + "/api/http/routers", undefined, 2000, traefikHosts.authUsername, traefikHosts.authPassword)
            .then((traefikHostsString) => {
                const traefikHostsJson = JSON.parse(traefikHostsString);
                const traefikHostsRules = traefikHostsJson.map(traefikHost => traefikHost.rule);

                const time = new Date().toISOString();
                traefikHosts.hosts.forEach((host) => {
                    
                    var matchingHostRules = traefikHostsRules.filter((hostRule) => hostRule.indexOf(host.name) > -1);

                    if(matchingHostRules.length > 0) {
                        succeeded.push({
                            time: time,
                            up: true,
                            name: host.name + " traefik host",
                            host: host.name,
                            port: 443,
                        });
                    } else {
                        failed.push({
                            time: time,
                            up: false,
                            name: host.name + " traefik host",
                            host: host.name,
                            port: 443,
                            error: "Host not found"
                        });
                    }
                });
            }, (error) => {
                console.debug("Failed getting traefik hosts", error);
                const time = new Date().toISOString();

                traefikHosts.hosts.forEach((host) => {
                    failed.push({
                        time: time,
                        up: false,
                        name: host.name + " traefik host",
                        host: host.name,
                        port: 443,
                        error: error
                    });
                });
                
            });

        promises.push(traefikHostsPromise);
    }
    

    return Promise.all(promises).then(() => {
        const resultList = succeeded.concat(failed);
        const resultJsonString = JSON.stringify({
            results: resultList
        });

        fs.writeFileSync(pingResultsFile, resultJsonString);

        let traefikHostsString = "";
        if(traefikHosts && traefikHosts.hosts)
            traefikHostsString = ` and getting ${traefikHosts.hosts.length} traefik hosts`;
        console.log(`${new Date().toISOString()}: Finished running ${pings.length} pings${traefikHostsString}. ${succeeded.length} succeeded, ${failed.length} failed`);
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