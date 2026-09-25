import express from 'express';
import morgan from 'morgan';
import { createService } from './kubernetes/service.js';
import { createPod } from './kubernetes/pod.js';
import {v7 as uuid} from 'uuid'

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

app.post('/api/sandbox/start', async (req, res)=>{
    const sandboxId = uuid();
    await Promise.all([
        createPod(sandboxId),
        createService(sandboxId)
    ])

    return res.status(201).json({
        message:'sandbox environment created successfully',
        sandboxId,
        previewUrl: `http://${sandboxId}.preview.127.0.0.1.nip.io`,
        agentUrl: `http://${sandboxId}.agent.127.0.0.1.nip.io`

    })
})


export default app;


