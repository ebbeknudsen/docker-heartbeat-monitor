'use strict';

const fs = require('fs');
const express = require('express');
const NodeCache = require('node-cache');
const { register, Gauge } = require('prom-client');


// Constants
const PING_RESULTS_FILE = "ping-results.json";
const PING_RESULTS_CACHE_KEY = "PING_RESULTS";

const PORT = 8080;
const HOST = '0.0.0.0';

const cacheTTL = process.env.CACHE_TTL | 30;


// App
const app = express();
const nodeCache = new NodeCache();

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
            .map((ping) => `${ping.time}: ${ping.name} ${ping.up ? 'up' : 'down'}${ping.traefik ? ' (ping: ' + ping.pingUp + ', traefik: ' + ping.traefikUp + ')' : ''}${ping.error ? ' (error: ' + ping.error + ')' : ''}`)
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

const pingResultsGauge = new Gauge({ 
    name: 'heartbeat_host_up', 
    help: 'Whether host is up or down',
    labelNames: [
        'name',
        'host',
        'port',
        'traefik',
        'traefikHost'
    ]
});

app.get('/metrics', (request, response) => {

    try {       
        const pingResults = getPingResults();

        pingResults.forEach((ping) => {

            const pingMetric = {
                name: ping.name,
                host: ping.host,
                port: ping.port,
                traefik: ping.traefik,
                traefikHost: ping.traefik ? ping.traefikHost : ""
            };

            pingResultsGauge.set(pingMetric, ping.up ? 1 : 0)
        });

        register.metrics().then((value) => {
            register.resetMetrics();
            response.set('Content-Type', register.contentType);
            response.send(`${value}`);
        });

    } catch (error) {
        const message = "Server error";
        console.warn(message, error);
        response.status = 500;
        response.send(message);
    }
});

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);