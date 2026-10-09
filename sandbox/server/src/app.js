import express from 'express';
import morgan from 'morgan';
import { createService } from './kubernetes/service.js';
import { createPod } from './kubernetes/pod.js';
import {v7 as uuid} from 'uuid'
import { createSandboxKey, refreshSandboxKey } from './config/redis.js';
import { k8sCoreV1Api } from './kubernetes/config.js';

const app = express();

app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/api/status/healthz',(req,res)=>{
    res.status(200).json({status : 'ok'})

})

app.get('/api/status/readyz',(req,res)=>{
    res.status(200).json({status : 'ready'})
})

app.get('/api/sandbox/health',(req,res)=>{
    res.status(200).json({
        message: 'Sandbox is healthy',
        status: 'ok'
    })
})

const sandboxIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function proxySandboxAgentRequest(req, res, endpoint) {
    const { sandboxId } = req.params
    if (!sandboxIdPattern.test(sandboxId)) {
        return res.status(400).json({ error: 'Invalid sandbox ID' })
    }

    const query = new URLSearchParams(req.query).toString()
    const target = `http://sandbox-service-${sandboxId}:3000/${endpoint}${query ? `?${query}` : ''}`

    try {
        const upstream = await fetch(target, {
            method: req.method,
            headers: req.method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
            body: req.method === 'PATCH' ? JSON.stringify(req.body) : undefined,
            signal: AbortSignal.timeout(15_000)
        })
        const contentType = upstream.headers.get('content-type')
        if (contentType) res.setHeader('Content-Type', contentType)
        return res.status(upstream.status).send(await upstream.text())
    } catch (error) {
        console.error(`Could not proxy ${endpoint} for sandbox ${sandboxId}:`, error)
        return res.status(502).json({ error: 'Sandbox agent is unavailable' })
    }
}

app.get('/api/sandbox/:sandboxId/agent/list-files', (req, res) =>
    proxySandboxAgentRequest(req, res, 'list-files'))
app.get('/api/sandbox/:sandboxId/agent/read-files', (req, res) =>
    proxySandboxAgentRequest(req, res, 'read-files'))
app.patch('/api/sandbox/:sandboxId/agent/update-file', (req, res) =>
    proxySandboxAgentRequest(req, res, 'update-file'))

app.post('/api/sandbox/:sandboxId/refresh', async (req, res) => {
    const { sandboxId } = req.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sandboxId)) {
        return res.status(400).json({ error: 'Invalid sandbox ID' })
    }

    try {
        await k8sCoreV1Api.readNamespacedService({
            name: `sandbox-service-${sandboxId}`,
            namespace: 'default'
        })
        const refreshed = await refreshSandboxKey(sandboxId)
        if (!refreshed) {
            return res.status(404).json({ error: 'Sandbox is no longer active' })
        }
        return res.status(200).json({
            status: 'active',
            sandbox: {
                sandboxId,
                previewUrl: `http://${sandboxId}.preview.127.0.0.1.nip.io`,
                agentUrl: `http://${sandboxId}.agent.127.0.0.1.nip.io`,
                agentApiUrl: `/api/sandbox/${sandboxId}/agent`
            }
        })
    } catch (error) {
        if (error.code === 404 || error.statusCode === 404 || error.response?.status === 404) {
            return res.status(404).json({ error: 'Sandbox is no longer active' })
        }
        console.error(`Could not refresh sandbox ${sandboxId}:`, error)
        return res.status(500).json({ error: 'Could not verify sandbox status' })
    }
})

async function waitForSandboxReady(sandboxId) {
    const podName = `sandbox-pod-${sandboxId}`
    const deadline = Date.now() + 5 * 60_000

    while (Date.now() < deadline) {
        const pod = await k8sCoreV1Api.readNamespacedPod({
            name: podName,
            namespace: 'default'
        })
        const statuses = pod.status?.containerStatuses || []

        if (pod.status?.phase === 'Failed') {
            throw new Error(`Sandbox pod ${podName} failed to start`)
        }
        if (pod.status?.phase === 'Running' && statuses.length >= 2 && statuses.every(({ ready }) => ready)) {
            return
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
    }

    throw new Error(`Timed out waiting for sandbox ${sandboxId} to become ready`)
}

app.post('/api/sandbox/start', async (req, res)=>{
    const sandboxId = uuid();
    try {
        await Promise.all([
            createPod(sandboxId),
            createService(sandboxId),
            createSandboxKey(sandboxId)
        ])
        await waitForSandboxReady(sandboxId)

        return res.status(201).json({
            message:'sandbox environment created successfully',
            sandboxId,
            previewUrl: `http://${sandboxId}.preview.127.0.0.1.nip.io`,
            agentUrl: `http://${sandboxId}.agent.127.0.0.1.nip.io`,
            agentApiUrl: `/api/sandbox/${sandboxId}/agent`

        })
    } catch (error) {
        console.error(`Could not start sandbox ${sandboxId}:`, error)
        return res.status(500).json({
            error: `Could not start sandbox: ${error.message}`,
            sandboxId
        })
    }
})


export default app;
