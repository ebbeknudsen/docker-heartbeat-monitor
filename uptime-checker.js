'use strict';

const fs = require('fs');

var net = require('net');
var https = require("https");
const { fail } = require('assert');

const pingsConfigFile = "pings.json";
const pingResultsFile = "ping-results.json";
//const traefikHostsFile = "traefik-hosts.json";

if(!fs.existsSync(pingsConfigFile)) {
    const errorMessage = pingsConfigFile + " doesn't exists";
    console.error(errorMessage);
    throw Error(errorMessage);
}

const pingsConfigRaw = fs.readFileSync(pingsConfigFile);
const pingsConfig = JSON.parse(pingsConfigRaw);

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
    console.log(`${new Date().toISOString()}: Running ${pingsConfig.pings.length} pings`);

    let traefikHostsPromise;
    if(pingsConfig.traefik) {
        const traefikConfig = pingsConfig.traefik;

        traefikHostsPromise = performHttpsRequest(traefikConfig.baseUrl + "/api/http/routers", undefined, 2000, traefikConfig.authUsername, traefikConfig.authPassword)
            .then((traefikHostsString) => {
                const traefikHostsJson = JSON.parse(traefikHostsString);
                const traefikHostsRules = traefikHostsJson.map(traefikHost => traefikHost.rule);

                return {
                    success: true,
                    traefikHosts: traefikHostsRules
                };
            }, (error) => {
                console.error("Failed getting traefik hosts", error);

                return {
                    success: false,
                    error: error,
                    traefikHosts: undefined
                }; 
            });
    } else {
        traefikHostsPromise = Promise.resolve();
    }

    return traefikHostsPromise.then((traefikResult) => {

        const promises = [];
        const succeeded = [];
        const failed = [];
        
        pingsConfig.pings.forEach((ping) => {
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
                    result.pingUp = true;
                    console.debug("successful ping", result.name, result.host, result.port, result.time, result.duration);
    
                    return result;               
                })
                .then((result) => {
                    if(!pingsConfig.traefik || !ping.traefik) {
                        return result;
                    }

                    const traefikName = ping.traefikHost ? ping.traefikHost : ping.name;

                    result.traefikHost = traefikName + " traefik host";

                    if(traefikResult.success) {
                        var matchingTraefikHosts = traefikResult.traefikHosts.filter((nameToCheck) => nameToCheck.indexOf(traefikName) > -1);

                        if(matchingTraefikHosts.length > 0) {
                            console.debug("successful traefik host", result.name, result.traefikHost);
                            result.traefikUp = true;
                        } else {
                            result.traefikUp = false;
                            result.error = "Traefik host not found"
                        }
                    }
                    else {
                        result.traefikUp = false;
                        result.error = traefikResult.error;
                    }
                
                    result.up = result.pingUp && result.traefikUp;

                    return result;
                })
                .then((result) => {
                    console.debug("result", result);

                    if(result.up)
                        succeeded.push(result);
                    else
                        failed.push(result);
                    
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
    
            let traefikHostsString = "";
            if(pingsConfig.traefik && traefikResult.success)
                traefikHostsString = ` and getting ${traefikResult.traefikHosts.length} traefik hosts`;
            else if(pingsConfig.traefik && !traefikResult.success) {
                traefikHostsString = ` (getting traefik hosts failed with following error: "${traefikResult.error}")`
            }
            console.log(`${new Date().toISOString()}: Finished running ${pingsConfig.pings.length} pings${traefikHostsString}. ${succeeded.length} succeeded, ${failed.length} failed`);
        });
    })

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