'use strict';

const fs = require('fs');
const express = require('express');
const NodeCache = require('node-cache');
const nodeCache = new NodeCache();

// Constants
const PING_RESULTS_FILE = "ping-results.json";
const PING_RESULTS_CACHE_KEY = "PING_RESULTS";

const PORT = 8080;
const HOST = '0.0.0.0';

const cacheTTL = process.env.CACHE_TTL | 30;


// App
const app = express();

function getPingResults() {

    let results = nodeCache.get(PING_RESULTS_CACHE_KEY);

    if(results == undefined) {
        console.debug("Ping results not found in cache. Reading from file: " + PING_RESULTS_FILE);
        if(!fs.existsSync(PING_RESULTS_FILE)) {
            const errorMessage = PING_RESULTS_FILE + " doesn't exists";
            console.warn(errorMessage);
            return [];
        }
    
        const pingResultsRaw = fs.readFileSync(PING_RESULTS_FILE, 'utf8');
        const pingResultsJson = JSON.parse(pingResultsRaw);
        results = pingResultsJson.results;
        nodeCache.set(PING_RESULTS_CACHE_KEY, results, cacheTTL);
    }

    return results;    
}

app.get('/', (request, response) => {
    
    try {       
        const pingResults = getPingResults();

        const pingResultsText = pingResults
            .map((ping) => `${ping.time}: ${ping.name} ${ping.status}${ping.error ? ' (error: ' + ping.error + ')' : ''}`)
            .join('\n')
            ;
        
        response.send(`<pre>${pingResultsText}</pre>`);
        
    } catch (error) {
        const message = "Server error";
        console.warn(message, error);
        response.status = 500;
        response.send(message);
    }
});


app.get('/metrics', (request, response) => {
    
    try {       
        const pingResults = getPingResults();
        const pingResultsText = pingResults
            .map((ping) => `uptime_checker{name="${ping.name}",host="${ping.host}",port="${ping.port}",time="${ping.time}",error="${ping.error ? ping.error : ''}"} ${ping.status}`)
            .join('\n')
            ;
        
        response.send(`<pre>${pingResultsText}</pre>`);
        
    } catch (error) {
        const message = "Server error";
        console.warn(message, error);
        response.status = 500;
        response.send(message);
    }
});

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);