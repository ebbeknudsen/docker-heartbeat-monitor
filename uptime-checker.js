'use strict';

const fs = require('fs');

var net = require('net');
var https = require("https");
const { fail } = require('assert');

const pingsConfigFile = "pings.json";
const pingResultsFile = "ping-results.json";

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

const addTraefikStatusToResult = (traefikResult, result) => {
    if(!pingsConfig.traefik || !result.traefik) {
        return result;
    }

    const traefikName = result.traefikHost ? result.traefikHost : result.name;

    result.traefikHost = traefikName + " traefik host";

    if(traefikResult.success) {
        var matchingTraefikHosts = traefikResult.traefikHosts.filter((nameToCheck) => nameToCheck.indexOf(traefikName) > -1);

        if(matchingTraefikHosts.length > 0) {
            console.debug("successful traefik host", result.name, result.traefikHost);
            result.traefikUp = true;
        } else {
            result.traefikUp = false;
            result.traefikError = "Traefik host not found"
        }
    }
    else {
        result.traefikUp = false;
        result.traefikError = traefikResult.error;
    }

    result.up = result.pingUp === true && result.traefikUp === true;

    return result;
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
                .then((localResult) => {
                    localResult = addTraefikStatusToResult(traefikResult, localResult);
                    return localResult;
                })
                .then((localResult) => {
                    console.debug("result", localResult);

                    if(localResult.up)
                        succeeded.push(localResult);
                    else
                        failed.push(localResult);
                    
                }, (error) => {
                    const endTime = new Date();
                    result.time = endTime.toISOString();
                    result.duration = endTime.getTime() - startTime.getTime();
                    result.pingUp = result.pingUp === true;
                    result.up = false;                

                    const errorResult = addTraefikStatusToResult(traefikResult, result);

                    errorResult.error = error.toString();
                    failed.push(errorResult);
                    console.debug("fail", errorResult);
                });    
                
            promises.push(promise);
        });

        return Promise.all(promises).then(() => {
            const resultList = succeeded.concat(failed);
            const resultObject = {
                results: resultList
            }

            for (const pingResult of resultObject.results) {
                resultObject[pingResult.name] = pingResult;
            }

            const resultJsonString = JSON.stringify(resultObject);


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
        }, (error) => {
            console.error(`${new Date().toISOString()}: Error running pings: ${error}`);
        });
}

runPings();