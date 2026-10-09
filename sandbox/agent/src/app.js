import express from 'express'
import morgan from 'morgan'
import fs from 'fs'
import path from 'path'
import { Server } from 'socket.io'
import http from 'http'
import pty from 'node-pty'
import os from 'os'

const WORKING_DIR = '/workspace'
const frontendOrigins = new Set(['http://localhost:5173', 'http://localhost', ...(process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)]
    .map(origin => origin.replace(/\/+$/, '')))
function isAllowedFrontendOrigin(origin) {
    if (!origin) return true
    if (frontendOrigins.has(origin.replace(/\/+$/, ''))) return true

    try {
        const { protocol, hostname } = new URL(origin)
        return ['http:', 'https:'].includes(protocol) &&
            ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    } catch {
        return false
    }
}

const app = express()

const httpServer = http.createServer(app)

app.use(morgan('dev'))
app.use((req, res, next) => {
    const origin = req.get('Origin')
    if (origin && isAllowedFrontendOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.vary('Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204)
    }
    next()
})
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => callback(null, isAllowedFrontendOrigin(origin)),
        methods: ['GET', 'POST', 'PATCH'],
    },
})

function resolveWorkspacePath(file) {
    if (typeof file !== 'string' || !file.trim()) {
        throw new Error('A relative workspace file path is required')
    }

    const normalizedFile = file.replaceAll('\\', '/')
    if (path.isAbsolute(normalizedFile)) {
        throw new Error('Absolute file paths are not allowed')
    }

    const filePath = path.resolve(WORKING_DIR, normalizedFile)
    const relativePath = path.relative(WORKING_DIR, filePath)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('File path must stay inside the workspace')
    }
    return filePath
}

app.get('/',(req,res)=>{
    res.status(200).json({ message: 'Hello, World!',
        status: 'success'
     })
})

app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' })
})

const shell = process.env.SHELL || 'bash';

// 2. Spawn the pseudoterminal process
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: "/workspace",
  env: process.env
});

const terminalHistory = [];
let terminalHistorySize = 0;
ptyProcess.onData((data) => {
  terminalHistory.push(data);
  terminalHistorySize += data.length;
  while (terminalHistorySize > 20000 && terminalHistory.length > 1) {
    terminalHistorySize -= terminalHistory.shift().length;
  }
  io.emit('terminal-output', data);
});
ptyProcess.onExit(({ exitCode, signal }) => {
  console.log(`PTY process exited with code ${exitCode} and signal ${signal}`);
});
io.on('connection', (socket) => {
    console.log('A client connected:', socket.id)
    if (terminalHistory.length) socket.emit('terminal-output', terminalHistory.join(''))

    socket.on('terminal-input', (data) => {
        ptyProcess.write(data);
    })

    socket.on('terminal-resize', ({ cols, rows } = {}) => {
        if (!Number.isInteger(cols) || cols < 2 || cols > 300 || !Number.isInteger(rows) || rows < 1 || rows > 100) {
            socket.emit('terminal-error', 'Invalid terminal dimensions')
            return
        }
        try {
            ptyProcess.resize(cols, rows)
        } catch (error) {
            console.error('Could not resize sandbox terminal:', error)
            socket.emit('terminal-error', 'Could not resize the sandbox terminal')
        }
    })

    socket.on('disconnect', () => {
        console.log('A client disconnected:', socket.id)
    })
})

app.get('/list-files', async (req,res) => {
  

    const listFiles = async (dir,baseDir)=>{
        const entries = await fs.promises.readdir(dir,{withFileTypes:true})
        const files = []

        for(const entry of entries){
            const fullPath = path.join(dir,entry.name)
            const relativePath = path.relative(baseDir,fullPath)

            if(entry.isDirectory() && ['node_modules','.git','dist'].includes(entry.name)){
                continue
            }
            if(entry.isDirectory()){
                files.push(...await listFiles(fullPath,baseDir))
            }else{
                files.push(relativePath)
            }

        }
        return files
    }

    try{
        const files = await listFiles(WORKING_DIR,WORKING_DIR)
        return res.status(200).json({
            message: 'List of files',
            files,
        })
    }catch(err){
        return res.status(500).json({
            message: `Error listing files: ${err.message}`,
            status: 'error'
        })
    }

})

app.get('/read-files',async (req,res) => {
    const files = req.query.files

    if(!files){
        return res.status(400).json({
            message:'No files specified in qurey parameter',
            status:'error'
        })
    }

    const fileList = files.split(',')

    const results = await Promise.all(fileList.map(async (file) => {
        try{
            const filePath = resolveWorkspacePath(file)
            const content = await fs.promises.readFile(filePath,'utf-8')
            return {
                [filePath.replace(WORKING_DIR, '')]: content
            }
        }catch(err){
            return {
                [file]: `Error reading file: ${err.message}`
            }   
        }
    }))

    return res.status(200).json({
        message: 'File contents',
        results,
    })

})

app.patch('/update-file', async (req,res)=>{

    const updates = req.body.updates

    if(!updates || !Array.isArray(updates)){
        return res.status(400).json({
            message: 'Invalid request body. Expected a json object with an array of updates.',
            status: 'error'
        })
    }

    const results = await Promise.all(updates.map(async (update) => {
        try{
            const { file, content } = update || {}
            if (typeof content !== 'string') throw new Error('File content must be a string')
            const filePath = resolveWorkspacePath(file)
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
            await fs.promises.writeFile(filePath,content,'utf-8')
            return {
                [filePath]:'file update successfully'
            }
        }catch(err){
            return{
                [update?.file || '']: `error updating file: ${err.message}`,
            }
        }
        }))

     res.status(200).json({
        message: 'File updates',
        results,
    })
})

app.post('/create-files',async (req,res) => {
    
    const files = req.body.files

    if(!files || !Array.isArray(files)){
        return res.status(400).json({
            message:"Invaild request body.Expected a json object with files property containig array of object",
            status:"error",
        })
    }

    const result = await Promise.all(files.map(async (fileObj) => {

        try{
            const { file, content } = fileObj || {}
            if (typeof content !== 'string') throw new Error('File content must be a string')
            const filePath = resolveWorkspacePath(file)
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
            await fs.promises.writeFile(filePath,content,'utf-8')
            return{
                [filePath]: 'File created successfully'
            }
        }catch(err){
            return{
                [fileObj?.file || '']: `error in creating file ${err.message}`
            }
        }
        
    }))
    res.status(200).json({
        message: 'File creation results',
        result,
    })

})


export default httpServer