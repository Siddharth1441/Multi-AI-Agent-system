import {Router} from "express"
import passport from "passport"
import jwt from 'jsonwebtoken'
import User from '../models/user.model.js'
import { sendAuthNotification } from "../config/mq.js"
import { promisify } from "node:util"

const router = Router()
const verifyJwt = promisify(jwt.verify)
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"

router.get('/google',passport.authenticate('google',{
    session:false,
    scope:['profile','email']
}))

router.get('/google/callback',passport.authenticate('google',{
    session:false,
    failureRedirect:`${frontendUrl}?auth=failed`
}),async(req,res)=>{
    try{
        const {id,displayName} = req.user
        const email = req.user.emails?.[0]?.value
        if (!id || !email) throw new Error("Google did not return a user ID and email address")

        let user = await User.findOne({googleId:id})

        if(!user){
            user = new User({
                googleId:id,
                email:email,
                name:displayName || email.split("@")[0]
            })
            await user.save()
        }

        try {
            await sendAuthNotification({
                userId: user._id,
                action: 'login',
                timestamp: new Date(),
                email
            })
        } catch (notificationError) {
            console.error("Could not queue auth notification:",notificationError)
        }

        const token = jwt.sign({id:user._id},process.env.JWT_SECRET,{expiresIn:'1h'})
        res.cookie('token',token,{
            httpOnly:true,
            sameSite:"lax",
            secure:process.env.NODE_ENV === "production",
            maxAge:60 * 60 * 1000
        })
        res.redirect(frontendUrl)
    }catch(error){
        console.error(error)
        res.redirect(`${frontendUrl}?auth=failed`)
    }
})

router.get('/me',async(req,res)=>{
    try {
        const token = req.cookies?.token
        if (!token) return res.status(401).json({ error:"Not signed in" })

        const payload = await verifyJwt(token,process.env.JWT_SECRET)
        const user = await User.findById(payload.id).select("name email")
        if (!user) return res.status(401).json({ error:"Not signed in" })

        return res.json({ user:{ id:user._id, name:user.name, email:user.email } })
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return res.status(401).json({ error:"Not signed in" })
        }
        console.error("Could not load signed-in user:",error)
        return res.status(500).json({ error:"Could not load signed-in user" })
    }
})

router.post('/logout',(req,res)=>{
    res.clearCookie("token",{
        httpOnly:true,
        sameSite:"lax",
        secure:process.env.NODE_ENV === "production"
    })
    return res.status(204).end()
})


export default router