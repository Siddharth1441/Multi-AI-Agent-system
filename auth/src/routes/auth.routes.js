import {Router} from "express"
import passport from "passport"
import jwt from 'jsonwebtoken'
import User from '../models/user.model.js'
import { sendAuthNotification } from "../config/mq.js"

const router = Router()

router.get('/google',passport.authenticate('google',{
    session:false,
    scope:['profile','email']
}))

router.get('/google/callback',passport.authenticate('google',{
    session:false,
    failureRedirect:'/login'
}),async(req,res)=>{
    try{
        const {id,email,displayName} = req.user
        let user = await User.findOne({googleId:id})

        await sendAuthNotification({
            userId: user._id,
            action: 'login',
            timestamp: new Date(),
            email: emails[0].value
        })



        if(!user){
            user = new User({
                googleId:id,
                email:email,
                name:displayName
            })
            await user.save()
        }

        const token = jwt.sign({id:user._id},process.env.JWT_SECRET,{expiresIn:'1h'})
        res.cookie('token',token,{httpOnly:true})
        res.redirect('/')
    }catch(error){
        console.error(error)
        res.redirect('/login')
    }
})


export default router 