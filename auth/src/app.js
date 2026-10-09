import "dotenv/config"
import express from "express"
import morgan from "morgan"
import jwt from "jsonwebtoken"
import passport from "passport"
import {Strategy as GoogleStrategy} from "passport-google-oauth20"
import cookies from "cookie-parser"

import authRoutes from "./routes/auth.routes.js"


const app = express()
app.use(morgan("dev"))
app.use(cookies())
app.use(passport.initialize())

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost/api/auth/google/callback"
},(accessToken, refreshToken, profile, done) => {
    return done(null, profile)
}))

app.get('/_status/healthz',async (req,res) => {
    res.status(200).json({ status:'ok'})
})
app.get('/_status/readyz',async (req,res) => {
    res.status(200).json({ status:'ready'})
})
app.use("/api/auth", authRoutes)

export default app
