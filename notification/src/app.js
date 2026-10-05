import express from "express"
import { sendEmail } from "./email.js"
import channel from "./mq.js"

const app = express()
app.get('/',(req,res)=>{
    console.log("Hello from notification service")
})

app.get('/_status/healthz',(req,res)=>{
    res.status(200).json({status:"ok"})
})
app.get('/_status/readyz',(req,res)=>{
    res.status(200).json({status:"ready"})
})


channel.consume('auth_notification_queue', async (msg) => {
    if (msg !== null) {
        const messageContent = msg.content.toString();
        console.log('received message from queue', messageContent);

        try {
            const { to, subject, text, html } = JSON.parse(messageContent);
            await sendEmail(to, subject, text, html);
            channel.ack(msg);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    } else {
        console.log('received null message');
    }
});

export default app