'use strict';

const fs = require('fs');
const express = require('express');

const pingResultsFile = "ping-results.json";


// Constants
const PORT = 8080;
const HOST = '127.0.0.1';

// App
const app = express();

function getPingResults() {

    if(!fs.existsSync(pingResultsFile)) {
        const errorMessage = pingResultsFile + " doesn't exists";
        console.warn(errorMessage);
        return [];
    }    

    const pingResultsRaw = fs.readFileSync(pingResultsFile, 'utf8');
    const pingResultsJson = JSON.parse(pingResultsRaw);
    return pingResultsJson.results;
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