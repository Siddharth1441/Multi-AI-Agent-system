import Redis from "ioredis"
import { deletePod } from "../kubernetes/pod.js"
import { deleteService } from "../kubernetes/service.js"

const redis = new Redis(process.env.REDIS_URL)

const subscriber = new Redis(process.env.REDIS_URL)
const SANDBOX_TTL_SECONDS = 600

export async function createSandboxKey(sandboxId,) {
    await redis.set(`sandbox:${sandboxId}`, JSON.stringify({ 
        status:"active"
    }),"EX", SANDBOX_TTL_SECONDS)
}

export async function refreshSandboxKey(sandboxId) {
    return redis.expire(`sandbox:${sandboxId}`, SANDBOX_TTL_SECONDS)
}

subscriber.config("SET", "notify-keyspace-events", "Ex")

subscriber.subscribe("__keyevent@0__:expired")

async function deleteIfPresent(deleteResource, sandboxId) {
    try {
        await deleteResource(sandboxId)
    } catch (error) {
        if (error.code === 404 || error.statusCode === 404) {
            return
        }
        throw error
    }
}

subscriber.on("message", (channel, key) => {
    if (channel !== "__keyevent@0__:expired" || !key.startsWith("sandbox:")) {
        return
    }

    const sandboxId = key.slice("sandbox:".length)
    if (!sandboxId) {
        console.error(`Ignoring expired sandbox key with no ID: ${key}`)
        return
    }

    console.log(`Key expired: ${key}`)
    Promise.allSettled([
        deleteIfPresent(deletePod, sandboxId),
        deleteIfPresent(deleteService, sandboxId),
    ]).then((results) => {
        for (const [index, result] of results.entries()) {
            if (result.status === "rejected") {
                const resource = index === 0 ? "pod" : "service"
                console.error(`Could not delete sandbox ${resource} for ${sandboxId}:`, result.reason)
            }
        }
    })
})

export  { redis, subscriber }