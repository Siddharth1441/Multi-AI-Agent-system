import express from 'express'
import {createProxyMiddleware} from 'http-proxy-middleware'
import morgan from 'morgan'
import { refreshTTL } from './config/redis.js';

const app = express();
app.use(morgan('combined'))

app.get('/api/status/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' })
})

app.get('/api/status/readyz', (req, res) => {
    res.status(200).json({ status: 'ready' })
})



const proxies = {}
const agentProxies = {}

function getProxy(sandboxId) {
    const target = `http://sandbox-service-${sandboxId}`;
    if (!proxies[sandboxId]) {
        proxies[sandboxId] = createProxyMiddleware({
            target,
            changeOrigin: true,
            ws: true,
        })
    }

    return proxies[sandboxId]
}   
function getAgentProxy(sandboxId) {
    const target = `http://sandbox-service-${sandboxId}:3000`;
    if (!agentProxies[sandboxId]) {
        agentProxies[sandboxId] = createProxyMiddleware({
            target,
            changeOrigin: true,
            ws: true,
        })
    }

    return agentProxies[sandboxId]
}   


app.use(async(req,res,next)=>{
    const host = req.headers.host ? req.headers.host.split(':')[0] : '';
    const parts = host.split('.');
    const sandboxId = parts[0];
    const type = parts[1];
    await refreshTTL(sandboxId)

    if(type === 'agent'){
        return getAgentProxy(sandboxId)(req,res,next);
    }else if(type === 'preview'){
        return getProxy(sandboxId)(req,res,next);
    }    
    next();
})

export default app;
