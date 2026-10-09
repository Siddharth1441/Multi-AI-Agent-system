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
const sandboxIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getSandboxRoute(hostHeader) {
    const host = hostHeader ? hostHeader.split(':')[0] : ''
    const [sandboxId, type] = host.split('.')
    if (!sandboxIdPattern.test(sandboxId) || !['agent', 'preview'].includes(type)) return null
    return { sandboxId, type }
}

function getProxy(sandboxId) {
    const target = `http://sandbox-service-${sandboxId}`;
    if (!proxies[sandboxId]) {
        proxies[sandboxId] = createProxyMiddleware({
            target,
            changeOrigin: true,
            ws: true,
            pathFilter: (pathname, req) => {
                const route = getSandboxRoute(req.headers.host)
                return route?.sandboxId === sandboxId && route.type === 'preview'
            },
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
            pathFilter: (pathname, req) => {
                const route = getSandboxRoute(req.headers.host)
                return route?.sandboxId === sandboxId && route.type === 'agent'
            },
        })
    }

    return agentProxies[sandboxId]
}   


app.use(async(req,res,next)=>{
    const route = getSandboxRoute(req.headers.host)
    if (!route) return next()

    try {
        await refreshTTL(route.sandboxId)
    } catch (error) {
        console.error(`Could not refresh sandbox ${route.sandboxId}:`, error)
        return res.status(502).json({ error: 'Could not verify sandbox availability' })
    }

    if (route.type === 'agent') return getAgentProxy(route.sandboxId)(req,res,next)
    return getProxy(route.sandboxId)(req,res,next)
})

export default app;
